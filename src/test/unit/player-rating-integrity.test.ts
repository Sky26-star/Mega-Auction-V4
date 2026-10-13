// src/test/unit/player-rating-integrity.test.ts
// 🔒 FROZEN PLAYER RATING INTEGRITY CONTRACT TEST SUITE
//
// This test suite guarantees that the finalized Phase 0 player ratings remain
// byte-for-byte, value-for-value immutable.
//
// HARD FAILURE RULE:
// ANY CHANGE TO PLAYER RATINGS IS A HARD FAILURE FOR BEHAVIOR TASKS.

import { describe, it, expect } from 'vitest';
import { computePlayerRating } from '@/lib/player-rating';
import type { V3Player } from '@/lib/v3-auction-types';

function makeMockPlayer(name: string, role: any, stats: Partial<V3Player> = {}): V3Player {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    role,
    category: 'MARQUEE',
    country: 'India',
    age: 30,
    batting_hand: 'Right Handed',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    matches: 100,
    runs: 2000,
    batting_average: 30,
    strike_rate: 130,
    hundreds: 1,
    fifties: 10,
    highest_score: 100,
    boundaries: 200,
    ...stats,
  };
}

describe('🔒 Frozen Player Rating Integrity Contract', () => {

  it('1. MUST enforce top-level FINAL_OVERRIDES authority even when career stats exist', () => {
    // Jasprit Bumrah has career stats (133 matches, 180 wickets).
    // Formula alone yields 93, but locked FINAL_OVERRIDES must return 95!
    const bumrah = makeMockPlayer('Jasprit Bumrah', 'BOWLER', {
      matches: 133,
      wickets: 180,
      bowling_average: 22.47,
      economy_rate: 7.13,
      bowling_strike_rate: 18.9,
      best_bowling: '5/10',
      three_wicket_hauls: 12,
    });
    expect(computePlayerRating(bumrah)).toBe(95);

    // Dinesh Karthik has career stats (257 matches, 4842 runs).
    // Formula alone yields 87, but locked FINAL_OVERRIDES must return 91!
    const dk = makeMockPlayer('Dinesh Karthik', 'WICKET_KEEPER', {
      matches: 257,
      runs: 4842,
      batting_average: 26.32,
      strike_rate: 135.36,
      catches: 145,
      stumpings: 37,
    });
    expect(computePlayerRating(dk)).toBe(91);

    // Abhishek Sharma: formula yields 88, locked override must return 90!
    const abhishek = makeMockPlayer('Abhishek Sharma', 'BATSMAN', {
      matches: 92,
      runs: 2379,
      batting_average: 29.37,
      strike_rate: 171.27,
    });
    expect(computePlayerRating(abhishek)).toBe(90);

    // Hardik Pandya: locked override must return 92!
    const hardik = makeMockPlayer('Hardik Pandya', 'ALL_ROUNDER', {
      matches: 129,
      runs: 2565,
      wickets: 67,
    });
    expect(computePlayerRating(hardik)).toBe(92);
  });

  it('2. MUST retain key marquee anchors and corrections unchanged', () => {
    const keyAnchors: Record<string, { role: any; rating: number }> = {
      'Virat Kohli': { role: 'BATSMAN', rating: 97 },
      'Rohit Sharma': { role: 'BATSMAN', rating: 95 },
      'MS Dhoni': { role: 'WICKET_KEEPER', rating: 94 },
      'Jasprit Bumrah': { role: 'BOWLER', rating: 95 },
      'David Warner': { role: 'BATSMAN', rating: 96 },
      'Suresh Raina': { role: 'BATSMAN', rating: 95 },
      'Jos Buttler': { role: 'BATSMAN', rating: 94 },
      'KL Rahul': { role: 'WICKET_KEEPER', rating: 93 },
      'Shubman Gill': { role: 'BATSMAN', rating: 93 },
      'Shane Watson': { role: 'ALL_ROUNDER', rating: 93 },
      'Dinesh Karthik': { role: 'WICKET_KEEPER', rating: 91 },
      'Axar Patel': { role: 'ALL_ROUNDER', rating: 92 },
      'Ravindra Jadeja': { role: 'ALL_ROUNDER', rating: 92 },
      'Rishabh Pant': { role: 'WICKET_KEEPER', rating: 92 },
      'Sanju Samson': { role: 'WICKET_KEEPER', rating: 92 },
      'Shreyas Iyer': { role: 'BATSMAN', rating: 92 },
      'Dale Steyn': { role: 'BOWLER', rating: 92 },
      'Dwayne Bravo': { role: 'ALL_ROUNDER', rating: 92 },
      'Kagiso Rabada': { role: 'BOWLER', rating: 92 },
      'Heinrich Klaasen': { role: 'WICKET_KEEPER', rating: 92 },
    };

    for (const [name, meta] of Object.entries(keyAnchors)) {
      const player = makeMockPlayer(name, meta.role);
      const computed = computePlayerRating(player);
      expect(computed, `Anchor rating mismatch for ${name}`).toBe(meta.rating);
    }
  });

  it('3. MUST correctly compute formula-based players without overrides', () => {
    // AB de Villiers: formula rated 94
    const abde = makeMockPlayer('AB de Villiers', 'BATSMAN', {
      matches: 184,
      runs: 5162,
      batting_average: 39.71,
      strike_rate: 151.69,
      hundreds: 3,
      fifties: 40,
      highest_score: 133,
      boundaries: 664,
    });
    expect(computePlayerRating(abde)).toBe(94);

    // Chris Gayle: formula rated 94
    const gayle = makeMockPlayer('Chris Gayle', 'BATSMAN', {
      matches: 142,
      runs: 4965,
      batting_average: 39.72,
      strike_rate: 148.96,
      hundreds: 6,
      fifties: 31,
      highest_score: 175,
      boundaries: 762,
    });
    expect(computePlayerRating(gayle)).toBe(94);

    // Bhuvneshwar Kumar: formula rated 93
    const bhuvi = makeMockPlayer('Bhuvneshwar Kumar', 'BOWLER', {
      matches: 206,
      wickets: 226,
      bowling_average: 26.16,
      economy_rate: 7.71,
      bowling_strike_rate: 20.35,
      best_bowling: '5/19',
      three_wicket_hauls: 27,
    });
    expect(computePlayerRating(bhuvi)).toBe(93);

    // Andre Russell: formula rated 91
    const russell = makeMockPlayer('Andre Russell', 'ALL_ROUNDER', {
      matches: 139,
      runs: 2651,
      batting_average: 28.2,
      strike_rate: 174.18,
      wickets: 123,
      bowling_average: 23.28,
      economy_rate: 9.51,
      bowling_strike_rate: 14.68,
      best_bowling: '5/15',
      three_wicket_hauls: 13,
    });
    expect(computePlayerRating(russell)).toBe(91);
  });

  it('4. MUST be deterministic and pure — 0 external dependencies', () => {
    const p = makeMockPlayer('Generic Batsman', 'BATSMAN', { matches: 50, runs: 1200 });
    const r1 = computePlayerRating(p);
    const r2 = computePlayerRating(p);
    expect(r1).toBe(r2);
  });
});
