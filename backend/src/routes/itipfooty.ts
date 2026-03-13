import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { submitTips, isConfigured } from '../services/itipfooty.js';

export const itipfootyRoutes = Router();

// GET /api/itipfooty/status — check if integration is configured
itipfootyRoutes.get('/status', (_req, res) => {
  res.json({
    configured: isConfigured(),
    compId: process.env.ITIPFOOTY_COMP_ID ?? null,
    username: process.env.ITIPFOOTY_USERNAME ? '***' : null,
  });
});

// POST /api/itipfooty/submit — submit tips for a round
itipfootyRoutes.post('/submit', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({
        error:
          'iTipFooty not configured. Set ITIPFOOTY_USERNAME, ITIPFOOTY_PASSWORD, ITIPFOOTY_COMP_ID in .env',
      });
    }

    const round = req.body.round ? parseInt(req.body.round, 10) : undefined;
    const result = await submitTips(prisma, round);

    res.json(result);
  } catch (err) {
    console.error('iTipFooty submit error:', err);
    res.status(500).json({
      error: 'Failed to submit tips',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
