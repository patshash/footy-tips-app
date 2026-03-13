import { PrismaClient } from '@prisma/client';

export interface InjuryInfo {
  playerName: string;
  position: string | null;
  severity: string | null;
  status: string;
  injuryType: string | null;
}

export interface TeamProfile {
  id: string;
  name: string;
  ladderPos2025: number;
  wins2025: number;
  losses2025: number;
  pd2025: number;
  homeWins: number;
  homeLosses: number;
  awayWins: number;
  awayLosses: number;
  avgPF: number;
  avgPA: number;
  titleOdds: number | null;
  streak2026: string | null;
  recentForm: string;
  injuries: InjuryInfo[];
  completionRate: number | null;
  tackleEfficiency: number | null;
  errorCount: number | null;
  penaltyCount: number | null;
  possessionAvg: number | null;
}

// Position criticality for injury impact scoring
const POSITION_CRITICALITY: Record<string, number> = {
  'halfback': 1.0,
  'five-eighth': 1.0,
  'fullback': 1.0,
  'hooker': 1.0,
  'lock': 0.7,
  'centre': 0.7,
  'prop': 0.7,
  'second row': 0.4,
  'second-row': 0.4,
  'winger': 0.4,
  'wing': 0.4,
  'bench': 0.2,
  'reserve': 0.2,
};

const SEVERITY_WEIGHT: Record<string, number> = {
  'season-ending': 1.0,
  'major': 0.8,
  'moderate': 0.5,
  'minor': 0.2,
};

const STATUS_MODIFIER: Record<string, number> = {
  'out': 1.0,
  'doubtful': 0.5,
  'probable': 0.0, // probable players are returning — handled separately as a boost
};

export interface PredictionFactor {
  name: string;
  favouring: string;
  weight: number;
  detail: string;
}

export interface MatchPrediction {
  fixtureId: string;
  homeTeam: TeamProfile;
  awayTeam: TeamProfile;
  venue: string;
  h2h: string;
  predictedWinner: string;
  predictedWinnerId: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY HIGH';
  confidenceScore: number;
  factors: PredictionFactor[];
  summary: string;
}

function parseTitleOdds(odds: string | null): number | null {
  if (!odds) return null;
  return parseFloat(odds.replace('$', ''));
}

function formWinRate(form: string, n: number = 5): number {
  const recent = form.slice(0, n);
  if (recent.length === 0) return 0.5;
  const wins = (recent.match(/W/g) || []).length;
  return wins / recent.length;
}

function winPct(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? wins / total : 0.5;
}

function impliedProb(odds: number | null): number {
  if (!odds || odds <= 1) return 0.5;
  return 1 / odds;
}

function confidenceLabel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY HIGH' {
  if (score >= 80) return 'VERY HIGH';
  if (score >= 65) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

function getPositionCriticality(position: string | null): number {
  if (!position) return 0.4; // unknown position — assume moderate impact
  return POSITION_CRITICALITY[position.toLowerCase().trim()] ?? 0.4;
}

function getSeverityWeight(severity: string | null): number {
  if (!severity) return 0.4; // unknown severity — assume moderate
  return SEVERITY_WEIGHT[severity.toLowerCase().trim()] ?? 0.4;
}

function getStatusModifier(status: string): number {
  return STATUS_MODIFIER[status.toLowerCase().trim()] ?? 1.0;
}

/**
 * Calculate the total injury burden for a team.
 * Higher score = more impacted by injuries (worse off).
 */
function calculateInjuryBurden(injuries: InjuryInfo[]): number {
  let burden = 0;
  for (const inj of injuries) {
    if (inj.status === 'probable') continue; // returning players don't add burden
    const severity = getSeverityWeight(inj.severity);
    const criticality = getPositionCriticality(inj.position);
    const statusMod = getStatusModifier(inj.status);
    burden += severity * criticality * statusMod;
  }
  return burden;
}

/**
 * Calculate a positive boost from players returning from injury (status: probable).
 * Returns a score representing the team's gain from returning players.
 */
