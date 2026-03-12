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
  500001: 'SYD', // Roosters
  500002: 'MAN', // Sea Eagles
  500003: 'NEW', // Knights
  500004: 'GLD', // Titans
  500005: 'SOU', // Rabbitohs
  500010: 'CBY', // Bulldogs
  500011: 'BRI', // Broncos
  500012: 'NQL', // Cowboys
  500013: 'CAN', // Raiders
  500014: 'PEN', // Panthers
  500021: 'MEL', // Storm
  500022: 'SGI', // Dragons
  500023: 'WST', // Wests Tigers
  500028: 'CRO', // Sharks
  500031: 'PAR', // Eels
  500032: 'NZW', // Warriors
  500723: 'DOL', // Dolphins
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

    // Detect whether this round is the current round from the API
    const isCurrentRound = data.fixtures.some((f: any) => f.isCurrentRound === true);

    // Ensure round exists and update isCurrent flag
    await prisma.round.upsert({
      where: { id: roundId },
      update: { isCurrent: isCurrentRound },
      create: {
        id: roundId,
        seasonId: String(season),
        number: round,
        name: `Round ${round}`,
        isCurrent: isCurrentRound,
      },
    });

    // If this is the current round, clear isCurrent on all other rounds in the season
    if (isCurrentRound) {
      await prisma.round.updateMany({
        where: { seasonId: String(season), id: { not: roundId } },
        data: { isCurrent: false },
      });
    }

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

/**
 * Fetch team statistics from NRL.com stats API.
 * Attempts to parse completion rate, tackle efficiency, errors,
 * penalties, and possession for each team.
 */
