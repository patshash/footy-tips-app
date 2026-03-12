import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Target, ChevronDown, ChevronUp, Trophy, Home, BarChart3 } from 'lucide-react';
import { api } from '../services/api';
import Card from '../components/Card';
import Badge from '../components/Badge';
import { cn } from '../lib/utils';
import { useState } from 'react';

const confidenceColors: Record<string, { bg: string; text: string; border: string }> = {
  'VERY HIGH': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/40' },
  'HIGH': { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/40' },
  'MEDIUM': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/40' },
  'LOW': { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40' },
};

const confidenceEmoji: Record<string, string> = {
  'VERY HIGH': '🔥',
  'HIGH': '✅',
  'MEDIUM': '⚡',
  'LOW': '⚠️',
};

function FactorBar({ factor }: { factor: any }) {
  const maxWeight = 20;
  const pct = Math.min((factor.weight / maxWeight) * 100, 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300">{factor.name}</span>
        <span className="text-zinc-500">{factor.weight.toFixed(1)}pts → {factor.favouring}</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/60"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500">{factor.detail}</p>
    </div>
  );
}

function PredictionCard({ prediction }: { prediction: any }) {
  const [expanded, setExpanded] = useState(false);
  const colors = confidenceColors[prediction.confidence] ?? confidenceColors['LOW'];
  const emoji = confidenceEmoji[prediction.confidence] ?? '❓';

  const isHomePick = prediction.predictedWinnerId === prediction.homeTeam.id;

  return (
    <div className={cn('rounded-xl border bg-zinc-900 transition-all', colors.border)}>
      {/* Match header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className={cn('text-lg font-bold', isHomePick ? 'text-emerald-400' : 'text-zinc-300')}>
              {prediction.homeTeam.name}
            </div>
            <span className="text-sm text-zinc-600">vs</span>
            <div className={cn('text-lg font-bold', !isHomePick ? 'text-emerald-400' : 'text-zinc-300')}>
              {prediction.awayTeam.name}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Home size={10} />
              {prediction.venue}
            </span>
            <span>H2H: {prediction.h2h}</span>
          </div>
        </div>

        {/* Prediction badge */}
        <div className={cn('flex flex-col items-end gap-1')}>
          <div className={cn('rounded-lg px-3 py-1.5 text-sm font-bold', colors.bg, colors.text)}>
            {emoji} {prediction.predictedWinner}
          </div>
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <Target size={10} />
            {prediction.confidenceScore}% {prediction.confidence}
          </div>
        </div>
      </div>

      {/* Team comparison bar */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>#{prediction.homeTeam.ladderPos2025}</span>
          <div className="flex-1">
            <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
              <div
                className="bg-emerald-500/50 transition-all"
                style={{ width: `${prediction.confidenceScore}%` }}
              />
              <div
                className="bg-red-500/30 transition-all"
                style={{ width: `${100 - prediction.confidenceScore}%` }}
              />
            </div>
          </div>
          <span>#{prediction.awayTeam.ladderPos2025}</span>
        </div>
      </div>

      {/* Expand/collapse factors */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-center gap-1 border-t border-zinc-800 py-2 text-xs text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-400 transition-colors"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Hide analysis' : 'Show analysis'}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-800 p-4">
          {/* Key stats comparison */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-zinc-800 p-2">
              <p className="text-zinc-500">2025 Record</p>
              <p className="font-mono text-zinc-300">{prediction.homeTeam.wins2025}-{prediction.homeTeam.losses2025}</p>
              <p className="font-mono text-zinc-300">{prediction.awayTeam.wins2025}-{prediction.awayTeam.losses2025}</p>
            </div>
            <div className="rounded-lg bg-zinc-800 p-2">
              <p className="text-zinc-500">Form (L5)</p>
              <p className="font-mono text-zinc-300">{prediction.homeTeam.recentForm.slice(0, 5) || '-'}</p>
              <p className="font-mono text-zinc-300">{prediction.awayTeam.recentForm.slice(0, 5) || '-'}</p>
            </div>
            <div className="rounded-lg bg-zinc-800 p-2">
              <p className="text-zinc-500">Title Odds</p>
              <p className="font-mono text-zinc-300">{prediction.homeTeam.titleOdds ? `$${prediction.homeTeam.titleOdds}` : '-'}</p>
              <p className="font-mono text-zinc-300">{prediction.awayTeam.titleOdds ? `$${prediction.awayTeam.titleOdds}` : '-'}</p>
            </div>
          </div>

          {/* Injury summary */}
          {(prediction.homeTeam.injuries?.length > 0 || prediction.awayTeam.injuries?.length > 0) && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-zinc-800 p-2">
                <p className="text-zinc-500 mb-1">{prediction.homeTeam.name} Injuries</p>
                {prediction.homeTeam.injuries?.length > 0 ? (
                  prediction.homeTeam.injuries.map((inj: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-0.5">
                      <span className="text-zinc-300">{inj.playerName}</span>
                      <span className={cn(
                        'text-[10px] uppercase font-medium',
                        inj.status === 'out' ? 'text-red-400' : inj.status === 'doubtful' ? 'text-amber-400' : 'text-emerald-400'
                      )}>
                        {inj.status === 'probable' ? '✓ returning' : inj.status}
                        {inj.position ? ` · ${inj.position}` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-600">No injuries</p>
                )}
              </div>
              <div className="rounded-lg bg-zinc-800 p-2">
                <p className="text-zinc-500 mb-1">{prediction.awayTeam.name} Injuries</p>
                {prediction.awayTeam.injuries?.length > 0 ? (
                  prediction.awayTeam.injuries.map((inj: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-0.5">
                      <span className="text-zinc-300">{inj.playerName}</span>
                      <span className={cn(
                        'text-[10px] uppercase font-medium',
                        inj.status === 'out' ? 'text-red-400' : inj.status === 'doubtful' ? 'text-amber-400' : 'text-emerald-400'
                      )}>
                        {inj.status === 'probable' ? '✓ returning' : inj.status}
                        {inj.position ? ` · ${inj.position}` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-600">No injuries</p>
                )}
              </div>
            </div>
          )}

          {/* Factors */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-400">Contributing Factors</p>
            {prediction.factors.map((factor: any, i: number) => (
              <FactorBar key={i} factor={factor} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Predictions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['predictions'],
    queryFn: () => api.getPredictions(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Round Predictions</h1>
          <p className="text-sm text-zinc-500">AI-powered match predictions based on historical data</p>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp size={20} className="text-emerald-500" />
          {data && (
            <span className="text-sm text-zinc-400">{data.totalMatches} matches</span>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
        </div>
      )}

      {error && (
        <Card>
          <p className="text-center text-red-400">Failed to load predictions: {(error as Error).message}</p>
        </Card>
      )}

      {data && (
        <>
          {/* Summary strip */}
          <Card title="Tips at a Glance" subtitle="Quick picks for this round">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {data.summary.map((s: any, i: number) => {
                const colors = confidenceColors[s.confidence] ?? confidenceColors['LOW'];
                const emoji = confidenceEmoji[s.confidence] ?? '❓';
                return (
                  <div key={i} className={cn('flex items-center justify-between rounded-lg border px-3 py-2', colors.border, colors.bg)}>
                    <div className="text-xs">
                      <p className="text-zinc-400">{s.match}</p>
                      <p className={cn('font-bold', colors.text)}>{emoji} {s.pick}</p>
                    </div>
                    <span className={cn('text-sm font-bold', colors.text)}>{s.confidenceScore}%</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Confidence breakdown */}
          <div className="grid grid-cols-4 gap-3">
            {(['VERY HIGH', 'HIGH', 'MEDIUM', 'LOW'] as const).map(level => {
              const count = data.summary.filter((s: any) => s.confidence === level).length;
              const colors = confidenceColors[level];
              return (
                <div key={level} className={cn('rounded-lg border p-3 text-center', colors.border, colors.bg)}>
                  <p className={cn('text-2xl font-bold', colors.text)}>{count}</p>
                  <p className="text-xs text-zinc-500">{level}</p>
                </div>
              );
            })}
          </div>

          {/* Detailed predictions */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Detailed Analysis</h2>
            {data.predictions.map((p: any) => (
              <PredictionCard key={p.fixtureId} prediction={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
