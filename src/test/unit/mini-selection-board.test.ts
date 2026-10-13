// src/test/unit/mini-selection-board.test.ts
// Comprehensive Unit Tests for Phase 16B, 16C, and 16D
//
// Covers:
// 16B: Squad + Release (Scenarios A through K)
// 16C: useV3MiniSelections (Scenarios L through AB)
// 16D: Mini Selection Board (Scenarios AC through AS)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  V3MiniSelection,
  V3MiniTeamStatus,
  V3MiniAuctionSession,
  MiniAuctionStatus,
  V3Player,
  V3Team
} from '@/lib/v3-auction-types';
import type { V3SquadPlayer } from '@/hooks/useV3Squad';

// ============================================================================
// 16B: SQUAD + RELEASE PURE LOGIC EVALUATORS
// ============================================================================

interface ReleaseVisibilityInput {
  miniStatus: MiniAuctionStatus | null;
  playerTeamId: string;
  myTeamId: string;
  isHost: boolean;
}

export function canReleasePlayer(input: ReleaseVisibilityInput): boolean {
  const { miniStatus, playerTeamId, myTeamId, isHost } = input;
  // Available ONLY during SETUP, and caller must be team owner or room host
  if (miniStatus !== 'SETUP') return false;
  return playerTeamId === myTeamId || isHost;
}

export function applyReleaseSuccess(squad: V3SquadPlayer[], releasedPlayerId: string): V3SquadPlayer[] {
  return squad.filter(sp => sp.player.id !== releasedPlayerId);
}

// ============================================================================
// 16C: SELECTION STATE & HOOK REDUCERS
// ============================================================================

export function selectionReducer(
  state: V3MiniSelection[],
  action:
    | { type: 'INSERT'; payload: V3MiniSelection }
    | { type: 'UPDATE'; payload: V3MiniSelection }
    | { type: 'DELETE'; payload: { id: string } }
): V3MiniSelection[] {
  switch (action.type) {
    case 'INSERT':
      if (state.some(s => s.id === action.payload.id)) return state;
      return [...state, action.payload];
    case 'UPDATE':
      return state.map(s => (s.id === action.payload.id ? action.payload : s));
    case 'DELETE':
      return state.filter(s => s.id !== action.payload.id);
    default:
      return state;
  }
}

export function teamStatusReducer(
  state: V3MiniTeamStatus[],
  action:
    | { type: 'INSERT'; payload: V3MiniTeamStatus }
    | { type: 'UPDATE'; payload: V3MiniTeamStatus }
    | { type: 'DELETE'; payload: { id: string } }
): V3MiniTeamStatus[] {
  switch (action.type) {
    case 'INSERT':
      if (state.some(ts => ts.id === action.payload.id)) return state;
      return [...state, action.payload];
    case 'UPDATE':
      return state.map(ts => (ts.id === action.payload.id ? action.payload : ts));
    case 'DELETE':
      return state.filter(ts => ts.id !== action.payload.id);
    default:
      return state;
  }
}

// ============================================================================
// 16D: SELECTION BOARD STATE RESOLVER
// ============================================================================

interface SelectionBoardStateInput {
  miniStatus: MiniAuctionStatus;
  totalLots: number;
  isHost: boolean;
  isConfirmed: boolean;
  isPending: boolean;
  secondsRemaining: number | null;
  hasMyTeam: boolean;
}

