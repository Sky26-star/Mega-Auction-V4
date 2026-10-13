-- Migration: 00010_player_master_data_v2.sql
-- Description: Extend players table with Player Master Data V2 fields (country, age, batting_hand, and 17 role-specific statistics)

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS age INT CHECK (age IS NULL OR age >= 0),
  ADD COLUMN IF NOT EXISTS batting_hand TEXT,

  -- Batting Statistics
  ADD COLUMN IF NOT EXISTS matches INT CHECK (matches IS NULL OR matches >= 0),
  ADD COLUMN IF NOT EXISTS runs INT CHECK (runs IS NULL OR runs >= 0),
  ADD COLUMN IF NOT EXISTS batting_average NUMERIC CHECK (batting_average IS NULL OR batting_average >= 0),
  ADD COLUMN IF NOT EXISTS strike_rate NUMERIC CHECK (strike_rate IS NULL OR strike_rate >= 0),
  ADD COLUMN IF NOT EXISTS hundreds INT CHECK (hundreds IS NULL OR hundreds >= 0),
  ADD COLUMN IF NOT EXISTS fifties INT CHECK (fifties IS NULL OR fifties >= 0),
  ADD COLUMN IF NOT EXISTS highest_score INT CHECK (highest_score IS NULL OR highest_score >= 0),
  ADD COLUMN IF NOT EXISTS boundaries INT CHECK (boundaries IS NULL OR boundaries >= 0),

  -- Bowling Statistics
  ADD COLUMN IF NOT EXISTS overs NUMERIC CHECK (overs IS NULL OR overs >= 0),
  ADD COLUMN IF NOT EXISTS wickets INT CHECK (wickets IS NULL OR wickets >= 0),
  ADD COLUMN IF NOT EXISTS bowling_average NUMERIC CHECK (bowling_average IS NULL OR bowling_average >= 0),
  ADD COLUMN IF NOT EXISTS economy_rate NUMERIC CHECK (economy_rate IS NULL OR economy_rate >= 0),
  ADD COLUMN IF NOT EXISTS bowling_strike_rate NUMERIC CHECK (bowling_strike_rate IS NULL OR bowling_strike_rate >= 0),
  ADD COLUMN IF NOT EXISTS best_bowling TEXT,
  ADD COLUMN IF NOT EXISTS three_wicket_hauls INT CHECK (three_wicket_hauls IS NULL OR three_wicket_hauls >= 0),
  ADD COLUMN IF NOT EXISTS five_wicket_hauls INT CHECK (five_wicket_hauls IS NULL OR five_wicket_hauls >= 0),

  -- Wicket-Keeping Statistics
  ADD COLUMN IF NOT EXISTS catches INT CHECK (catches IS NULL OR catches >= 0),
  ADD COLUMN IF NOT EXISTS stumpings INT CHECK (stumpings IS NULL OR stumpings >= 0);
