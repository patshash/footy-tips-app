import { PrismaClient } from '@prisma/client';
import { fetchDraw, fetchLadder, fetchSeasonDraw, ScrapeResult } from './nrl-api.js';
import { fetchRoundDetails, fetchSeasonRoundDetails } from './rlp-scraper.js';

export type { ScrapeResult };

/**
 * Scrape current round fixtures + ladder from NRL.com JSON API.
 */
export async function scrapeCurrentRound(prisma: PrismaClient, season: number = 2026): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  // Find current round
  const currentRound = await prisma.round.findFirst({
    where: { seasonId: String(season), isCurrent: true },
    orderBy: { number: 'desc' },
  });
  const roundNum = currentRound?.number ?? 1;

  // Fetch fixtures for current round
  results.push(await fetchDraw(prisma, season, roundNum));

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
  const currentRound = await prisma.round.findFirst({
    where: { seasonId: season, isCurrent: true },
    orderBy: { number: 'desc' },
  });
  return fetchDraw(prisma, parseInt(season), round ?? currentRound?.number ?? 1);
}

/**
 * Scrape all data for current season: current round fixtures + ladder.
 */
export async function scrapeAll(prisma: PrismaClient, season: string = '2026'): Promise<ScrapeResult[]> {
  return scrapeCurrentRound(prisma, parseInt(season));
}

/**
 * Bulk historical import: all fixtures + ladder for 2024-2026.
 * Fetches all rounds from NRL.com API, then enriches with RLP data.
 */
export async function scrapeHistorical(
  prisma: PrismaClient,
  startYear: number = 2024,
  endYear: number = 2026,
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
  }

  return results;
}
