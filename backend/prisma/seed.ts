import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const teams = [
  { id: 'BRI', name: 'Brisbane Broncos', shortName: 'Broncos', homeGround: 'Suncorp Stadium' },
  { id: 'CAN', name: 'Canberra Raiders', shortName: 'Raiders', homeGround: 'GIO Stadium' },
  { id: 'CBY', name: 'Canterbury-Bankstown Bulldogs', shortName: 'Bulldogs', homeGround: 'Belmore Sports Ground' },
  { id: 'CRO', name: 'Cronulla-Sutherland Sharks', shortName: 'Sharks', homeGround: 'PointsBet Stadium' },
  { id: 'DOL', name: 'Dolphins', shortName: 'Dolphins', homeGround: 'Suncorp Stadium' },
  { id: 'GLD', name: 'Gold Coast Titans', shortName: 'Titans', homeGround: 'Cbus Super Stadium' },
  { id: 'MAN', name: 'Manly Warringah Sea Eagles', shortName: 'Sea Eagles', homeGround: '4 Pines Park' },
  { id: 'MEL', name: 'Melbourne Storm', shortName: 'Storm', homeGround: 'AAMI Park' },
  { id: 'NEW', name: 'Newcastle Knights', shortName: 'Knights', homeGround: 'McDonald Jones Stadium' },
  { id: 'NZW', name: 'New Zealand Warriors', shortName: 'Warriors', homeGround: 'Go Media Stadium' },
  { id: 'NQL', name: 'North Queensland Cowboys', shortName: 'Cowboys', homeGround: 'Qld Country Bank Stadium' },
  { id: 'PAR', name: 'Parramatta Eels', shortName: 'Eels', homeGround: 'CommBank Stadium' },
  { id: 'PEN', name: 'Penrith Panthers', shortName: 'Panthers', homeGround: 'BlueBet Stadium' },
  { id: 'SOU', name: 'South Sydney Rabbitohs', shortName: 'Rabbitohs', homeGround: 'Accor Stadium' },
  { id: 'SGI', name: 'St George Illawarra Dragons', shortName: 'Dragons', homeGround: 'WIN Stadium' },
  { id: 'SYD', name: 'Sydney Roosters', shortName: 'Roosters', homeGround: 'Sydney Football Stadium' },
  { id: 'WST', name: 'Wests Tigers', shortName: 'Tigers', homeGround: 'Campbelltown Stadium' },
];

const round1Fixtures = [
  { home: 'BRI', away: 'MEL', venue: 'Suncorp Stadium' },
  { home: 'PEN', away: 'CRO', venue: 'BlueBet Stadium' },
  { home: 'SYD', away: 'CBY', venue: 'Sydney Football Stadium' },
  { home: 'MAN', away: 'CAN', venue: '4 Pines Park' },
  { home: 'PAR', away: 'NQL', venue: 'CommBank Stadium' },
  { home: 'NEW', away: 'DOL', venue: 'McDonald Jones Stadium' },
  { home: 'GLD', away: 'SGI', venue: 'Cbus Super Stadium' },
  { home: 'NZW', away: 'WST', venue: 'Go Media Stadium' },
];

async function main() {
  console.log('Seeding database...');

  // Create seasons 2024-2026
  for (const yr of [2024, 2025, 2026]) {
    await prisma.season.upsert({
      where: { id: String(yr) },
      update: {},
      create: {
        id: String(yr),
        year: yr,
        current: yr === 2026,
      },
    });

    // Create rounds 1-27 per season
    for (let i = 1; i <= 27; i++) {
      await prisma.round.upsert({
        where: { id: `${yr}-R${i}` },
        update: {},
        create: {
          id: `${yr}-R${i}`,
          seasonId: String(yr),
          number: i,
          name: `Round ${i}`,
          isCurrent: yr === 2026 && i === 1,
        },
      });
    }
  }
  console.log('Created seasons 2024-2026 with 27 rounds each');

  // Create teams
  for (const team of teams) {
    await prisma.team.upsert({
      where: { id: team.id },
      update: {},
      create: team,
    });
  }
  console.log(`Created ${teams.length} teams`);

  // Create Round 1 fixtures
  for (const fixture of round1Fixtures) {
    const existing = await prisma.fixture.findFirst({
      where: {
        roundId: '2026-R1',
        homeTeamId: fixture.home,
        awayTeamId: fixture.away,
      },
    });

    if (!existing) {
      await prisma.fixture.create({
        data: {
          roundId: '2026-R1',
          homeTeamId: fixture.home,
          awayTeamId: fixture.away,
          venue: fixture.venue,
          status: 'upcoming',
        },
      });
    }
  }
  console.log(`Created ${round1Fixtures.length} Round 1 fixtures`);

  // Create pre-season ladder entries (all zeros)
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    await prisma.ladderEntry.upsert({
      where: {
        teamId_season_round: {
          teamId: team.id,
          season: '2026',
          round: 0,
        },
      },
      update: {},
      create: {
        teamId: team.id,
        season: '2026',
        round: 0,
        position: i + 1,
      },
    });
  }
  console.log('Created pre-season ladder entries');

  // Register NRL scraper plugin (enabled by default)
  await prisma.pluginConfig.upsert({
    where: { id: 'nrl-scraper' },
    update: {
      config: JSON.stringify({
        sources: {
          nrlApi: {
            baseUrl: 'https://www.nrl.com',
            endpoints: {
              draw: '/draw/data',
              ladder: '/ladder/data',
              stats: '/stats/data',
            },
            competitionId: 111,
          },
          rlp: {
            baseUrl: 'https://rugbyleagueproject.org',
            endpoints: {
              season: '/seasons/nrl-{year}/summary.html',
              round: '/seasons/nrl-{year}/round-{round}/summary.html',
              match: '/matches/{id}',
            },
          },
        },
        historicalYears: [2024, 2025, 2026],
      }),
      enabled: true,
    },
    create: {
      id: 'nrl-scraper',
      name: 'NRL Data Scraper',
      type: 'data-source',
      enabled: true,
      config: JSON.stringify({
        sources: {
          nrlApi: {
            baseUrl: 'https://www.nrl.com',
            endpoints: {
              draw: '/draw/data',
              ladder: '/ladder/data',
              stats: '/stats/data',
            },
            competitionId: 111,
          },
          rlp: {
            baseUrl: 'https://rugbyleagueproject.org',
            endpoints: {
              season: '/seasons/nrl-{year}/summary.html',
              round: '/seasons/nrl-{year}/round-{round}/summary.html',
              match: '/matches/{id}',
            },
          },
        },
        historicalYears: [2024, 2025, 2026],
      }),
      schedule: '0 */6 * * *',
    },
  });
  console.log('Registered NRL scraper plugin');

  console.log('Seeding complete!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
