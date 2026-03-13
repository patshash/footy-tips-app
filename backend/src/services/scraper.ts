import { PrismaClient } from '@prisma/client';
import { fetchDraw, fetchLadder, fetchSeasonDraw, fetchTeamStats, computeTeamStats, ScrapeResult } from './nrl-api.js';
import { fetchRoundDetails, fetchSeasonRoundDetails } from './rlp-scraper.js';

export type { ScrapeResult };

/**
 * Scrape current round fixtures + ladder from NRL.com JSON API.
 */
export async function scrapeCurrentRound(prisma: PrismaClient, season: number = 2026): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  // Auto-detect current round from the NRL API (default draw endpoint returns current round)
  let roundNum = 1;
  try {
    const url = `https://www.nrl.com/draw/data?competition=111&season=${season}`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      if (typeof data.selectedRoundId === 'number') {
        roundNum = data.selectedRoundId;
      }
    }
  } catch {
    // Fall back to DB if API call fails
    const currentRound = await prisma.round.findFirst({
      where: { seasonId: String(season), isCurrent: true },
      orderBy: { number: 'desc' },
    });
    roundNum = currentRound?.number ?? 1;
  }

  // Fetch fixtures for current round (also updates isCurrent flag)
  results.push(await fetchDraw(prisma, season, roundNum));

  // Also scrape the previous round to pick up completed results
  if (roundNum > 1) {
    results.push(await fetchDraw(prisma, season, roundNum - 1));
  }

  // Fetch ladder
  results.push(await fetchLadder(prisma, season));

  return results;
}

/**
 * Alias for backwards compatibility with scrape routes
 */
export async function scrapeLadder(prisma: PrismaClient, season: string = '2026'): Promise<ScrapeResult> {
  return fetchLadder(prisma, parseInt(season));
}

/**
 * Alias for backwards compatibility with scrape routes
 */
export async function scrapeFixtures(prisma: PrismaClient, season: string = '2026', round?: number): Promise<ScrapeResult> {
  if (round) {
    return fetchDraw(prisma, parseInt(season), round);
  }
  // Auto-detect current round
  const results = await scrapeCurrentRound(prisma, parseInt(season));
  // Return just the first draw result (current round fixtures)
  return results[0] ?? { source: 'nrl.com/api', type: 'draw', recordsAffected: 0, errors: ['No results'], details: '' };
}

/**
 * Scrape all data for current season: current round fixtures + ladder + team stats.
 */
export async function scrapeAll(prisma: PrismaClient, season: string = '2026'): Promise<ScrapeResult[]> {
  const results = await scrapeCurrentRound(prisma, parseInt(season));
  results.push(await scrapeTeamStats(prisma, season));
  return results;
}

/**
 * Scrape team-level statistics from NRL.com stats API.
 * Falls back to computing stats from completed fixture data if API unavailable.
 */
export async function scrapeTeamStats(prisma: PrismaClient, season: string = '2026'): Promise<ScrapeResult> {
  return fetchTeamStats(prisma, parseInt(season));
}

/**
 * Bulk historical import: all fixtures + ladder for a given year range.
 * Fetches all rounds from NRL.com API, then enriches with RLP data.
 */
export async function scrapeHistorical(
  prisma: PrismaClient,
  startYear: number = 2025,
  endYear: number = 2025,
  onProgress?: (msg: string) => void
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  for (let year = startYear; year <= endYear; year++) {
    // Ensure season exists
    await prisma.season.upsert({
      where: { id: String(year) },
      update: {},
      create: { id: String(year), year, current: year === endYear },
    });

    onProgress?.(`Fetching ${year} season draw from NRL.com...`);
    const drawResults = await fetchSeasonDraw(prisma, year);
    results.push(...drawResults);

    onProgress?.(`Fetching ${year} ladder from NRL.com...`);
    const ladderResult = await fetchLadder(prisma, year);
    results.push(ladderResult);

    // Enrich completed fixtures with RLP data (referee, crowd, halftime)
    // Only for past seasons where match details are available
    if (year < new Date().getFullYear() || (year === new Date().getFullYear() && new Date().getMonth() > 3)) {
      const maxRound = drawResults.filter(r => r.recordsAffected > 0).length;
      if (maxRound > 0) {
        onProgress?.(`Enriching ${year} fixtures from Rugby League Project (${maxRound} rounds)...`);
        const rlpResults = await fetchSeasonRoundDetails(prisma, year, maxRound);
        results.push(...rlpResults);
      }
    }

    // Compute team stats from fixture data for this season
    onProgress?.(`Computing ${year} team statistics from fixtures...`);
    const statsResult = await computeTeamStats(prisma, year);
    results.push(statsResult);
  }

  return results;
}
