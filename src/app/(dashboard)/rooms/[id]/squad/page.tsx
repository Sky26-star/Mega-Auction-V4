'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import { useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import { useV3Squad } from '@/hooks/useV3Squad';
import { SquadMetrics } from '@/components/rooms/v3/SquadMetrics';
import { SquadRoleSection } from '@/components/rooms/v3/SquadRoleSection';
import { AuctionSelect } from '@/components/ui/auction-select';
import {
  AuctionReportLayout,
  ReportFeedback,
  ReportTitle,
  SectionHeading,
} from '@/components/rooms/v3/auction-report-ui';

const roles = [
  { value: 'BATSMAN', title: 'Batters' },
  { value: 'ALL_ROUNDER', title: 'All-rounders' },
  { value: 'WICKET_KEEPER', title: 'Keepers' },
  { value: 'BOWLER', title: 'Bowlers' },
];

export default function SquadManagementPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const { state, loading: stateLoading, error: stateError, refresh } = useV3AuctionContext();
  const {
    squadPlayers,
    loading: squadLoading,
    error: squadError,
    refresh: refreshSquad,
  } = useV3Squad(state.auction?.id || null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [role, setRole] = useState('ALL');
  const [search, setSearch] = useState('');
  const teams = state.teams || [];
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || teams[0];
  const currentTeamSquad = squadPlayers.filter(
    (player) => player.winning_team_id === selectedTeam?.id
  );
  const filteredPlayers = currentTeamSquad.filter(({ player }) =>
    player.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const loading = stateLoading || squadLoading;
  const error = stateError || squadError;
  const selectTeam = (id: string) => {
    setSelectedTeamId(id);
    setRole('ALL');
    setSearch('');
  };
  const stepTeam = (direction: number) => {
    if (!selectedTeam || !teams.length) return;
    const index = teams.findIndex((team) => team.id === selectedTeam.id);
    selectTeam(teams[(index + direction + teams.length) % teams.length]!.id);
  };

  return (
    <AuctionReportLayout roomId={roomId} active="squad">
      <div className="grid min-w-0 items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <ReportTitle
          eyebrow="Built at the auction"
          title="Franchise"
          accent="squads"
          description="Your signings, your balance, your next move. Explore every franchise in the room."
        />
        {teams.length > 0 && (
          <div className="min-w-0 rounded-xl border border-[#2A312D] bg-[#141917] p-3 sm:p-4">
            <label
              htmlFor="squad-franchise"
              className="mb-2 block px-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA6A0]"
            >
              Franchise · {teams.findIndex(team => team.id === selectedTeam?.id) + 1} of {teams.length}
            </label>
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => stepTeam(-1)}
                disabled={teams.length < 2}
                aria-label="Previous franchise"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#9CA6A0] hover:bg-[#242E27] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] disabled:opacity-30"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <AuctionSelect
                id="squad-franchise"
                label="Select franchise"
                value={selectedTeam?.id || ''}
                onValueChange={selectTeam}
                options={teams.map(team => ({ value: team.id, label: team.name }))}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => stepTeam(1)}
                disabled={teams.length < 2}
                aria-label="Next franchise"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#9CA6A0] hover:bg-[#242E27] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {error || (loading && !squadPlayers.length) || !selectedTeam ? (
        <ReportFeedback
          loading={loading && !error}
          error={
            error ||
            (!loading && !teams.length ? 'No franchises have joined this auction yet.' : null)
          }
          onRetry={() => {
            void refresh();
            void refreshSquad();
          }}
        />
      ) : (
        <>
          <SquadMetrics team={selectedTeam} />
          <section className="min-w-0" aria-label={`${selectedTeam.name} roster`}>
            <SectionHeading
              title="Squad roster"
              subtitle={selectedTeam.name}
              aside={`${currentTeamSquad.length} ${currentTeamSquad.length === 1 ? 'signing' : 'signings'}`}
            />
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-[#2A312D] bg-[#141917] p-3 xl:flex-row xl:items-center xl:justify-between">
              <div
                className="flex min-w-0 flex-wrap gap-1.5"
                role="group"
                aria-label="Filter squad by role"
              >
                {[{ value: 'ALL', title: 'All players' }, ...roles].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={role === item.value}
                    onClick={() => setRole(item.value)}
                    className={`min-h-10 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${role === item.value ? 'bg-[#C9A227] text-[#0B0F0D]' : 'text-[#9CA6A0] hover:bg-[#242E27] hover:text-[#F3F4F1]'}`}
                  >
                    {item.title}
                    <span className="ml-2 opacity-70">
                      {item.value === 'ALL'
                        ? currentTeamSquad.length
                        : currentTeamSquad.filter((p) => p.player.role === item.value).length}
                    </span>
                  </button>
                ))}
              </div>
              <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-[#2A312D] bg-[#0B0F0D] px-3 xl:w-56 xl:shrink-0">
                <Search className="h-4 w-4 shrink-0 text-[#9CA6A0]" aria-hidden="true" />
                <span className="sr-only">Search squad players</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search a player…"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-[#C9A227]"
                />
              </label>
            </div>

            {!currentTeamSquad.length ? (
              <div className="rounded-2xl border border-dashed border-[#2A312D] px-5 py-10 text-center">
                <Users className="mx-auto mb-3 h-8 w-8 text-[#C9A227]" aria-hidden="true" />
                <h3 className="text-xl font-semibold uppercase">A squad in the making</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#9CA6A0]">
                  No signings yet. Players acquired at the auction will appear here, grouped by
                  role.
                </p>
              </div>
            ) : !filteredPlayers.some((p) => role === 'ALL' || p.player.role === role) ? (
              <div className="rounded-2xl border border-dashed border-[#2A312D] p-6 text-center">
                <p className="text-sm text-[#9CA6A0]">No players match your filters.</p>
                <button
                  onClick={() => {
                    setSearch('');
                    setRole('ALL');
                  }}
                  className="mt-2 min-h-11 px-4 text-sm font-semibold text-[#E4B93F]"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {roles
                  .filter((item) => role === 'ALL' || role === item.value)
                  .map((item) => (
                    <SquadRoleSection
                      key={item.value}
                      title={item.title}
                      players={filteredPlayers}
                      roleFilter={[item.value]}
                    />
                  ))}
              </div>
            )}
          </section>
        </>
      )}
    </AuctionReportLayout>
  );
}