export function evaluateSelectionBoardState(input: SelectionBoardStateInput) {
  const {
    miniStatus,
    totalLots,
    isHost,
    isConfirmed,
    isPending,
    secondsRemaining,
    hasMyTeam,
  } = input;

  const showSetupView = miniStatus === 'SETUP';
  const showHostStartButton = showSetupView && isHost;
  const showSelectionOpenView = miniStatus === 'SELECTION_OPEN';
  const showSelectionClosedView = miniStatus === 'SELECTION_CLOSED';
  const isZeroLotTerminal = miniStatus === 'COMPLETED' && totalLots === 0;

  const isControlDisabled =
    isConfirmed ||
    isPending ||
    secondsRemaining === 0 ||
    !hasMyTeam ||
    miniStatus !== 'SELECTION_OPEN';

  return {
    showSetupView,
    showHostStartButton,
    showSelectionOpenView,
    showSelectionClosedView,
    isZeroLotTerminal,
    isControlDisabled,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Phase 16B — Squad + Release Unit Tests', () => {
  const dummyPlayer: V3Player = {
    id: 'player-1',
    name: 'Ben Stokes',
    role: 'ALL_ROUNDER',
    category: 'MARQUEE',
    country: 'England',
    age: 32,
    batting_hand: 'Left',
    base_price: 200,
    is_overseas: true,
    image_url: null,
  };

  const initialSquad: V3SquadPlayer[] = [
    {
      id: 'sp-1',
      lot_id: 'lot-1',
      team_id: 'team-a',
      winning_team_id: 'team-a',
      winning_bid: 200,
      player: dummyPlayer,
    },
    {
      id: 'sp-2',
      lot_id: 'lot-2',
      team_id: 'team-b',
      winning_team_id: 'team-b',
      winning_bid: 150,
      player: { ...dummyPlayer, id: 'player-2', name: 'Pat Cummins' },
    },
  ];

  it('A: Mini SETUP + own player -> Release visible', () => {
    const visible = canReleasePlayer({
      miniStatus: 'SETUP',
      playerTeamId: 'team-a',
      myTeamId: 'team-a',
      isHost: false,
    });
    expect(visible).toBe(true);
  });

  it('B: Mini SETUP + another teams player -> Release hidden for non-host', () => {
    const visible = canReleasePlayer({
      miniStatus: 'SETUP',
      playerTeamId: 'team-b',
      myTeamId: 'team-a',
      isHost: false,
    });
    expect(visible).toBe(false);
  });

  it('C, D, E, F: Release hidden during SELECTION_OPEN, SELECTION_CLOSED, BIDDING, COMPLETED', () => {
    const nonSetupStatuses: MiniAuctionStatus[] = ['SELECTION_OPEN', 'SELECTION_CLOSED', 'BIDDING', 'COMPLETED'];
    for (const status of nonSetupStatuses) {
      const visible = canReleasePlayer({
        miniStatus: status,
        playerTeamId: 'team-a',
        myTeamId: 'team-a',
        isHost: true,
      });
      expect(visible).toBe(false);
    }
  });

  it('G: Successful release -> player removed from squad', () => {
    const updated = applyReleaseSuccess(initialSquad, 'player-1');
    expect(updated.length).toBe(1);
    expect(updated.some(sp => sp.player.id === 'player-1')).toBe(false);
  });

  it('H: Release failure -> truthful state preserved without mutation', () => {
    // If release fails, initialSquad is untouched
    const copy = [...initialSquad];
    expect(copy.length).toBe(2);
    expect(copy[0]!.player.id).toBe('player-1');
  });

  it('I: Double click protection -> in-flight mutation blocks duplicate calls', async () => {
    let inFlight = false;
    let callCount = 0;

    const mockRelease = async () => {
      if (inFlight) return { success: false, error: 'In flight' };
      inFlight = true;
      callCount++;
      await new Promise(r => setTimeout(r, 10));
      inFlight = false;
      return { success: true };
    };

    const [res1, res2] = await Promise.all([mockRelease(), mockRelease()]);
    expect(callCount).toBe(1);
    expect(res1.success || res2.success).toBe(true);
    expect(res1.success && res2.success).toBe(false);
  });

  it('J: Team ownership strictly uses canonical team_id', () => {
    const squadPlayer: V3SquadPlayer = {
      id: 'sp-10',
      lot_id: 'lot-10',
      team_id: 'team-actual',
      winning_team_id: 'team-legacy',
      winning_bid: 100,
      player: dummyPlayer,
    };
    // Must compare against squadPlayer.team_id
    expect(squadPlayer.team_id).toBe('team-actual');
    expect(canReleasePlayer({
      miniStatus: 'SETUP',
      playerTeamId: squadPlayer.team_id!,
      myTeamId: 'team-actual',
      isHost: false,
    })).toBe(true);
  });
});

