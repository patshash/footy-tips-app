import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

export const ladderRoutes = Router();

// GET / - Current ladder, query by season/round
ladderRoutes.get('/', async (req, res) => {
  try {
    const { season, round } = req.query;

    const where: Record<string, unknown> = {};
    if (season) where.season = season as string;
    if (round) where.round = parseInt(round as string, 10);

    // If no round specified, get the latest round available
    if (!round) {
      const seasonFilter = season ? { season: season as string } : {};
      const latestEntry = await prisma.ladderEntry.findFirst({
        where: seasonFilter,
        orderBy: { round: 'desc' },
      });
      if (latestEntry) {
        where.round = latestEntry.round;
        if (!season) where.season = latestEntry.season;
      }
    }

    const ladder = await prisma.ladderEntry.findMany({
      where,
      include: { team: true },
      orderBy: { position: 'asc' },
    });

    res.json(ladder);
  } catch (error) {
    console.error('Error fetching ladder:', error);
    res.status(500).json({ error: 'Failed to fetch ladder' });
  }
});