export async function fetchTeamStats(
  prisma: PrismaClient,
  season: number
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    source: 'nrl.com/api',
    type: 'team-stats',
    recordsAffected: 0,
    errors: [],
    details: '',
  };

  // Step 1: Compute base stats (W/L/D, PF/PA, streaks) from fixture data
  const fixtureResult = await computeTeamStats(prisma, season);
  result.recordsAffected = fixtureResult.recordsAffected;
  result.errors.push(...fixtureResult.errors);

  // Step 2: Enrich with NRL.com leaderboard stats (completion%, possession%, etc.)
  // The API returns stats by category with top-N leaderboard entries per stat,
  // not a flat team array. We collect per-team values across all categories.
  try {
    const url = `${NRL_BASE}/stats/data?competition=${COMPETITION_ID}&season=${season}`;
    const data = await fetchJson(url);

    const categories: any[] = data.teamStats ?? [];
    if (!Array.isArray(categories) || categories.length === 0) {
      result.details = `${fixtureResult.details} (no API leaderboard data available)`;
      return result;
    }

    // Stat IDs we care about → our DB field names
    const STAT_MAP: Record<number, string> = {
      1000210: 'completionRate',   // Set Completion %
      9:       'possessionAvg',    // Possession %
      37:      'errorCount',       // Errors
      1000026: 'penaltyCount',     // Penalties Conceded
    };
    // Tackle efficiency = Tackles / (Tackles + Missed Tackles)
    const TACKLE_STAT_ID = 3;
    const MISSED_TACKLE_STAT_ID = 4;

    // Collect per-team stat values from leaderboards
    const teamData: Record<string, Record<string, number>> = {};
    let enriched = 0;

    for (const category of categories) {
      for (const group of category.groups ?? []) {
        const statId = group.statId as number;
        const field = STAT_MAP[statId];
        const isTackle = statId === TACKLE_STAT_ID;
        const isMissedTackle = statId === MISSED_TACKLE_STAT_ID;

        if (!field && !isTackle && !isMissedTackle) continue;

        for (const leader of group.leaders ?? []) {
          const tid =
            resolveNrlTeamId(leader.teamId ?? 0) ??
            resolveTeamId(leader.teamNickName ?? '');
          if (!tid) continue;

          if (!teamData[tid]) teamData[tid] = {};
          const val = parseFloat(String(leader.value));
          if (isNaN(val)) continue;

          if (field) teamData[tid][field] = val;
          if (isTackle) teamData[tid]._tackles = val;
          if (isMissedTackle) teamData[tid]._missedTackles = val;
        }
      }
    }

    // Use the same round that computeTeamStats used (latest round with completed fixtures)
    const existingStat = await prisma.teamStat.findFirst({
      where: { season: String(season) },
      orderBy: { roundId: 'desc' },
    });
    const roundId = existingStat?.roundId ?? `${season}-R1`;

    // Update existing records with API-sourced stats
    for (const [teamId, stats] of Object.entries(teamData)) {
      // Compute tackle efficiency if we have both values
      if (stats._tackles != null && stats._missedTackles != null) {
        const total = stats._tackles + stats._missedTackles;
        if (total > 0) stats.tackleEfficiency = (stats._tackles / total) * 100;
      }
      delete stats._tackles;
      delete stats._missedTackles;

      if (Object.keys(stats).length === 0) continue;

      // Build update data, converting to correct types
      const updateData: Record<string, number | null> = {};
      if (stats.completionRate != null) updateData.completionRate = stats.completionRate;
      if (stats.possessionAvg != null) updateData.possessionAvg = stats.possessionAvg;
      if (stats.tackleEfficiency != null) updateData.tackleEfficiency = stats.tackleEfficiency;
      if (stats.errorCount != null) updateData.errorCount = Math.round(stats.errorCount);
      if (stats.penaltyCount != null) updateData.penaltyCount = Math.round(stats.penaltyCount);

      try {
        await prisma.teamStat.update({
          where: { teamId_season_roundId: { teamId, season: String(season), roundId } },
          data: updateData,
        });
        enriched++;
      } catch {
        // Record may not exist if team had no fixtures yet — skip
      }
    }

    result.details = `${fixtureResult.details}; enriched ${enriched} teams with NRL.com stats`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Stats API enrichment failed (fixture stats still saved): ${msg}`);
    result.details = fixtureResult.details;
  }

  return result;
}

/**
 * Compute team statistics from completed fixture data.
 * Used as a fallback when the NRL stats API is unavailable.
 * Calculates: played, W/L/D, PF/PA, home/away splits, streaks.
 */
export async function computeTeamStats(
  prisma: PrismaClient,
  season: number
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    source: 'computed',
    type: 'team-stats',
    recordsAffected: 0,
    errors: [],
    details: '',
  };

  try {
    const teams = await prisma.team.findMany();
    const seasonStr = String(season);

    // Get all completed fixtures for this season
    const fixtures = await prisma.fixture.findMany({
      where: {
        roundId: { startsWith: seasonStr },
        status: 'completed',
      },
    });

    if (fixtures.length === 0) {
      result.details = `No completed fixtures for ${season}`;
      return result;
    }

    // Find the latest round with completed fixtures
    const roundNumbers = fixtures
      .map((f: { roundId: string }) => {
        const match = f.roundId.match(/R(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter((n: number) => n > 0);
    const latestRound = Math.max(...roundNumbers);
    const roundId = `${season}-R${latestRound}`;

    for (const team of teams) {
      const homeGames = fixtures.filter((f: { homeTeamId: string }) => f.homeTeamId === team.id);
      const awayGames = fixtures.filter((f: { awayTeamId: string }) => f.awayTeamId === team.id);
      const allGames = [...homeGames, ...awayGames];

      if (allGames.length === 0) continue;

      const homeWins = homeGames.filter((f: { result: string | null }) => f.result === 'home').length;
      const homeLosses = homeGames.filter((f: { result: string | null }) => f.result === 'away').length;
      const awayWins = awayGames.filter((f: { result: string | null }) => f.result === 'away').length;
      const awayLosses = awayGames.filter((f: { result: string | null }) => f.result === 'home').length;
      const drawCount = allGames.filter((f: { result: string | null }) => f.result === 'draw').length;

      const pf = homeGames.reduce((s: number, f: { homeScore: number | null }) => s + (f.homeScore ?? 0), 0)
               + awayGames.reduce((s: number, f: { awayScore: number | null }) => s + (f.awayScore ?? 0), 0);
      const pa = homeGames.reduce((s: number, f: { awayScore: number | null }) => s + (f.awayScore ?? 0), 0)
               + awayGames.reduce((s: number, f: { homeScore: number | null }) => s + (f.homeScore ?? 0), 0);

      // Calculate streak from most recent games
      const sorted = allGames.sort((a, b) => b.roundId.localeCompare(a.roundId));
      let streakType = '';
      let streakCount = 0;
      for (const g of sorted) {
        const won = (g.homeTeamId === team.id && g.result === 'home') ||
                    (g.awayTeamId === team.id && g.result === 'away');
        const thisType = won ? 'W' : 'L';
        if (!streakType) { streakType = thisType; streakCount = 1; }
        else if (thisType === streakType) { streakCount++; }
        else break;
      }
      const streak = streakCount > 0 ? `${streakCount}${streakType}` : null;

      await prisma.teamStat.upsert({
        where: {
          teamId_season_roundId: {
            teamId: team.id,
            season: seasonStr,
            roundId,
          },
        },
        update: {
          played: allGames.length,
          wins: homeWins + awayWins,
          losses: homeLosses + awayLosses,
          draws: drawCount,
          pointsFor: pf,
          pointsAgainst: pa,
          homeWins, homeLosses, awayWins, awayLosses,
          streak,
        },
        create: {
          teamId: team.id,
          season: seasonStr,
          roundId,
          played: allGames.length,
          wins: homeWins + awayWins,
          losses: homeLosses + awayLosses,
          draws: drawCount,
          pointsFor: pf,
          pointsAgainst: pa,
          homeWins, homeLosses, awayWins, awayLosses,
          streak,
        },
      });

      result.recordsAffected++;
    }

    result.details = `${result.recordsAffected} team stats computed from fixtures for ${season} (R${latestRound})`;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

function parseStatFloat(val: any): number | null {
  if (val == null) return null;
  const n = typeof val === 'string' ? parseFloat(val.replace('%', '')) : Number(val);
  return isNaN(n) ? null : n;
}

function parseStatInt(val: any): number | null {
  if (val == null) return null;
  const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
  return isNaN(n) ? null : n;
}
