import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';

const RLP_BASE = 'https://rugbyleagueproject.org';
const REQUEST_DELAY_MS = 2000; // Be polite: 2s between requests

// Map RLP team names → our 3-letter IDs
const TEAM_NAME_MAP: Record<string, string> = {
  'brisbane broncos': 'BRI',
  'brisbane': 'BRI',
  'broncos': 'BRI',
  'canberra raiders': 'CAN',
  'canberra': 'CAN',
  'raiders': 'CAN',
  'canterbury-bankstown bulldogs': 'CBY',
  'canterbury bulldogs': 'CBY',
  'canterbury': 'CBY',
  'bulldogs': 'CBY',
  'cronulla-sutherland sharks': 'CRO',
  'cronulla sharks': 'CRO',
  'cronulla': 'CRO',
  'sharks': 'CRO',
  'dolphins': 'DOL',
  'the dolphins': 'DOL',
  'redcliffe dolphins': 'DOL',
  'gold coast titans': 'GLD',
  'gold coast': 'GLD',
  'titans': 'GLD',
  'manly-warringah sea eagles': 'MAN',
  'manly warringah sea eagles': 'MAN',
  'manly sea eagles': 'MAN',
  'manly': 'MAN',
  'sea eagles': 'MAN',
  'melbourne storm': 'MEL',
  'melbourne': 'MEL',
  'storm': 'MEL',
  'newcastle knights': 'NEW',
  'newcastle': 'NEW',
  'knights': 'NEW',
  'new zealand warriors': 'NZW',
  'warriors': 'NZW',
  'north queensland cowboys': 'NQL',
  'north queensland': 'NQL',
  'cowboys': 'NQL',
  'parramatta eels': 'PAR',
  'parramatta': 'PAR',
  'eels': 'PAR',
  'penrith panthers': 'PEN',
  'penrith': 'PEN',
  'panthers': 'PEN',
  'south sydney rabbitohs': 'SOU',
  'south sydney': 'SOU',
  'rabbitohs': 'SOU',
  'souths': 'SOU',
  'st george illawarra dragons': 'SGI',
  'st george illawarra': 'SGI',
  'st. george illawarra dragons': 'SGI',
  'dragons': 'SGI',
  'sydney roosters': 'SYD',
  'sydney': 'SYD',
  'roosters': 'SYD',
  'wests tigers': 'WST',
  'west tigers': 'WST',
  'tigers': 'WST',
};

function resolveTeamName(name: string): string | null {
  const lower = name.toLowerCase().trim();
  return TEAM_NAME_MAP[lower] ?? null;
}