function calculateReturnBoost(injuries: InjuryInfo[]): number {
  let boost = 0;
  for (const inj of injuries) {
    if (inj.status !== 'probable') continue;
    const criticality = getPositionCriticality(inj.position);
    boost += criticality * 0.5;
  }
  return boost;
}

async function buildTeamProfile(prisma: PrismaClient, teamId: string): Promise<TeamProfile> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });

  const ladder2025 = await prisma.ladderEntry.findFirst({
    where: { teamId, season: '2025' },
    orderBy: { round: 'desc' },
  });

  const ladder2026 = await prisma.ladderEntry.findFirst({
    where: { teamId, season: '2026' },
    orderBy: { round: 'desc' },
  });

  const allFixtures = await prisma.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: 'completed',
    },
  });

  const hist = allFixtures.filter(f => f.roundId.startsWith('2024') || f.roundId.startsWith('2025'));
  const homeGames = hist.filter(f => f.homeTeamId === teamId);
  const awayGames = hist.filter(f => f.awayTeamId === teamId);

  const homeWins = homeGames.filter(f => f.result === 'home').length;
  const homeLosses = homeGames.length - homeWins;
  const awayWins = awayGames.filter(f => f.result === 'away').length;
  const awayLosses = awayGames.length - awayWins;

  const allPF = [...homeGames.map(f => f.homeScore ?? 0), ...awayGames.map(f => f.awayScore ?? 0)];
  const allPA = [...homeGames.map(f => f.awayScore ?? 0), ...awayGames.map(f => f.homeScore ?? 0)];
  const avgPF = allPF.length > 0 ? allPF.reduce((s, v) => s + v, 0) / allPF.length : 0;
  const avgPA = allPA.length > 0 ? allPA.reduce((s, v) => s + v, 0) / allPA.length : 0;

  // Recent form (last 5 from 2025)
  const recent2025 = allFixtures
    .filter(f => f.roundId.startsWith('2025'))
    .sort((a, b) => b.roundId.localeCompare(a.roundId))
    .slice(0, 10);

  const formStr = recent2025.map(f => {
    if ((f.homeTeamId === teamId && f.result === 'home') || (f.awayTeamId === teamId && f.result === 'away')) return 'W';
    if (f.result === 'draw') return 'D';
    return 'L';
  }).join('');

  // Active injuries
  const activeInjuries = await prisma.injury.findMany({
    where: {
      teamId,
      status: { in: ['out', 'doubtful', 'probable'] },
    },
  });

  const injuries: InjuryInfo[] = activeInjuries.map((inj: { playerName: string; position: string | null; severity: string | null; status: string; injuryType: string | null }) => ({
    playerName: inj.playerName,
    position: inj.position,
    severity: inj.severity,
    status: inj.status,
    injuryType: inj.injuryType,
  }));

  // Latest team stats (try 2025 first, then any season)
  const teamStat = await prisma.teamStat.findFirst({
    where: { teamId },
    orderBy: [{ season: 'desc' }, { roundId: 'desc' }],
  });

  return {
    id: teamId,
    name: team.shortName,
    ladderPos2025: ladder2025?.position ?? 17,
    wins2025: ladder2025?.wins ?? 0,
    losses2025: ladder2025?.losses ?? 0,
    pd2025: ladder2025?.pointsDiff ?? 0,
    homeWins,
    homeLosses,
    awayWins,
    awayLosses,
    avgPF,
    avgPA,
    titleOdds: parseTitleOdds(ladder2026?.titleOdds ?? null),
    streak2026: ladder2026?.streak ?? null,
    recentForm: formStr,
    injuries,
    completionRate: teamStat?.completionRate ?? null,
    tackleEfficiency: teamStat?.tackleEfficiency ?? null,
    errorCount: teamStat?.errorCount ?? null,
    penaltyCount: teamStat?.penaltyCount ?? null,
    possessionAvg: teamStat?.possessionAvg ?? null,
  };
}

