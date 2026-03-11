import { PrismaClient } from '@prisma/client';

const NRL_BASE = 'https://www.nrl.com';
const COMPETITION_ID = 111; // NRL Premiership

// Map NRL.com team nicknames → our 3-letter IDs
const NICKNAME_MAP: Record<string, string> = {
  'broncos': 'BRI',
  'raiders': 'CAN',
  'bulldogs': 'CBY',
  'sharks': 'CRO',
  'dolphins': 'DOL',
  'titans': 'GLD',
  'sea eagles': 'MAN',
  'storm': 'MEL',
  'knights': 'NEW',
  'warriors': 'NZW',
  'cowboys': 'NQL',
  'eels': 'PAR',
  'panthers': 'PEN',
  'rabbitohs': 'SOU',
  'dragons': 'SGI',
  'roosters': 'SYD',
  'wests tigers': 'WST',
  'tigers': 'WST',
};

// Map NRL.com teamId numbers → our 3-letter IDs
const TEAM_ID_MAP: Record<number, string> = {
  500011: 'BRI', // Broncos
  500013: 'CAN', // Raiders
  500010: 'CBY', // Bulldogs
  500015: 'CRO', // Sharks
  500028: 'DOL', // Dolphins
  500004: 'GLD', // Titans
  500002: 'MAN', // Sea Eagles
  500021: 'MEL', // Storm
  500003: 'NEW', // Knights
  500032: 'NZW', // Warriors
  500012: 'NQL', // Cowboys
  500031: 'PAR', // Eels
  500014: 'PEN', // Panthers
  500005: 'SOU', // Rabbitohs
  500022: 'SGI', // Dragons
  500016: 'SYD', // Roosters
  500023: 'WST', // Wests Tigers
};

function resolveTeamId(nickname: string): string | null {
  return NICKNAME_MAP[nickname.toLowerCase().trim()] ?? null;
}

function resolveNrlTeamId(teamId: number): string | null {
  return TEAM_ID_MAP[teamId] ?? null;
}

export interface ScrapeResult {
  source: string;
  type: string;
  recordsAffected: number;
  errors: string[];
  details: string;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'FootyTipsApp/1.0 (personal tipping assistant)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/**
 * Fetch fixtures/draw from NRL.com JSON API
 */
export async function fetchDraw(
  prisma: PrismaClient,
  season: number,
  round: number
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    source: 'nrl.com/api',
    type: 'draw',
    recordsAffected: 0,
    errors: [],
    details: '',
  };

