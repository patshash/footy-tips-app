import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, MapPin, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../services/api';
import Card from '../components/Card';
import Badge from '../components/Badge';
import TeamLogo from '../components/TeamLogo';
import ConfidenceBadge from '../components/ConfidenceBadge';

export default function Matches() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear().toString();
  // '' = current round (default), 'all' = all rounds, '1','2',... = specific round
  const [selectedRound, setSelectedRound] = useState('');

  const { data: allFixtures = [], isLoading } = useQuery({
    queryKey: ['fixtures', currentYear],
    queryFn: () => api.getFixtures({ season: currentYear }),
  });

  const { data: picks = [] } = useQuery({
    queryKey: ['picks'],
    queryFn: () => api.getPicks(),
  });

  const picksMap = new Map(picks.map((p: any) => [p.fixtureId, p]));

  const rounds = useMemo(() =>
    [...new Set(allFixtures.map((f: any) => f.round?.number as number))]
      .filter((n) => n != null)
      .sort((a, b) => a - b),
    [allFixtures]
  );

  const currentRound = useMemo(() => {
    const current = allFixtures.find((f: any) => f.round?.isCurrent);
    return current?.round?.number as number | undefined;
  }, [allFixtures]);

  const activeRound = selectedRound === 'all'
    ? null
    : selectedRound
      ? parseInt(selectedRound, 10)
      : currentRound ?? null;

  const fixtures = useMemo(() => {
    if (activeRound == null) return allFixtures;
    return allFixtures.filter((f: any) => f.round?.number === activeRound);
  }, [allFixtures, activeRound]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Matches</h1>
        <div className="relative">
          <select
            value={selectedRound}
            onChange={(e) => setSelectedRound(e.target.value)}
            className="appearance-none rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-4 pr-10 text-sm text-white transition-colors hover:border-zinc-600 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Current Round{currentRound ? ` (R${currentRound})` : ''}</option>
            <option value="all">All Rounds</option>
            {rounds.map((r: any) => (
              <option key={r} value={r}>
                Round {r}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
        </div>
      )}

      {!isLoading && fixtures.length === 0 && (
        <Card>
          <p className="py-8 text-center text-zinc-500">No matches found.</p>
        </Card>
      )}

      <div className="space-y-3">
        {fixtures.map((fixture: any) => {
          const pick = picksMap.get(fixture.id);
          const completed = fixture.status === 'completed';

          return (
            <button
              key={fixture.id}
              onClick={() => navigate(`/matches/${fixture.id}`)}
              className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-800/50 p-4 transition-all hover:border-emerald-500/40 hover:bg-zinc-800"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <TeamLogo shortName={fixture.homeTeam?.shortName || 'HOM'} size="md" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{fixture.homeTeam?.name || 'Home'}</p>
                      {completed && (
                        <p className="text-lg font-bold text-white">{fixture.homeScore ?? '—'}</p>
                      )}
                    </div>
                  </div>

                  <span className="text-xs font-bold text-zinc-500 px-2">VS</span>

                  <div className="flex items-center gap-2 min-w-0 flex-1 justify-end text-right">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{fixture.awayTeam?.name || 'Away'}</p>
                      {completed && (
                        <p className="text-lg font-bold text-white">{fixture.awayScore ?? '—'}</p>
                      )}
                    </div>
                    <TeamLogo shortName={fixture.awayTeam?.shortName || 'AWY'} size="md" />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                  <Badge variant={completed ? 'default' : 'info'}>
                    {completed ? 'Completed' : 'Upcoming'}
                  </Badge>
                  {pick && (
                    <ConfidenceBadge level={pick.confidence || 'medium'} />
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1">
                  <MapPin size={12} />
                  {fixture.venue || 'TBA'}
                </span>
                <span className="flex items-center gap-1">
                  <CalendarDays size={12} />
                  {fixture.kickoff
                    ? format(new Date(fixture.kickoff), 'EEE d MMM, h:mm a')
                    : 'TBA'}
                </span>
                {pick && (
                  <span className="text-emerald-400 font-medium">
                    Picked: {pick.pickedTeam?.name || pick.pickedTeamId}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
