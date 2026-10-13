-- Migration: 00001_core_tables.sql
-- Description: Core entity tables for Mega Auction V1 (Profiles, Rooms, Player Sets, Players, Room Participants)

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ROOMS
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED')),
  settings JSONB NOT NULL DEFAULT '{
    "timer_duration_seconds": 15,
    "min_bid_increment": 5,
    "default_purse": 1000,
    "max_squad_size": 25,
    "max_overseas": 8,
    "player_set_id": null,
    "player_order": "CATEGORY"
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. PLAYER SETS
CREATE TABLE IF NOT EXISTS public.player_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. PLAYERS
CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_set_id UUID NOT NULL REFERENCES public.player_sets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER')),
  category TEXT NOT NULL DEFAULT 'C' CHECK (category IN ('MARQUEE', 'A', 'B', 'C', 'D')),
  base_price INT NOT NULL CHECK (base_price >= 1),
  is_overseas BOOLEAN NOT NULL DEFAULT false,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. ROOM PARTICIPANTS
CREATE TABLE IF NOT EXISTS public.room_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id UUID, -- FK to teams created in 00002
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('HOST', 'MEMBER', 'SPECTATOR')),
  is_bot BOOLEAN NOT NULL DEFAULT false,
  is_connected BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_room_user UNIQUE(room_id, user_id)
);