async function getH2H(prisma: PrismaClient, homeId: string, awayId: string): Promise<string> {
  const games = await prisma.fixture.findMany({
    where: {
      OR: [
        { homeTeamId: homeId, awayTeamId: awayId },
        { homeTeamId: awayId, awayTeamId: homeId },
      ],
      status: 'completed',
      NOT: { roundId: { startsWith: '2026' } },
    },
  });

  if (games.length === 0) return 'No recent H2H data';

  let homeWins = 0, awayWins = 0;
  for (const g of games) {
    if ((g.homeTeamId === homeId && g.result === 'home') || (g.awayTeamId === homeId && g.result === 'away')) homeWins++;
    else if (g.result !== 'draw') awayWins++;
  }
  return `${homeWins}-${awayWins} in ${games.length} games (2024-25)`;
}

export async function predictMatch(
  prisma: PrismaClient,
  fixtureId: string,
  homeTeamId: string,
  awayTeamId: string,
  venue: string,
  matchOdds?: { homeOdds: number | null; awayOdds: number | null }
): Promise<MatchPrediction> {
  const home = await buildTeamProfile(prisma, homeTeamId);
  const away = await buildTeamProfile(prisma, awayTeamId);
  const h2h = await getH2H(prisma, homeTeamId, awayTeamId);

  const factors: PredictionFactor[] = [];
  let homeScore = 0;
  let awayScore = 0;

  // Factor 0: Match Odds from bookmakers (weight: 25 max — strongest signal)
  if (matchOdds?.homeOdds && matchOdds?.awayOdds) {
    const homeProb = 1 / matchOdds.homeOdds;
    const awayProb = 1 / matchOdds.awayOdds;
    const totalProb = homeProb + awayProb;
    const homeNorm = homeProb / totalProb;
    const oddsAdv = (homeNorm - 0.5) * 50; // -25 to +25
    const oddsWeight = Math.abs(oddsAdv);
    if (oddsAdv > 0) homeScore += oddsWeight; else awayScore += oddsWeight;
    factors.push({
      name: 'Match Odds (Bookmaker)',
      favouring: oddsAdv > 0 ? home.name : oddsAdv < 0 ? away.name : 'Even',
      weight: oddsWeight,
      detail: `${home.name} $${matchOdds.homeOdds.toFixed(2)} (${(homeNorm * 100).toFixed(0)}%) vs ${away.name} $${matchOdds.awayOdds.toFixed(2)} (${((1 - homeNorm) * 100).toFixed(0)}%)`,
    });
  }

  // Factor 1: 2025 Ladder Position (weight: 20 max)
  const ladderDiff = away.ladderPos2025 - home.ladderPos2025;
  const ladderWeight = Math.min(Math.abs(ladderDiff) * 1.5, 20);
  if (ladderDiff > 0) homeScore += ladderWeight; else awayScore += ladderWeight;
  factors.push({
    name: '2025 Ladder Position',
    favouring: ladderDiff > 0 ? home.name : ladderDiff < 0 ? away.name : 'Even',
    weight: ladderWeight,
    detail: `${home.name} #${home.ladderPos2025} vs ${away.name} #${away.ladderPos2025}`,
  });

  // Factor 2: Title Odds (weight: 15 max)
  const homeImplied = impliedProb(home.titleOdds);
  const awayImplied = impliedProb(away.titleOdds);
  const oddsTotal = homeImplied + awayImplied;
  if (oddsTotal > 0) {
    const oddsAdv = (homeImplied / oddsTotal - 0.5) * 30;
    const oddsWeight = Math.abs(oddsAdv);
    if (oddsAdv > 0) homeScore += oddsWeight; else awayScore += oddsWeight;
    factors.push({
      name: 'Premiership Odds',
      favouring: oddsAdv > 0 ? home.name : oddsAdv < 0 ? away.name : 'Even',
      weight: oddsWeight,
      detail: `${home.name} ${home.titleOdds ? '$' + home.titleOdds.toFixed(2) : 'N/A'} vs ${away.name} ${away.titleOdds ? '$' + away.titleOdds.toFixed(2) : 'N/A'}`,
    });
  }

  // Factor 3: Home/Away Record (weight: 15 max)
  const homeWinPctVal = winPct(home.homeWins, home.homeLosses);
  const awayWinPctVal = winPct(away.awayWins, away.awayLosses);
  const homeAdv = (homeWinPctVal - awayWinPctVal) * 15;
  if (homeAdv > 0) homeScore += homeAdv; else awayScore += Math.abs(homeAdv);
  factors.push({
    name: 'Home/Away Record',
    favouring: homeAdv > 0 ? home.name : homeAdv < 0 ? away.name : 'Even',
    weight: Math.abs(homeAdv),
    detail: `${home.name} home: ${home.homeWins}-${home.homeLosses} (${(homeWinPctVal * 100).toFixed(0)}%), ${away.name} away: ${away.awayWins}-${away.awayLosses} (${(awayWinPctVal * 100).toFixed(0)}%)`,
  });

  // Factor 4: Points Differential (weight: 15 max)
  const pdDiff = home.pd2025 - away.pd2025;
  const pdWeight = Math.min(Math.abs(pdDiff) / 30, 15);
  if (pdDiff > 0) homeScore += pdWeight; else awayScore += pdWeight;
  factors.push({
    name: 'Points Differential (2025)',
    favouring: pdDiff > 0 ? home.name : pdDiff < 0 ? away.name : 'Even',
    weight: pdWeight,
    detail: `${home.name} ${home.pd2025 > 0 ? '+' : ''}${home.pd2025} vs ${away.name} ${away.pd2025 > 0 ? '+' : ''}${away.pd2025}`,
  });

  // Factor 5: Recent Form (weight: 15 max)
  const homeFormRate = formWinRate(home.recentForm);
  const awayFormRate = formWinRate(away.recentForm);
  const formDiff = (homeFormRate - awayFormRate) * 15;
  if (formDiff > 0) homeScore += formDiff; else awayScore += Math.abs(formDiff);
  factors.push({
    name: 'Recent Form (last 5)',
    favouring: formDiff > 0 ? home.name : formDiff < 0 ? away.name : 'Even',
    weight: Math.abs(formDiff),
    detail: `${home.name} ${home.recentForm.slice(0, 5)} (${(homeFormRate * 100).toFixed(0)}%) vs ${away.name} ${away.recentForm.slice(0, 5)} (${(awayFormRate * 100).toFixed(0)}%)`,
  });

  // Factor 6: Attack vs Defence (weight: 10 max)
  const homeNet = home.avgPF - away.avgPA;
  const awayNet = away.avgPF - home.avgPA;
  const scoringEdge = (homeNet - awayNet) / 2;
  const scoringWeight = Math.min(Math.abs(scoringEdge) * 1.5, 10);
  if (scoringEdge > 0) homeScore += scoringWeight; else awayScore += scoringWeight;
  factors.push({
    name: 'Attack vs Defence Matchup',
    favouring: scoringEdge > 0 ? home.name : scoringEdge < 0 ? away.name : 'Even',
    weight: scoringWeight,
    detail: `${home.name} avg PF ${home.avgPF.toFixed(1)}/PA ${home.avgPA.toFixed(1)} vs ${away.name} avg PF ${away.avgPF.toFixed(1)}/PA ${away.avgPA.toFixed(1)}`,
  });

  // Factor 7: 2026 Momentum (weight: 10 max)
  const homeR1 = home.streak2026 === '1W' ? 1 : home.streak2026 === '1L' ? -1 : 0;
  const awayR1 = away.streak2026 === '1W' ? 1 : away.streak2026 === '1L' ? -1 : 0;
  const momentumDiff = (homeR1 - awayR1) * 5;
  if (momentumDiff !== 0) {
    if (momentumDiff > 0) homeScore += momentumDiff; else awayScore += Math.abs(momentumDiff);
    factors.push({
      name: '2026 Momentum',
      favouring: momentumDiff > 0 ? home.name : away.name,
      weight: Math.abs(momentumDiff),
      detail: `${home.name}: ${home.streak2026 ?? 'BYE'}, ${away.name}: ${away.streak2026 ?? 'BYE'}`,
    });
  }

  // Factor 8: Injury Impact (weight: 10 max)
  const homeBurden = calculateInjuryBurden(home.injuries);
  const awayBurden = calculateInjuryBurden(away.injuries);
  const homeReturnBoost = calculateReturnBoost(home.injuries);
  const awayReturnBoost = calculateReturnBoost(away.injuries);

  // Net injury advantage: opponent's burden helps you, your returns help you
  const homeInjuryNet = (awayBurden - homeBurden) + (homeReturnBoost - awayReturnBoost);
  const awayInjuryNet = -homeInjuryNet;

  const injuryWeight = Math.min(Math.abs(homeInjuryNet) * 3, 10);

  if (injuryWeight > 0.1) {
    if (homeInjuryNet > 0) homeScore += injuryWeight; else awayScore += injuryWeight;

    const homeOut = home.injuries.filter(i => i.status === 'out');
    const awayOut = away.injuries.filter(i => i.status === 'out');
    const homeDoubtful = home.injuries.filter(i => i.status === 'doubtful');
    const awayDoubtful = away.injuries.filter(i => i.status === 'doubtful');
    const homeReturning = home.injuries.filter(i => i.status === 'probable');
    const awayReturning = away.injuries.filter(i => i.status === 'probable');

    const detailParts: string[] = [];
    detailParts.push(`${home.name}: ${homeOut.length} out, ${homeDoubtful.length} doubtful, ${homeReturning.length} returning`);
    detailParts.push(`${away.name}: ${awayOut.length} out, ${awayDoubtful.length} doubtful, ${awayReturning.length} returning`);

    // List key absences (critical positions)
    const keyAbsences = [...home.injuries, ...away.injuries]
      .filter(i => i.status !== 'probable' && getPositionCriticality(i.position) >= 0.7)
      .map(i => `${i.playerName} (${i.position ?? 'unknown'})`)
      .slice(0, 4);
    if (keyAbsences.length > 0) {
      detailParts.push(`Key absences: ${keyAbsences.join(', ')}`);
    }

    factors.push({
      name: 'Injury Impact',
      favouring: homeInjuryNet > 0 ? home.name : awayInjuryNet > 0 ? away.name : 'Even',
      weight: injuryWeight,
      detail: detailParts.join('. '),
    });
  }

  // Factor 9: Playing Statistics (weight: 10 max)
  // Uses completion rate, tackle efficiency, errors, penalties, possession when available
  const hasHomeStats = home.completionRate != null || home.tackleEfficiency != null || home.errorCount != null || home.penaltyCount != null || home.possessionAvg != null;
  const hasAwayStats = away.completionRate != null || away.tackleEfficiency != null || away.errorCount != null || away.penaltyCount != null || away.possessionAvg != null;

  if (hasHomeStats && hasAwayStats) {
    let statsAdvantage = 0;
    const statDetails: string[] = [];

    // Completion rate (higher is better) — strong indicator of ball control
    if (home.completionRate != null && away.completionRate != null) {
      const compDiff = home.completionRate - away.completionRate;
      statsAdvantage += compDiff * 0.3; // scaled: 5% difference ≈ 1.5pts
      statDetails.push(`Completion: ${home.name} ${home.completionRate.toFixed(1)}% vs ${away.name} ${away.completionRate.toFixed(1)}%`);
    }

    // Tackle efficiency (higher is better)
    if (home.tackleEfficiency != null && away.tackleEfficiency != null) {
      const tackleDiff = home.tackleEfficiency - away.tackleEfficiency;
      statsAdvantage += tackleDiff * 0.2;
      statDetails.push(`Tackles: ${home.name} ${home.tackleEfficiency.toFixed(1)}% vs ${away.name} ${away.tackleEfficiency.toFixed(1)}%`);
    }

    // Errors (lower is better — inverted)
    if (home.errorCount != null && away.errorCount != null) {
      const errorDiff = away.errorCount - home.errorCount; // opponent errors help you
      statsAdvantage += errorDiff * 0.15;
      statDetails.push(`Errors: ${home.name} ${home.errorCount} vs ${away.name} ${away.errorCount}`);
    }

    // Penalties conceded (lower is better — inverted)
    if (home.penaltyCount != null && away.penaltyCount != null) {
      const penDiff = away.penaltyCount - home.penaltyCount; // opponent penalties help you
      statsAdvantage += penDiff * 0.15;
      statDetails.push(`Penalties: ${home.name} ${home.penaltyCount} vs ${away.name} ${away.penaltyCount}`);
    }

    // Possession (higher is better)
    if (home.possessionAvg != null && away.possessionAvg != null) {
      const possDiff = home.possessionAvg - away.possessionAvg;
      statsAdvantage += possDiff * 0.2;
      statDetails.push(`Possession: ${home.name} ${home.possessionAvg.toFixed(1)}% vs ${away.name} ${away.possessionAvg.toFixed(1)}%`);
    }

    const statsWeight = Math.min(Math.abs(statsAdvantage), 10);
    if (statsWeight > 0.1) {
      if (statsAdvantage > 0) homeScore += statsWeight; else awayScore += statsWeight;
      factors.push({
        name: 'Playing Statistics',
        favouring: statsAdvantage > 0 ? home.name : statsAdvantage < 0 ? away.name : 'Even',
        weight: statsWeight,
        detail: statDetails.join('. '),
      });
    }
  }

  // Baseline home advantage
  homeScore += 3;
  factors.push({
    name: 'Home Ground Baseline',
    favouring: home.name,
    weight: 3,
    detail: 'Standard NRL home advantage (~55% historical win rate)',
  });

  factors.sort((a, b) => b.weight - a.weight);

  const total = homeScore + awayScore;
  const winnerPct = Math.max(homeScore, awayScore) / total * 100;
  const confidenceScore = Math.min(Math.round(winnerPct), 95);
  const isHomeWinner = homeScore >= awayScore;
  const predictedWinner = isHomeWinner ? home.name : away.name;
  const predictedWinnerId = isHomeWinner ? home.id : away.id;

  return {
    fixtureId,
    homeTeam: home,
    awayTeam: away,
    venue,
    h2h,
    predictedWinner,
    predictedWinnerId,
    confidence: confidenceLabel(confidenceScore),
    confidenceScore,
    factors,
    summary: `${predictedWinner} predicted to win at ${venue}. Key factors: ${factors.slice(0, 3).map(f => f.name).join(', ')}.`,
  };
}

/**
 * Generate predictions for all upcoming fixtures in a given round.
 */
export async function predictRound(
  prisma: PrismaClient,
  season: string = '2026',
  roundNum?: number
): Promise<MatchPrediction[]> {
  let roundId: string;
  if (roundNum) {
    roundId = `${season}-R${roundNum}`;
  } else {
    // Find the earliest round with upcoming fixtures by joining to Round table
    const round = await prisma.round.findFirst({
      where: {
        seasonId: season,
        fixtures: { some: { status: 'upcoming' } },
      },
      orderBy: { number: 'asc' },
    });
    roundId = round?.id ?? `${season}-R1`;
  }

  const fixtures = await prisma.fixture.findMany({
    where: { roundId, status: 'upcoming' },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoff: 'asc' },
  });

  const predictions: MatchPrediction[] = [];
  for (const f of fixtures) {
    const prediction = await predictMatch(
      prisma, f.id, f.homeTeamId, f.awayTeamId, f.venue ?? 'TBA',
      { homeOdds: f.homeOdds, awayOdds: f.awayOdds }
    );
    predictions.push(prediction);
  }

  return predictions;
}
