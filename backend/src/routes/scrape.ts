import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { scrapeLadder, scrapeFixtures, scrapeAll, scrapeHistorical, scrapeTeamStats } from '../services/scraper.js';

export const scrapeRoutes = Router();

// Track active historical imports
let historicalImportRunning = false;
let historicalProgress: string[] = [];

// POST /api/scrape — trigger a scrape on command
// Body: { "targets": ["ladder", "fixtures", "all", "historical"], "season": "2026", "round": 1 }
scrapeRoutes.post('/', async (req, res) => {
  try {
    const { targets = ['all'], season = '2026', round } = req.body;
    const targetList: string[] = Array.isArray(targets) ? targets : [targets];

    // Historical import is long-running — handle it async
    if (targetList.includes('historical')) {
      if (historicalImportRunning) {
        res.json({
          status: 'already_running',
          message: 'Historical import is already in progress',
          progress: historicalProgress,
        });
        return;
      }

      historicalImportRunning = true;
      historicalProgress = ['Starting historical import...'];

      // Run in background, respond immediately
      scrapeHistorical(prisma, 2025, 2025, (msg) => {
        historicalProgress.push(msg);
        console.log(`[historical] ${msg}`);
      })
        .then(async (results) => {
          // Log results
          for (const r of results) {
            if (r.recordsAffected > 0 || r.errors.length > 0) {
              await prisma.dataSourceLog.create({
                data: {
                  source: `${r.source}/${r.type}`,
                  status: r.errors.length === 0 ? 'success' : (r.recordsAffected > 0 ? 'partial' : 'error'),
                  message: r.errors.length > 0 ? r.errors.slice(0, 5).join('; ') : r.details,
                  recordsAffected: r.recordsAffected,
                },
              });
            }
          }

          const totalRecords = results.reduce((sum, r) => sum + r.recordsAffected, 0);
          historicalProgress.push(`Complete! ${totalRecords} total records imported.`);
          console.log(`[historical] Complete — ${totalRecords} records`);
        })
        .catch((err) => {
          historicalProgress.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
          console.error('[historical] Error:', err);
        })
        .finally(() => {
          historicalImportRunning = false;
        });

      res.json({
        status: 'started',
        message: 'Historical import started (2025). Check /api/scrape/status for progress.',
      });
      return;
    }

    const results = [];

    for (const target of targetList) {
      switch (target) {
        case 'ladder':
          results.push(await scrapeLadder(prisma, season));
          break;
        case 'fixtures':
          results.push(await scrapeFixtures(prisma, season, round));
          break;
        case 'team-stats':
          results.push(await scrapeTeamStats(prisma, season));
          break;
        case 'all':
          results.push(...await scrapeAll(prisma, season));
          break;
        default:
          results.push({
            source: 'unknown',
            type: target,
            recordsAffected: 0,
            errors: [`Unknown scrape target: "${target}"`],
            details: '',
          });
      }
    }

    // Log each result to DataSourceLog
    for (const r of results) {
      await prisma.dataSourceLog.create({
        data: {
          source: `${r.source}/${r.type}`,
          status: r.errors.length === 0 ? 'success' : (r.recordsAffected > 0 ? 'partial' : 'error'),
          message: r.errors.length > 0 ? r.errors.join('; ') : r.details,
          recordsAffected: r.recordsAffected,
        },
      });
    }

    // Update lastRun on the nrl-scraper plugin config
    await prisma.pluginConfig.updateMany({
      where: { id: 'nrl-scraper' },
      data: { lastRun: new Date() },
    });

    const totalRecords = results.reduce((sum, r) => sum + r.recordsAffected, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    res.json({
      status: totalErrors === 0 ? 'success' : (totalRecords > 0 ? 'partial' : 'error'),
      totalRecords,
      totalErrors,
      results,
    });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: 'Scrape failed', message: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/scrape/logs — view scrape history
scrapeRoutes.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const logs = await prisma.dataSourceLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// GET /api/scrape/status — current scraper status
scrapeRoutes.get('/status', async (_req, res) => {
  try {
    const plugin = await prisma.pluginConfig.findUnique({ where: { id: 'nrl-scraper' } });
    const lastLog = await prisma.dataSourceLog.findFirst({ orderBy: { createdAt: 'desc' } });
    const recentLogs = await prisma.dataSourceLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    res.json({
      enabled: plugin?.enabled ?? false,
      schedule: plugin?.schedule ?? null,
      lastRun: plugin?.lastRun ?? null,
      lastResult: lastLog,
      recentHistory: recentLogs,
      historicalImport: {
        running: historicalImportRunning,
        progress: historicalProgress,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});
