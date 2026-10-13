import { describe, it, expect } from 'vitest';
import { buildBotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type V3Team, type V3Player, type V3PlayerRole } from '../../lib/v3-auction-types';
import { DEFAULT_CONTEXT, type AuctionContext } from '../../lib/auction/server-bot-engine';

// ============================================================
// HELPERS
// ============================================================

function makeBot(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'bot-1',
    name: 'Test Bot',
    short_name: 'TB',
    purse: 10000,
    initial_purse: 10000,
    players_bought: 0,
    overseas_count: 0,
    is_bot: true,
    ...overrides,
  };
}

function makePlayer(id: string, role: string, is_overseas = false): V3Player {
  return {
    id,
    name: `Player ${id}`,
    role: role as V3PlayerRole,
    category: 'A',
    country: is_overseas ? 'AUS' : 'IND',
    age: 25,
    batting_hand: 'Right',
    base_price: 200,
    is_overseas,
    image_url: null,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Squad Intelligence - buildBotSquadState', () => {
  it('TEST 1 — EMPTY SQUAD', () => {
    const bot = makeBot({ purse: 10000, initial_purse: 10000, overseas_count: 0 });
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 25, maxOverseas: 8 };
    const state = buildBotSquadState(bot, [], ctx);

    expect(state.squadSize).toBe(0);
    expect(state.remainingSlots).toBe(25);
    expect(state.overseasCount).toBe(0);
    expect(state.overseasSlotsRemaining).toBe(8);
    expect(state.purseRemaining).toBe(10000);
    expect(state.amountSpent).toBe(0);
    expect(state.spentRatio).toBe(0);
    expect(state.roleComposition).toEqual({ BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 });
    
    // With 0 players and 25 max, need should be high/critical
    expect(state.roleNeeds.BATSMAN).toBe('CRITICAL');
  });

  it('TEST 2 — MIXED SQUAD', () => {
    const bot = makeBot({ purse: 5000, initial_purse: 10000, overseas_count: 3 });
    const roster = [
      makePlayer('1', 'BATSMAN'),
      makePlayer('2', 'BATSMAN'),
      makePlayer('3', 'BOWLER', true),
      makePlayer('4', 'ALL_ROUNDER', true),
      makePlayer('5', 'WICKET_KEEPER', true),
    ];
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 25, maxOverseas: 8 };
    const state = buildBotSquadState(bot, roster, ctx);

    expect(state.squadSize).toBe(5);
    expect(state.remainingSlots).toBe(20);
    expect(state.overseasCount).toBe(3); // from bot, not roster
    expect(state.overseasSlotsRemaining).toBe(5);
  });

  it('TEST 3 — ROLE COMPOSITION', () => {
    const bot = makeBot();
    const roster = [
      makePlayer('1', 'BATSMAN'),
      makePlayer('2', 'BATSMAN'),
      makePlayer('3', 'BATSMAN'),
      makePlayer('4', 'BOWLER'),
      makePlayer('5', 'BOWLER'),
      makePlayer('6', 'BOWLER'),
      makePlayer('7', 'BOWLER'),
      makePlayer('8', 'BOWLER'),
      makePlayer('9', 'ALL_ROUNDER'),
      makePlayer('10', 'ALL_ROUNDER'),
      makePlayer('11', 'WICKET_KEEPER'),
    ];
    const state = buildBotSquadState(bot, roster, DEFAULT_CONTEXT);
    expect(state.roleComposition).toEqual({
      BATSMAN: 3,
      BOWLER: 5,
      ALL_ROUNDER: 2,
      WICKET_KEEPER: 1,
    });
  });

  it('TEST 4 — REMAINING SLOTS', () => {
    const bot = makeBot();
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 20 };
    const roster = [makePlayer('1', 'BATSMAN'), makePlayer('2', 'BOWLER')];
    
    const state = buildBotSquadState(bot, roster, ctx);
    expect(state.remainingSlots).toBe(18); // 20 - 2
  });

  it('TEST 5 — PURSE', () => {
    const bot = makeBot({ purse: 300, initial_purse: 10000 });
    const state = buildBotSquadState(bot, [], DEFAULT_CONTEXT);
    
    expect(state.purseRemaining).toBe(300);
    expect(state.amountSpent).toBe(9700);
  });

  it('TEST 6 — SPENT RATIO', () => {
    const bot = makeBot({ purse: 60, initial_purse: 100 });
    const state = buildBotSquadState(bot, [], DEFAULT_CONTEXT);
    
    expect(state.amountSpent).toBe(40);
    expect(state.spentRatio).toBe(0.4);
  });

  it('TEST 7 — ZERO / NEGATIVE INITIAL PURSE', () => {
    const botZero = makeBot({ purse: -10, initial_purse: 0 });
    const stateZero = buildBotSquadState(botZero, [], DEFAULT_CONTEXT);
    expect(stateZero.amountSpent).toBe(10);
    expect(stateZero.spentRatio).toBe(0);

    const botNeg = makeBot({ purse: -50, initial_purse: -10 });
    const stateNeg = buildBotSquadState(botNeg, [], DEFAULT_CONTEXT);
    expect(stateNeg.spentRatio).toBe(0);
  });

  it('TEST 8 — OVERSEAS', () => {
    const bot = makeBot({ overseas_count: 5 });
    const ctx = { ...DEFAULT_CONTEXT, maxOverseas: 8 };
    const state = buildBotSquadState(bot, [], ctx);
    
    expect(state.overseasCount).toBe(5);
    expect(state.overseasSlotsRemaining).toBe(3);
  });

  it('TEST 9 — ROLE NEED', () => {
    // We implicitly tested this by asserting CRITICAL in TEST 1, but let's test a NORMAL case
    const bot = makeBot();
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 25 };
    // Provide 7 batsmen (ideal is usually 7), should be NORMAL
    const roster = Array.from({ length: 7 }).map((_, i) => makePlayer(String(i), 'BATSMAN'));
    const state = buildBotSquadState(bot, roster, ctx);
    
    expect(state.roleNeeds.BATSMAN).toBe('NORMAL');
  });

  it('TEST 10 — FULL SQUAD', () => {
    const bot = makeBot();
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 5 };
    const roster = Array.from({ length: 5 }).map((_, i) => makePlayer(String(i), 'BATSMAN'));
    
    const state = buildBotSquadState(bot, roster, ctx);
    expect(state.remainingSlots).toBe(0);
  });

  it('TEST 11 — OVERSIZED ROSTER', () => {
    const bot = makeBot();
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 5 };
    // 7 players, but max is 5
    const roster = Array.from({ length: 7 }).map((_, i) => makePlayer(String(i), 'BATSMAN'));
    
    const state = buildBotSquadState(bot, roster, ctx);
    expect(state.squadSize).toBe(7);
    expect(state.remainingSlots).toBe(0); // Clamped to 0, no negatives
  });

  it('TEST 12 — DETERMINISM', () => {
    const bot = makeBot({ purse: 500, initial_purse: 1000, overseas_count: 2 });
    const roster = [makePlayer('1', 'BATSMAN'), makePlayer('2', 'BOWLER')];
    const ctx = { ...DEFAULT_CONTEXT };
    
    const state1 = buildBotSquadState(bot, roster, ctx);
    const state2 = buildBotSquadState(bot, roster, ctx);
    
    expect(state1).toEqual(state2);
  });

  it('TEST 13 — BOT IMMUTABILITY', () => {
    const bot = makeBot({ purse: 500, initial_purse: 1000, overseas_count: 2 });
    const botCopy = JSON.parse(JSON.stringify(bot));
    
    buildBotSquadState(bot, [], DEFAULT_CONTEXT);
    expect(bot).toEqual(botCopy);
  });

  it('TEST 14 — ROSTER IMMUTABILITY', () => {
    const roster = [makePlayer('1', 'BATSMAN'), makePlayer('2', 'BOWLER')];
    const rosterCopy = JSON.parse(JSON.stringify(roster));
    
    buildBotSquadState(makeBot(), roster, DEFAULT_CONTEXT);
    expect(roster).toEqual(rosterCopy);
  });

  it('TEST 15 — CONTEXT IMMUTABILITY', () => {
    const ctx = { ...DEFAULT_CONTEXT, maxSquadSize: 20 };
    const ctxCopy = JSON.parse(JSON.stringify(ctx));
    
    buildBotSquadState(makeBot(), [], ctx);
    expect(ctx).toEqual(ctxCopy);
  });

  it('TEST 16 — INVALID ROLE SAFETY', () => {
    const bot = makeBot();
    const roster = [
      makePlayer('1', 'BATSMAN'),
      makePlayer('2', 'INVALID_ROLE'),
      makePlayer('3', 'UNKNOWN'),
    ];
    
    const state = buildBotSquadState(bot, roster, DEFAULT_CONTEXT);
    expect(state.roleComposition).toEqual({
      BATSMAN: 1,
      BOWLER: 0,
      ALL_ROUNDER: 0,
      WICKET_KEEPER: 0,
    });
    // @ts-expect-error - testing invalid access
    expect(state.roleComposition['INVALID_ROLE']).toBeUndefined();
  });
});
