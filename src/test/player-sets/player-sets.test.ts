// src/test/player-sets/player-sets.test.ts
// Comprehensive Unit Test Suite for Player Master Data V2

import { describe, it, expect } from 'vitest';
import { parseCSVLine, parsePlayerCSV } from '@/lib/csv-parser';
import { playerSetSchema, playerSchema } from '@/lib/validations/player-set';
import { CATEGORY_UI_LABELS, CATEGORY_BASE_PRICES } from '@/lib/types/player-set';
import { getRoleStats } from '@/components/player-sets/player-card';

describe('Player Master Data V2 — Validation Schemas', () => {
  describe('playerSetSchema', () => {
    it('validates a valid player set', () => {
      const result = playerSetSchema.safeParse({
        name: 'IPL 2026 Mega Auction Pool',
        description: 'Top international & domestic stars',
        is_public: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty player set name', () => {
      const result = playerSetSchema.safeParse({
        name: '',
        description: 'Some desc',
        is_public: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('playerSchema', () => {
    it('1. validates a full valid player input V2', () => {
      const result = playerSchema.safeParse({
        name: 'Virat Kohli',
        country: 'India',
        role: 'BATSMAN',
        category: 'MARQUEE',
        base_price: 200,
        is_overseas: false,
        image_url: 'https://example.com/kohli.jpg',
        age: 35,
        batting_hand: 'Right-hand bat',
        matches: 237,
        runs: 7263,
        batting_average: 37.25,
        strike_rate: 130.02,
        hundreds: 7,
        fifties: 50,
        highest_score: 113,
        boundaries: 643,
      });
      expect(result.success).toBe(true);
    });

    it('2. country validation: rejects missing country for new player', () => {
      const result = playerSchema.safeParse({
        name: 'No Country Player',
        country: '', // Empty country
        role: 'BATSMAN',
        category: 'C',
        base_price: 75,
      });
      expect(result.success).toBe(false);
    });

    it('3. role validation: rejects invalid role', () => {
      const result = playerSchema.safeParse({
        name: 'Player One',
        country: 'India',
        role: 'CAPTAIN', // invalid
        category: 'A',
        base_price: 150,
      });
      expect(result.success).toBe(false);
    });

    it('4. category validation: rejects invalid category', () => {
      const result = playerSchema.safeParse({
        name: 'Player Two',
        country: 'Australia',
        role: 'BOWLER',
        category: 'GOLD', // invalid
        base_price: 100,
      });
      expect(result.success).toBe(false);
    });

    it('5. base price validation: rejects base_price < 1', () => {
      const result = playerSchema.safeParse({
        name: 'Player Three',
        country: 'India',
        role: 'BATSMAN',
        category: 'C',
        base_price: 0,
      });
      expect(result.success).toBe(false);
    });

    it('9. invalid negative statistics: rejects negative values in Zod', () => {
      const result = playerSchema.safeParse({
        name: 'Negative Stat Player',
        country: 'India',
        role: 'BATSMAN',
        category: 'C',
        base_price: 75,
        runs: -50,
      });
      expect(result.success).toBe(false);
    });

    it('10. decimal statistics: accepts valid decimal statistics', () => {
      const result = playerSchema.safeParse({
        name: 'Decimal Player',
        country: 'Australia',
        role: 'BOWLER',
        category: 'A',
        base_price: 150,
        bowling_average: 24.35,
        economy_rate: 7.82,
        overs: 450.2,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Category UI Mappings', () => {
    it('correctly maps internal category enums to UI display labels', () => {
      expect(CATEGORY_UI_LABELS.MARQUEE).toBe('ICON PLAYERS');
      expect(CATEGORY_UI_LABELS.A).toBe('ELITE PLAYERS');
      expect(CATEGORY_UI_LABELS.B).toBe('PREMIER PLAYERS');
      expect(CATEGORY_UI_LABELS.C).toBe('CORE PLAYERS');
      expect(CATEGORY_UI_LABELS.D).toBe('RISING STARS');
    });

    it('correctly associates default base prices for categories in Lakhs', () => {
      expect(CATEGORY_BASE_PRICES.MARQUEE).toBe(200);
      expect(CATEGORY_BASE_PRICES.A).toBe(150);
      expect(CATEGORY_BASE_PRICES.B).toBe(100);
      expect(CATEGORY_BASE_PRICES.C).toBe(75);
      expect(CATEGORY_BASE_PRICES.D).toBe(50);
    });
  });
});

describe('Player Master Data V2 — Native CSV Parser', () => {
  describe('parseCSVLine', () => {
    it('splits simple comma separated fields', () => {
      const fields = parseCSVLine('Virat Kohli,India,BATSMAN,MARQUEE,200');
      expect(fields).toEqual(['Virat Kohli', 'India', 'BATSMAN', 'MARQUEE', '200']);
    });

    it('correctly handles quoted fields containing commas', () => {
      const fields = parseCSVLine('"Kohli, Virat",India,BATSMAN,"MARQUEE, STAR",200');
      expect(fields).toEqual(['Kohli, Virat', 'India', 'BATSMAN', 'MARQUEE, STAR', '200']);
    });

    it('handles escaped quotes inside quoted fields', () => {
      const fields = parseCSVLine('"Player ""The Boss"" One",Australia,BOWLER,A,150');
      expect(fields).toEqual(['Player "The Boss" One', 'Australia', 'BOWLER', 'A', '150']);
    });
  });

  describe('parsePlayerCSV', () => {
    it('6. parses full 25-column CSV text cleanly', () => {
      const csvData = `name,country,role,age,batting_hand,category,base_price,image_url,matches,runs,batting_average,strike_rate,hundreds,fifties,highest_score,boundaries,overs,wickets,bowling_average,economy_rate,bowling_strike_rate,best_bowling,three_wicket_hauls,catches,stumpings
Virat Kohli,India,BATSMAN,35,Right-hand bat,MARQUEE,200,https://example.com/kohli.jpg,237,7263,37.25,130.02,7,50,113,643,,,,,,,,,,
Jasprit Bumrah,India,BOWLER,30,Right-hand bat,MARQUEE,200,,120,,,,,,,,450.5,145,23.3,7.39,18.6,5/10,12,,
Pat Cummins,Australia,ALL_ROUNDER,31,Right-hand bat,A,150,,42,379,18.95,152.2,0,1,56,32,152.0,45,30.1,8.5,20.2,4/34,4,,`;

      const result = parsePlayerCSV(csvData);
      expect(result.errors.length).toBe(0);
      expect(result.validRows.length).toBe(3);

      const kohli = result.validRows[0]!;
      expect(kohli.name).toBe('Virat Kohli');
      expect(kohli.country).toBe('India');
      expect(kohli.is_overseas).toBe(false);
      expect(kohli.category).toBe('MARQUEE');
      expect(kohli.base_price).toBe(200);
      expect(kohli.runs).toBe(7263);
      expect(kohli.batting_average).toBe(37.25);
      expect(kohli.strike_rate).toBe(130.02);
      expect(kohli.wickets).toBeNull(); // Role null rule for BATSMAN

      const cummins = result.validRows[2]!;
      expect(cummins.name).toBe('Pat Cummins');
      expect(cummins.country).toBe('Australia');
      expect(cummins.is_overseas).toBe(true); // Derived overseas
    });

    it('7. derives is_overseas automatically from country (India -> false, Australia/England -> true)', () => {
      const csvData = `name,country,role,category,base_price
Rohit Sharma,India,BATSMAN,MARQUEE,200
Travis Head,Australia,BATSMAN,A,150
Jos Buttler,England,WICKET_KEEPER,MARQUEE,200`;

      const result = parsePlayerCSV(csvData);
      expect(result.validRows.length).toBe(3);
      expect(result.validRows[0]?.is_overseas).toBe(false);
      expect(result.validRows[1]?.is_overseas).toBe(true);
      expect(result.validRows[2]?.is_overseas).toBe(true);
    });

    it('8. enforces role-specific null rules for non-applicable statistics', () => {
      const csvData = `name,country,role,matches,runs,wickets,catches
Pure Batsman,India,BATSMAN,50,1500,25,10
Pure Bowler,India,BOWLER,40,300,60,5
Wicket Keeper,India,WICKET_KEEPER,30,800,10,15`;

      const result = parsePlayerCSV(csvData);
      expect(result.validRows.length).toBe(3);

      const batsman = result.validRows[0]!;
      expect(batsman.runs).toBe(1500);
      expect(batsman.wickets).toBeNull(); // Non-applicable stats set to NULL
      expect(batsman.catches).toBeNull();

      const bowler = result.validRows[1]!;
      expect(bowler.wickets).toBe(60);
      expect(bowler.runs).toBeNull();
      expect(bowler.catches).toBeNull();

      const keeper = result.validRows[2]!;
      expect(keeper.runs).toBe(800);
      expect(keeper.catches).toBe(15);
      expect(keeper.wickets).toBeNull();
    });

    it('9. rejects invalid negative statistics in CSV import', () => {
      const csvData = `name,country,role,category,base_price,runs,wickets
Player 1,India,BATSMAN,A,150,-10,0
Player 2,Australia,BOWLER,B,100,0,-5`;

      const result = parsePlayerCSV(csvData);
      expect(result.validRows.length).toBe(0);
      expect(result.errors.length).toBe(2);
      expect(result.errors[0]?.field).toBe('runs');
      expect(result.errors[1]?.field).toBe('wickets');
    });

    it('10. handles decimal statistics (38.11, 147.52, 7.82) correctly', () => {
      const csvData = `name,country,role,category,base_price,batting_average,strike_rate,economy_rate
Star Player,India,ALL_ROUNDER,MARQUEE,200,38.11,147.52,7.82`;

      const result = parsePlayerCSV(csvData);
      expect(result.validRows.length).toBe(1);
      const player = result.validRows[0]!;
      expect(player.batting_average).toBe(38.11);
      expect(player.strike_rate).toBe(147.52);
      expect(player.economy_rate).toBe(7.82);
    });

    it('11. supports existing basic CSV with is_overseas column fallback for legacy rows', () => {
      const csvData = `name,role,category,base_price,is_overseas
Legacy Domestic,BATSMAN,MARQUEE,200,false
Legacy Overseas,BOWLER,A,150,true`;

      const result = parsePlayerCSV(csvData);
      expect(result.validRows.length).toBe(2);
      expect(result.validRows[0]?.country).toBe('India');
      expect(result.validRows[0]?.is_overseas).toBe(false);
      expect(result.validRows[1]?.country).toBe('Overseas');
      expect(result.validRows[1]?.is_overseas).toBe(true);
    });

    it('fails row validation when country is missing and is_overseas is not provided', () => {
      const csvData = `name,role,category,base_price
Missing Country Player,BATSMAN,C,75`;

      const result = parsePlayerCSV(csvData);
      expect(result.validRows.length).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.field).toBe('country');
    });
  });

  describe('PlayerCard getRoleStats Foundation', () => {
    it('returns exactly 8 role-specific stats for BATSMAN', () => {
      const p: any = {
        role: 'BATSMAN',
        matches: 100,
        runs: 3500,
        batting_average: 41.2,
        strike_rate: 135.5,
        hundreds: 5,
        fifties: 25,
        highest_score: 110,
        boundaries: 320,
      };
      const stats = getRoleStats(p);
      expect(stats.length).toBe(8);
      expect(stats[0]).toEqual({ label: 'Matches', value: 100 });
      expect(stats[1]).toEqual({ label: 'Runs', value: 3500 });
      expect(stats[7]).toEqual({ label: 'Boundaries', value: 320 });
    });

    it('returns exactly 8 role-specific stats for BOWLER', () => {
      const p: any = {
        role: 'BOWLER',
        matches: 80,
        overs: 310.4,
        wickets: 110,
        bowling_average: 22.4,
        economy_rate: 7.2,
        bowling_strike_rate: 18.2,
        best_bowling: '5/18',
        three_wicket_hauls: 8,
      };
      const stats = getRoleStats(p);
      expect(stats.length).toBe(8);
      expect(stats[1]).toEqual({ label: 'Overs', value: 310.4 });
      expect(stats[2]).toEqual({ label: 'Wickets', value: 110 });
      expect(stats[6]).toEqual({ label: 'Best Bowling', value: '5/18' });
    });
  });
});
