import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Info, Download, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import Card from '../components/Card';
import Badge from '../components/Badge';
import { cn } from '../lib/utils';
import { useState, useEffect, useRef } from 'react';

export default function Settings() {
  const queryClient = useQueryClient();
  const [scrapeTargets, setScrapeTargets] = useState<string[]>(['all']);
  const wasImporting = useRef(false);

  const { data: plugins = [], isLoading } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.getPlugins(),
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
  });

  const { data: scrapeStatus } = useQuery({
    queryKey: ['scrapeStatus'],
    queryFn: () => api.getScrapeStatus(),
    refetchInterval: (query) => query.state.data?.historicalImport?.running ? 3000 : 10000,
  });

  // When historical import finishes, refresh predictions and team stats
  useEffect(() => {
    const isRunning = scrapeStatus?.historicalImport?.running ?? false;
    if (wasImporting.current && !isRunning) {
      queryClient.invalidateQueries({ queryKey: ['predictions'] });
      queryClient.invalidateQueries({ queryKey: ['ladder'] });
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['scrapeLogs'] });
    }
    wasImporting.current = isRunning;
  }, [scrapeStatus?.historicalImport?.running, queryClient]);

  const { data: scrapeLogs = [] } = useQuery({
    queryKey: ['scrapeLogs'],
    queryFn: () => api.getScrapeLogs(10),
  });

  const togglePlugin = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updatePlugin(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plugins'] }),
  });

  const scrape = useMutation({
    mutationFn: (targets: string[]) => api.triggerScrape({ targets }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scrapeStatus'] });
      queryClient.invalidateQueries({ queryKey: ['scrapeLogs'] });
      queryClient.invalidateQueries({ queryKey: ['ladder'] });
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['predictions'] });
    },
  });

  const targetOptions = [
    { value: 'all', label: 'All Sources' },
    { value: 'ladder', label: 'Ladder Only' },
    { value: 'fixtures', label: 'Fixtures Only' },
    { value: 'team-stats', label: 'Team Stats' },
    { value: 'historical', label: 'Historical (2024-2026)' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Scrape Controls */}
      <Card title="Data Scraper" subtitle="Fetch latest data from NRL.com on demand">
        <div className="space-y-4">
          {/* Target selection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Scrape Target</label>
            <div className="flex flex-wrap gap-2">
              {targetOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setScrapeTargets([opt.value])}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    scrapeTargets.includes(opt.value)
                      ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrape button */}
          <button
            onClick={() => scrape.mutate(scrapeTargets)}
            disabled={scrape.isPending}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all',
              scrape.isPending
                ? 'cursor-not-allowed bg-zinc-700'
                : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'
            )}
          >
            {scrape.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            {scrape.isPending ? 'Scraping...' : 'Scrape Now'}
          </button>

          {/* Last result */}
          {scrape.isSuccess && (
            <div className={cn(
              'rounded-lg border p-3 text-sm',
              scrape.data.status === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : scrape.data.status === 'partial'
                ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            )}>
              <p className="font-medium">
                {scrape.data.status === 'success' ? '✓ Scrape completed' : scrape.data.status === 'partial' ? '⚠ Partial success' : '✗ Scrape failed'}
              </p>
              <p className="mt-1 text-xs opacity-80">
                {scrape.data.totalRecords} records updated, {scrape.data.totalErrors} errors
              </p>
              {scrape.data.results?.map((r: any, i: number) => (
                <p key={i} className="mt-1 text-xs opacity-70">
                  {r.type}: {r.details || r.errors?.join(', ') || 'no details'}
                </p>
              ))}
            </div>
          )}

          {scrape.isError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <p className="font-medium">✗ Scrape request failed</p>
              <p className="mt-1 text-xs opacity-80">{(scrape.error as Error).message}</p>
            </div>
          )}

          {/* Last run info */}
          {scrapeStatus?.lastRun && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Clock size={12} />
              <span>Last run: {new Date(scrapeStatus.lastRun).toLocaleString()}</span>
            </div>
          )}

          {/* Historical import progress */}
          {scrapeStatus?.historicalImport?.running && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-300">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                <p className="font-medium">Historical import in progress...</p>
              </div>
              <div className="mt-2 max-h-32 overflow-y-auto text-xs opacity-80">
                {scrapeStatus.historicalImport.progress?.map((msg: string, i: number) => (
                  <p key={i}>{msg}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Scrape History */}
      {scrapeLogs.length > 0 && (
        <Card title="Scrape History" subtitle="Recent data fetch results">
          <div className="space-y-2">
            {scrapeLogs.map((log: any) => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {log.status === 'success' ? (
                    <CheckCircle size={14} className="text-emerald-500" />
                  ) : (
                    <AlertCircle size={14} className="text-red-400" />
                  )}
                  <div>
                    <span className="text-sm font-medium">{log.source}</span>
                    <p className="text-xs text-zinc-500">
                      {log.message || `${log.recordsAffected} records`}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-zinc-500">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Plugins */}
      <Card title="Plugins" subtitle="Manage data source plugins">
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
          </div>
        )}
        {!isLoading && plugins.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500">No plugins configured.</p>
        )}
        <div className="space-y-3">
          {plugins.map((plugin: any) => (
            <div
              key={plugin.id}
              className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-700">
                  <Plug size={16} className="text-zinc-400" />
                </div>
                <div>
                  <p className="font-medium">{plugin.name}</p>
                  <p className="text-xs text-zinc-500">{plugin.description || plugin.type}</p>
                </div>
              </div>
              <button
                onClick={() =>
                  togglePlugin.mutate({ id: plugin.id, enabled: !plugin.enabled })
                }
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  plugin.enabled ? 'bg-emerald-500' : 'bg-zinc-600'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
                    plugin.enabled ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Data source status */}
      <Card title="Data Sources" subtitle="Connection status and last sync times">
        {health ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 p-4">
              <div className="flex items-center gap-3">
                <RefreshCw size={16} className="text-emerald-500" />
                <div>
                  <p className="text-sm font-medium">API Server</p>
                  <p className="text-xs text-zinc-500">
                    {health.uptime ? `Uptime: ${Math.round(health.uptime / 60)}m` : 'Connected'}
                  </p>
                </div>
              </div>
              <Badge variant="success">Online</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 p-4">
              <div className="flex items-center gap-3">
                <RefreshCw size={16} className="text-emerald-500" />
                <div>
                  <p className="text-sm font-medium">Database</p>
                  <p className="text-xs text-zinc-500">
                    {health.database || 'SQLite'}
                  </p>
                </div>
              </div>
              <Badge variant={health.status === 'ok' ? 'success' : 'danger'}>
                {health.status === 'ok' ? 'Connected' : 'Error'}
              </Badge>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-zinc-500">
            Unable to fetch health status.
          </p>
        )}
      </Card>

      {/* About */}
      <Card title="About">
        <div className="flex items-start gap-3">
          <Info size={18} className="mt-0.5 text-zinc-400" />
          <div className="text-sm text-zinc-400">
            <p className="font-medium text-white">Footy Tips App</p>
            <p className="mt-1">
              A personal AFL/NRL tipping assistant that helps you track fixtures, make
              data-driven picks, and analyze your tipping performance.
            </p>
            <p className="mt-2 text-xs text-zinc-500">Version 0.1.0</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