export interface RlpScrapeResult {
  source: string;
  type: string;
  recordsAffected: number;
  errors: string[];
  details: string;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'FootyTipsApp/1.0 (personal tipping assistant)',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrape round results from RLP and enrich existing fixtures
 * with referee, crowd, halftime scores.
 */
export async function fetchRoundDetails(
  prisma: PrismaClient,
  season: number,
  round: number
): Promise<RlpScrapeResult> {
  const result: RlpScrapeResult = {
    source: 'rugbyleagueproject.org',
    type: 'round-details',
    recordsAffected: 0,
    errors: [],
    details: '',
  };

  try {
    const url = `${RLP_BASE}/seasons/nrl-${season}/round-${round}/summary.html`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Find match links on the round summary page
    const matchLinks: string[] = [];
    $('a[href*="/matches/"]').each((_i, el) => {
      const href = $(el).attr('href');
      if (href && /\/matches\/\d+/.test(href)) {
        const fullUrl = href.startsWith('http') ? href : `${RLP_BASE}${href}`;
        if (!matchLinks.includes(fullUrl)) matchLinks.push(fullUrl);
      }
    });

    if (matchLinks.length === 0) {
      // Try to find match data directly from the round summary tables
      result.details = `No match links found for ${season} Round ${round}`;
      return result;
    }

    // Fetch each match page for details
    for (const matchUrl of matchLinks) {
      await delay(REQUEST_DELAY_MS);

      try {
        const matchHtml = await fetchHtml(matchUrl);
        const $m = cheerio.load(matchHtml);

        // Parse match header for team names and scores
        const title = $m('h1').first().text().trim();
        
        // Look for team names and scores in the match info
        // RLP format varies but typically has: "Team A 24 d Team B 12"
        // Or structured tables with team info

        // Extract from structured content
        let homeTeamName = '';
        let awayTeamName = '';
        let referee = '';
        let crowd: number | null = null;
        let halftimeHome: number | null = null;
        let halftimeAway: number | null = null;

        // Look for "Match Information" or similar sections
        $m('table').each((_i, table) => {
          const tableText = $m(table).text();

          // Look for referee info
          if (tableText.toLowerCase().includes('referee')) {
            $m(table).find('tr').each((_j, tr) => {
              const cells = $m(tr).find('td, th');
              const label = cells.first().text().trim().toLowerCase();
              const value = cells.last().text().trim();
              if (label.includes('referee') && !referee) {
                referee = value;
              }
              if (label.includes('crowd') || label.includes('attendance')) {
                const num = parseInt(value.replace(/,/g, ''), 10);
                if (!isNaN(num)) crowd = num;
              }
            });
          }
        });

        // Parse halftime from scoresheet or match info
        const bodyText = $m('body').text();
        const htMatch = bodyText.match(/half[\s-]*time[:\s]*(\d+)\s*[-–]\s*(\d+)/i);
        if (htMatch) {
          halftimeHome = parseInt(htMatch[1], 10);
          halftimeAway = parseInt(htMatch[2], 10);
        }

        // Try to identify teams from the title or heading
        // Format often: "Team A v Team B" or "Team A 24 defeated Team B 12"
        const vsMatch = title.match(/^(.+?)\s+(?:v|vs|defeated|drew with|lost to)\s+(.+?)(?:\s*$|\s+\d)/i);
        if (vsMatch) {
          homeTeamName = vsMatch[1].replace(/\d+$/, '').trim();
          awayTeamName = vsMatch[2].replace(/\d+$/, '').trim();
        }

        // If we found team names, try to match them and enrich the fixture
        const homeId = homeTeamName ? resolveTeamName(homeTeamName) : null;
        const awayId = awayTeamName ? resolveTeamName(awayTeamName) : null;
        const roundId = `${season}-R${round}`;

        if (homeId && awayId) {
          const fixture = await prisma.fixture.findFirst({
            where: { roundId, homeTeamId: homeId, awayTeamId: awayId },
          });

          // Also try reverse (RLP might list teams differently)
          const fixtureReverse = fixture ? null : await prisma.fixture.findFirst({
            where: { roundId, homeTeamId: awayId, awayTeamId: homeId },
          });

          const target = fixture ?? fixtureReverse;

          if (target && (referee || crowd || halftimeHome != null)) {
            await prisma.fixture.update({
              where: { id: target.id },
              data: {
                ...(referee ? { referee } : {}),
                ...(crowd != null ? { crowd } : {}),
                ...(halftimeHome != null ? { halftimeHome } : {}),
                ...(halftimeAway != null ? { halftimeAway } : {}),
              },
            });
            result.recordsAffected++;
          }
        } else if (referee || crowd) {
          // If we can't identify teams but have enrichment data,
          // log what we found for debugging
          result.errors.push(
            `Found data (ref: ${referee}, crowd: ${crowd}) but couldn't map teams: "${homeTeamName}" vs "${awayTeamName}"`
          );
        }
      } catch (matchErr) {
        result.errors.push(
          `Failed to fetch ${matchUrl}: ${matchErr instanceof Error ? matchErr.message : String(matchErr)}`
        );
      }
    }

    result.details = `Enriched ${result.recordsAffected} fixtures for ${season} Round ${round} from ${matchLinks.length} match pages`;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

/**
 * Scrape season summary from RLP for ladder data and season-level stats.
 * Useful as a secondary source to cross-validate NRL.com data.
 */
export async function fetchSeasonSummary(
  prisma: PrismaClient,
  season: number
): Promise<RlpScrapeResult> {
  const result: RlpScrapeResult = {
    source: 'rugbyleagueproject.org',
    type: 'season-summary',
    recordsAffected: 0,
    errors: [],
    details: '',
  };

  try {
    const url = `${RLP_BASE}/seasons/nrl-${season}/summary.html`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // RLP season summary has a ladder table with team stats
    // Look for the main standings table
    const tables = $('table');
    let ladderFound = false;

    tables.each((_i, table) => {
      const headers = $(table).find('th').map((_j, th) => $(th).text().trim().toLowerCase()).get();
      
      // The ladder table typically has: Team, P, W, D, L, B, PF, PA, PD, Pts
      if (headers.includes('team') && (headers.includes('pts') || headers.includes('p'))) {
        ladderFound = true;
        let position = 0;

        $(table).find('tbody tr, tr').each((_j, tr) => {
          const cells = $(tr).find('td');
          if (cells.length < 5) return; // Skip header rows

          position++;
          const teamCell = cells.first().text().trim();
          const teamId = resolveTeamName(teamCell);

          if (!teamId) return;

          // Parse stats from cells (order depends on table structure)
          const cellValues = cells.map((_k, td) => $(td).text().trim()).get();
          
          // Try to extract numeric values
          const played = parseInt(cellValues[1], 10) || 0;
          const wins = parseInt(cellValues[2], 10) || 0;
          const draws = parseInt(cellValues[3], 10) || 0;
          const losses = parseInt(cellValues[4], 10) || 0;

          result.recordsAffected++;
          result.details += `${teamId}: P${played} W${wins} D${draws} L${losses}\n`;
        });
      }
    });

    if (!ladderFound) {
      result.details = `No ladder table found for ${season} season summary`;
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

/**
 * Fetch all round details for a season from RLP to enrich fixtures.
 */
export async function fetchSeasonRoundDetails(
  prisma: PrismaClient,
  season: number,
  maxRound: number = 27
): Promise<RlpScrapeResult[]> {
  const results: RlpScrapeResult[] = [];

  for (let round = 1; round <= maxRound; round++) {
    const r = await fetchRoundDetails(prisma, season, round);
    results.push(r);

    // If we get an HTTP error for a round page, that season/round likely doesn't exist
    if (r.errors.some(e => e.includes('HTTP 404'))) break;
  }

  return results;
}