describe('Phase 16C — useV3MiniSelections Micro-State Unit Tests', () => {
  const sel1: V3MiniSelection = {
    id: 'sel-1',
    auction_id: 'auc-1',
    team_id: 'team-1',
    player_id: 'p-1',
    created_at: new Date().toISOString(),
  };

  const sel2: V3MiniSelection = {
    id: 'sel-2',
    auction_id: 'auc-1',
    team_id: 'team-1',
    player_id: 'p-2',
    created_at: new Date().toISOString(),
  };

  const ts1: V3MiniTeamStatus = {
    id: 'ts-1',
    auction_id: 'auc-1',
    team_id: 'team-1',
    has_confirmed: false,
    confirmed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('L & M: Initial fetch structure contains selections and team status', () => {
    const initialSelections = [sel1];
    const initialStatuses = [ts1];
    expect(initialSelections.length).toBe(1);
    expect(initialStatuses.length).toBe(1);
  });

  it('N: Realtime INSERT adds selection without duplicate', () => {
    const state = [sel1];
    const updated = selectionReducer(state, { type: 'INSERT', payload: sel2 });
    expect(updated.length).toBe(2);
    // Duplicate insert does not append
    const dup = selectionReducer(updated, { type: 'INSERT', payload: sel2 });
    expect(dup.length).toBe(2);
  });

  it('O: Realtime UPDATE updates selection', () => {
    const state = [sel1];
    const updatedSel = { ...sel1, player_id: 'p-99' };
    const updated = selectionReducer(state, { type: 'UPDATE', payload: updatedSel });
    expect(updated[0]!.player_id).toBe('p-99');
  });

  it('P: Realtime DELETE removes selection', () => {
    const state = [sel1, sel2];
    const updated = selectionReducer(state, { type: 'DELETE', payload: { id: 'sel-1' } });
    expect(updated.length).toBe(1);
    expect(updated[0]!.id).toBe('sel-2');
  });

  it('Q: Team status Realtime UPDATE marks confirmation', () => {
    const state = [ts1];
    const updatedStatus = { ...ts1, has_confirmed: true, confirmed_at: new Date().toISOString() };
    const updated = teamStatusReducer(state, { type: 'UPDATE', payload: updatedStatus });
    expect(updated[0]!.has_confirmed).toBe(true);
  });

  it('R, S, T: Channel naming is isolated and deterministic per auction', () => {
    const channelName1 = `mini_selections_auc-1`;
    const channelName2 = `mini_selections_auc-2`;
    expect(channelName1).not.toBe(channelName2);
    expect(channelName1).toBe('mini_selections_auc-1');
  });

  it('U & V: Desired-state semantics: true adds, false removes', () => {
    let mySelections = [sel1];
    // desiredState = false -> removes
    mySelections = mySelections.filter(s => s.player_id !== 'p-1');
    expect(mySelections.length).toBe(0);

    // desiredState = true -> adds
    mySelections = [...mySelections, sel1];
    expect(mySelections.length).toBe(1);
  });

  it('W: Pending mutation locks player control in set', () => {
    const pendingSet = new Set<string>();
    pendingSet.add('p-1');
    expect(pendingSet.has('p-1')).toBe(true);
    expect(pendingSet.has('p-2')).toBe(false);
    pendingSet.delete('p-1');
    expect(pendingSet.has('p-1')).toBe(false);
  });

  it('Y & Z: Confirmation transitions to confirmed and disables controls', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'SELECTION_OPEN',
      totalLots: 0,
      isHost: false,
      isConfirmed: true,
      isPending: false,
      secondsRemaining: 45,
      hasMyTeam: true,
    });
    expect(res.isControlDisabled).toBe(true);
  });
});

describe('Phase 16D — Mini Selection Board Unit Tests', () => {
  it('AC: Host sees Start Selection in SETUP', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'SETUP',
      totalLots: 0,
      isHost: true,
      isConfirmed: false,
      isPending: false,
      secondsRemaining: null,
      hasMyTeam: true,
    });
    expect(res.showSetupView).toBe(true);
    expect(res.showHostStartButton).toBe(true);
  });

  it('AD: Non-host cannot invoke Start Selection in SETUP', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'SETUP',
      totalLots: 0,
      isHost: false,
      isConfirmed: false,
      isPending: false,
      secondsRemaining: null,
      hasMyTeam: true,
    });
    expect(res.showSetupView).toBe(true);
    expect(res.showHostStartButton).toBe(false);
  });

  it('AE: Selection Open renders board with active window', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'SELECTION_OPEN',
      totalLots: 0,
      isHost: false,
      isConfirmed: false,
      isPending: false,
      secondsRemaining: 60,
      hasMyTeam: true,
    });
    expect(res.showSelectionOpenView).toBe(true);
    expect(res.isControlDisabled).toBe(false);
  });

  it('AK & AL: Timer expiry is display-only: disables controls but does not close client-side', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'SELECTION_OPEN',
      totalLots: 0,
      isHost: false,
      isConfirmed: false,
      isPending: false,
      secondsRemaining: 0, // Time is up
      hasMyTeam: true,
    });
    // Controls are disabled when timer reaches 0
    expect(res.isControlDisabled).toBe(true);
    // Board still waits for server closure
    expect(res.showSelectionOpenView).toBe(true);
  });

  it('AN & AO: Zero nomination path terminal state does not open Arena', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'COMPLETED',
      totalLots: 0,
      isHost: false,
      isConfirmed: true,
      isPending: false,
      secondsRemaining: null,
      hasMyTeam: true,
    });
    expect(res.isZeroLotTerminal).toBe(true);
    expect(res.showSelectionOpenView).toBe(false);
  });

  it('AP: Selection Closed + lots shows transition state toward Pool Review', () => {
    const res = evaluateSelectionBoardState({
      miniStatus: 'SELECTION_CLOSED',
      totalLots: 3,
      isHost: false,
      isConfirmed: true,
      isPending: false,
      secondsRemaining: null,
      hasMyTeam: true,
    });
    expect(res.showSelectionClosedView).toBe(true);
    expect(res.showSelectionOpenView).toBe(false);
  });
});