  try {
    const url = `${NRL_BASE}/draw/data?competition=${COMPETITION_ID}&season=${season}&round=${round}`;
    const data = await fetchJson(url);

    if (!data.fixtures || !Array.isArray(data.fixtures)) {
      result.errors.push('No fixtures array in API response');
      return result;
    }

    const roundId = `${season}-R${round}`;

    // Ensure round exists
    await prisma.round.upsert({
      where: { id: roundId },
      update: {},
      create: {
        id: roundId,
        seasonId: String(season),
        number: round,
        name: `Round ${round}`,
      },
    });

    for (const match of data.fixtures) {
      if (match.type !== 'Match') continue;

      const homeId = resolveNrlTeamId(match.homeTeam?.teamId) ??
                     resolveTeamId(match.homeTeam?.nickName ?? '');
      const awayId = resolveNrlTeamId(match.awayTeam?.teamId) ??
                     resolveTeamId(match.awayTeam?.nickName ?? '');

      if (!homeId || !awayId) {
        result.errors.push(`Unknown team: ${match.homeTeam?.nickName} vs ${match.awayTeam?.nickName}`);
        continue;
      }

      const kickoff = match.clock?.kickOffTimeLong
        ? new Date(match.clock.kickOffTimeLong)
        : null;

      const homeScore = typeof match.homeTeam?.score === 'number' ? match.homeTeam.score : null;
      const awayScore = typeof match.awayTeam?.score === 'number' ? match.awayTeam.score : null;

      let status = 'upcoming';
      let matchResult: string | null = null;
      if (match.matchState === 'FullTime' || match.matchMode === 'Post') {
        status = 'completed';
        if (homeScore != null && awayScore != null) {
          matchResult = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
        }
      } else if (match.matchState === 'InProgress' || match.matchMode === 'Live') {
        status = 'live';
      }

      const homeOdds = match.homeTeam?.odds ? parseFloat(match.homeTeam.odds) : null;
      const awayOdds = match.awayTeam?.odds ? parseFloat(match.awayTeam.odds) : null;

      // Upsert fixture by round + home + away
      const existing = await prisma.fixture.findFirst({
        where: { roundId, homeTeamId: homeId, awayTeamId: awayId },
      });

      if (existing) {
        await prisma.fixture.update({
          where: { id: existing.id },
          data: {
            venue: match.venue ?? existing.venue,
            venueCity: match.venueCity ?? existing.venueCity,
            kickoff: kickoff ?? existing.kickoff,
            homeScore,
            awayScore,
            result: matchResult,
            status,
            homeOdds: homeOdds ?? existing.homeOdds,
            awayOdds: awayOdds ?? existing.awayOdds,
            matchCentreUrl: match.matchCentreUrl ?? existing.matchCentreUrl,
          },
        });
      } else {
        await prisma.fixture.create({
          data: {
            roundId,
            homeTeamId: homeId,
            awayTeamId: awayId,
            venue: match.venue,
            venueCity: match.venueCity,
            kickoff,
            homeScore,
            awayScore,
            result: matchResult,
            status,
            homeOdds,
            awayOdds,
            matchCentreUrl: match.matchCentreUrl,
          },
        });
      }

      result.recordsAffected++;
    }

    result.details = `${result.recordsAffected} fixtures for ${season} Round ${round}`;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

/**
 * Fetch ladder from NRL.com JSON API
 */
export async function fetchLadder(
  prisma: PrismaClient,
  season: number
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    source: 'nrl.com/api',
    type: 'ladder',
    recordsAffected: 0,
    errors: [],
    details: '',
  };

  try {
    const url = `${NRL_BASE}/ladder/data?competition=${COMPETITION_ID}&season=${season}`;
    const data = await fetchJson(url);

    if (!data.positions || !Array.isArray(data.positions)) {
      result.errors.push('No positions array in ladder API response');
      return result;
    }

    // Determine current round from filterRounds
    const rounds = data.filterRounds as Array<{ name: string; value: number }>;
    const currentRound = rounds?.length ? Math.max(...rounds.map(r => r.value)) : 1;

    for (let i = 0; i < data.positions.length; i++) {
      const pos = data.positions[i];
      const teamId = resolveTeamId(pos.teamNickname ?? '') ??
                     resolveTeamId(pos.teamNickName ?? '');

      if (!teamId) {
        result.errors.push(`Unknown team in ladder: ${pos.teamNickname ?? pos.teamNickName}`);
        continue;
      }

      const stats = pos.stats ?? {};

      await prisma.ladderEntry.upsert({
        where: {
          teamId_season_round: {
            teamId,
            season: String(season),
            round: currentRound,
          },
        },
        update: {
          position: i + 1,
          played: stats.played ?? 0,
          wins: stats.wins ?? 0,
          draws: stats.drawn ?? 0,
          losses: stats.lost ?? 0,
          byes: stats.byes ?? 0,
          pointsFor: stats['points for'] ?? 0,
          pointsAgainst: stats['points against'] ?? 0,
          pointsDiff: stats['points difference'] ?? 0,
          competitionPoints: stats.points ?? 0,
          homeRecord: stats['home record'] ?? null,
          awayRecord: stats['away record'] ?? null,
          streak: stats.streak ?? null,
          form: stats.form ?? null,
          avgWinMargin: stats['average winning margin'] ?? null,
          avgLoseMargin: stats['average losing margin'] ?? null,
          titleOdds: stats.odds ?? null,
        },
        create: {
          teamId,
          season: String(season),
          round: currentRound,
          position: i + 1,
          played: stats.played ?? 0,
          wins: stats.wins ?? 0,
          draws: stats.drawn ?? 0,
          losses: stats.lost ?? 0,
          byes: stats.byes ?? 0,
          pointsFor: stats['points for'] ?? 0,
          pointsAgainst: stats['points against'] ?? 0,
          pointsDiff: stats['points difference'] ?? 0,
          competitionPoints: stats.points ?? 0,
          homeRecord: stats['home record'] ?? null,
          awayRecord: stats['away record'] ?? null,
          streak: stats.streak ?? null,
          form: stats.form ?? null,
          avgWinMargin: stats['average winning margin'] ?? null,
          avgLoseMargin: stats['average losing margin'] ?? null,
          titleOdds: stats.odds ?? null,
        },
      });

      result.recordsAffected++;
    }

    result.details = `${result.recordsAffected} ladder entries for ${season} round ${currentRound}`;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

/**
 * Fetch all rounds for a given season from NRL.com
 */
export async function fetchSeasonDraw(
  prisma: PrismaClient,
  season: number,
  maxRound: number = 27
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  for (let round = 1; round <= maxRound; round++) {
    const r = await fetchDraw(prisma, season, round);
    results.push(r);

    // Stop if we get an empty round (season hasn't reached that round yet)
    if (r.recordsAffected === 0 && r.errors.length === 0) break;

    // Rate limit: 500ms between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}
