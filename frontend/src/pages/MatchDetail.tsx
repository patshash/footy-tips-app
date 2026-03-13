import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2, Save, AlertCircle, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../services/api';
import Card from '../components/Card';
import Badge from '../components/Badge';
import TeamLogo from '../components/TeamLogo';
import ConfidenceBadge from '../components/ConfidenceBadge';
import { cn } from '../lib/utils';

const FACTORS = [
  { key: 'form', label: 'Recent Form' },
  { key: 'h2h', label: 'Head to Head' },
  { key: 'injuries', label: 'Injuries' },
  { key: 'homeAdvantage', label: 'Home Advantage' },
  { key: 'ladderPosition', label: 'Ladder Position' },
] as const;

type FactorValue = 'home' | 'away' | 'neutral';

export default function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: fixture, isLoading } = useQuery({
    queryKey: ['fixture', id],
    queryFn: () => api.getFixture(id!),
    enabled: !!id,
  });

  const { data: picks = [] } = useQuery({
    queryKey: ['picks', 'fixture', id],
    queryFn: () => api.getPicks({ fixtureId: id! }),
    enabled: !!id,
  });

  const existingPick = picks[0];

  const { data: homeInjuries = [] } = useQuery({
    queryKey: ['injuries', 'home', fixture?.homeTeamId],
    queryFn: () => api.getInjuries({ teamId: fixture!.homeTeamId }),
    enabled: !!fixture?.homeTeamId,
  });

  const { data: awayInjuries = [] } = useQuery({
    queryKey: ['injuries', 'away', fixture?.awayTeamId],
    queryFn: () => api.getInjuries({ teamId: fixture!.awayTeamId }),
    enabled: !!fixture?.awayTeamId,
  });

  const [confidence, setConfidence] = useState<'low' | 'medium' | 'high'>(
    existingPick?.confidence || 'medium'
  );
  const [pickedTeamId, setPickedTeamId] = useState<string>(existingPick?.pickedTeamId || '');
  const [notes, setNotes] = useState(existingPick?.notes || '');
  const [factors, setFactors] = useState<Record<string, FactorValue>>(
    existingPick?.factors || {}
  );

  // Sync state when pick loads
  const pickLoaded = existingPick?.id;
  useEffect(() => {
    if (existingPick) {
      setConfidence(existingPick.confidence || 'medium');
      setPickedTeamId(existingPick.pickedTeamId || '');
      setNotes(existingPick.notes || '');
      setFactors(existingPick.factors || {});
    }
  }, [pickLoaded]);

  const createPick = useMutation({
    mutationFn: (data: any) => api.createPick(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['picks'] }),
  });

  const updatePick = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updatePick(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['picks'] }),
  });

  const deletePick = useMutation({
    mutationFn: (id: string) => api.deletePick(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['picks'] });
      setPickedTeamId('');
      setConfidence('medium');
      setNotes('');
      setFactors({});
    },
  });

  function handleSubmit() {
    const data = {
      fixtureId: id,
      pickedTeamId,
      confidence,
      notes,
      factors,
    };

    if (existingPick) {
      updatePick.mutate({ id: existingPick.id, data });
    } else {
      createPick.mutate(data);
    }
  }

  function toggleFactor(key: string) {
    setFactors((prev) => {
      const current = prev[key];
      const next: FactorValue =
        current === 'home' ? 'away' : current === 'away' ? 'neutral' : 'home';
      return { ...prev, [key]: next };
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
      </div>
    );
  }

  if (!fixture) {
    return (
      <div className="py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-zinc-600" />
        <p className="mt-4 text-zinc-400">Fixture not found.</p>
      </div>
    );
  }

  const homeTeam = fixture.homeTeam || { name: 'Home', shortName: 'HOM' };
  const awayTeam = fixture.awayTeam || { name: 'Away', shortName: 'AWY' };
  const isMutating = createPick.isPending || updatePick.isPending;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Match header */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-800/50 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col items-center gap-2 flex-1">
            <TeamLogo shortName={homeTeam.shortName} size="lg" />
            <span className="text-center font-semibold">{homeTeam.name}</span>
            {fixture.status === 'completed' && (
              <span className="text-2xl font-bold">{fixture.homeScore ?? '—'}</span>
            )}
          </div>
          <div className="text-center">
            <span className="text-sm font-bold text-zinc-500">VS</span>
            <p className="mt-1 text-xs text-zinc-500">
              {fixture.startTime
                ? format(new Date(fixture.startTime), 'EEE d MMM, h:mm a')
                : 'TBA'}
            </p>
            <p className="text-xs text-zinc-600">{fixture.venue || 'TBA'}</p>
          </div>
          <div className="flex flex-col items-center gap-2 flex-1">
            <TeamLogo shortName={awayTeam.shortName} size="lg" />
            <span className="text-center font-semibold">{awayTeam.name}</span>
            {fixture.status === 'completed' && (
              <span className="text-2xl font-bold">{fixture.awayScore ?? '—'}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Team comparison */}
        <div className="space-y-4">
          <Card title={homeTeam.name} subtitle="Home">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Form</span>
                <span>{fixture.homeForm || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Ladder Position</span>
                <span>{fixture.homeLadderPos || '—'}</span>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 flex items-center gap-1"><ShieldAlert size={12} /> Injuries</span>
                  <span className="text-zinc-500 text-xs">{homeInjuries.length > 0 ? `${homeInjuries.length} listed` : 'None'}</span>
                </div>
                {homeInjuries.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {homeInjuries.map((inj: any) => (
                      <div key={inj.id} className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1 text-xs">
                        <span className="text-zinc-300">{inj.playerName}{inj.position ? ` (${inj.position})` : ''}</span>
                        <Badge variant={inj.status === 'out' ? 'danger' : inj.status === 'doubtful' ? 'warning' : 'success'}>
                          {inj.status === 'probable' ? 'returning' : inj.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
          <Card title={awayTeam.name} subtitle="Away">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Form</span>
                <span>{fixture.awayForm || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Ladder Position</span>
                <span>{fixture.awayLadderPos || '—'}</span>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 flex items-center gap-1"><ShieldAlert size={12} /> Injuries</span>
                  <span className="text-zinc-500 text-xs">{awayInjuries.length > 0 ? `${awayInjuries.length} listed` : 'None'}</span>
                </div>
                {awayInjuries.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {awayInjuries.map((inj: any) => (
                      <div key={inj.id} className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1 text-xs">
                        <span className="text-zinc-300">{inj.playerName}{inj.position ? ` (${inj.position})` : ''}</span>
                        <Badge variant={inj.status === 'out' ? 'danger' : inj.status === 'doubtful' ? 'warning' : 'success'}>
                          {inj.status === 'probable' ? 'returning' : inj.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Decision panel */}
        <div className="space-y-4">
          <Card title="Your Pick">
            {existingPick && (
              <div className="mb-4 flex items-center gap-2">
                <Badge variant="success">Existing Pick</Badge>
                <ConfidenceBadge level={existingPick.confidence || 'medium'} />
              </div>
            )}

            {/* Confidence */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Confidence
              </label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setConfidence(level)}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all capitalize',
                      confidence === level
                        ? level === 'high'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                          : level === 'medium'
                          ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                          : 'border-red-500 bg-red-500/10 text-red-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Team selection */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Pick Winner
              </label>
              <div className="flex gap-2">
                {[
                  { team: homeTeam, id: fixture.homeTeamId },
                  { team: awayTeam, id: fixture.awayTeamId },
                ].map(({ team, id: teamId }) => (
                  <button
                    key={teamId}
                    onClick={() => setPickedTeamId(teamId)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium transition-all',
                      pickedTeamId === teamId
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                    )}
                  >
                    <TeamLogo shortName={team.shortName} size="sm" />
                    {team.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Factor checklist */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Factors
              </label>
              <div className="space-y-2">
                {FACTORS.map((factor) => {
                  const value = factors[factor.key] || 'neutral';
                  return (
                    <button
                      key={factor.key}
                      onClick={() => toggleFactor(factor.key)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm transition-colors hover:border-zinc-600"
                    >
                      <span className="text-zinc-300">{factor.label}</span>
                      <Badge
                        variant={
                          value === 'home'
                            ? 'success'
                            : value === 'away'
                            ? 'danger'
                            : 'default'
                        }
                      >
                        {value === 'home'
                          ? homeTeam.shortName
                          : value === 'away'
                          ? awayTeam.shortName
                          : 'Neutral'}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add your reasoning..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 transition-colors focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={!pickedTeamId || isMutating}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={16} />
                {existingPick ? 'Update Pick' : 'Submit Pick'}
              </button>
              {existingPick && (
                <button
                  onClick={() => deletePick.mutate(existingPick.id)}
                  disabled={deletePick.isPending}
                  className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
            </div>

            {(createPick.isError || updatePick.isError) && (
              <p className="mt-2 text-sm text-red-400">
                Failed to save pick. Please try again.
              </p>
            )}
            {(createPick.isSuccess || updatePick.isSuccess) && (
              <p className="mt-2 text-sm text-emerald-400">
                Pick saved successfully!
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
