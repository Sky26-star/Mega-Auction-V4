// src/lib/admin/loader.ts
// Authoritative Platform Admin Data Loader

import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyAdminUser } from './auth';

export interface AdminPlatformStats {
  totalUsers: number;
  totalRooms: number;
  activeRooms: number;
  activeAuctions: number;
  completedAuctions: number;
  totalPlayerSets: number;
  totalPlayers: number;
}

export interface AdminRoomItem {
  id: string;
  code: string;
  name: string;
  hostId: string;
  hostName: string;
  status: string;
  participantCount: number;
  auctionStatus: string | null;
  createdAt: string;
}

export interface AdminUserItem {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminPlayerSetItem {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  playerCount: number;
  createdByName: string;
  createdAt: string;
}

export interface AdminAuctionMonitorItem {
  auctionId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  status: string;
  currentSequence: number;
  completedLots: number;
  totalLots: number;
  updatedAt: string;
}

export interface AdminDashboardData {
  stats: AdminPlatformStats;
  rooms: AdminRoomItem[];
  users: AdminUserItem[];
  playerSets: AdminPlayerSetItem[];
  activeAuctions: AdminAuctionMonitorItem[];
  currentUserProfile: any;
}

export async function loadAdminDashboardData(): Promise<{
  data: AdminDashboardData | null;
  error: string | null;
}> {
  // 1. Authoritative Server Admin Security Verification
  const authCheck = await verifyAdminUser();
  if (!authCheck.authorized || !authCheck.profile) {
    return { data: null, error: authCheck.error || 'UNAUTHORIZED: Platform admin access required.' };
  }

  const supabase = await createServerClient();

  try {
    // 2. Parallel Database Queries for Platform Entities
    const [
      profilesRes,
      roomsRes,
      participantsRes,
      auctionsRes,
      playerSetsRes,
      playersRes,
      lotsRes,
    ] = await Promise.all([
      supabase.from('profiles').select('id, username, display_name, avatar_url, is_admin, created_at').order('created_at', { ascending: false }),
      supabase.from('rooms').select('id, code, name, host_id, status, created_at').order('created_at', { ascending: false }),
      supabase.from('room_participants').select('room_id'),
      supabase.from('auctions').select('id, room_id, status, current_sequence, updated_at, created_at').order('updated_at', { ascending: false }),
      supabase.from('player_sets').select('id, name, description, is_public, created_by, created_at'),
      supabase.from('players').select('id, player_set_id'),
      supabase.from('auction_lots').select('id, auction_id, status'),
    ]);

    const profiles = profilesRes.data || [];
    const rooms = roomsRes.data || [];
    const participants = participantsRes.data || [];
    const auctions = auctionsRes.data || [];
    const playerSets = playerSetsRes.data || [];
    const players = playersRes.data || [];
    const lots = lotsRes.data || [];

    // Map profiles for quick lookup
    const profileMap = new Map<string, string>();
    profiles.forEach((p: any) => {
      profileMap.set(p.id, p.display_name || p.username || 'User');
    });

    // Process Room Items
    const roomItems: AdminRoomItem[] = rooms.map((r: any) => {
      const roomParticipants = participants.filter((pt: any) => pt.room_id === r.id);
      const roomAuction = auctions.find((a: any) => a.room_id === r.id);

      return {
        id: r.id,
        code: r.code,
        name: r.name,
        hostId: r.host_id,
        hostName: profileMap.get(r.host_id) || 'Unknown Host',
        status: r.status,
        participantCount: roomParticipants.length,
        auctionStatus: roomAuction ? roomAuction.status : null,
        createdAt: r.created_at || new Date().toISOString(),
      };
    });

    // Process User Items
    const userItems: AdminUserItem[] = profiles.map((p: any) => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      isAdmin: Boolean(p.is_admin),
      createdAt: p.created_at || new Date().toISOString(),
    }));

    // Process Player Set Items
    const playerSetItems: AdminPlayerSetItem[] = playerSets.map((ps: any) => {
      const setPlayers = players.filter((pl: any) => pl.player_set_id === ps.id);
      return {
        id: ps.id,
        name: ps.name,
        description: ps.description,
        isPublic: Boolean(ps.is_public),
        playerCount: setPlayers.length,
        createdByName: profileMap.get(ps.created_by) || 'System',
        createdAt: ps.created_at || new Date().toISOString(),
      };
    });

    // Process Active Auctions Monitoring Items
    const activeAuctionItems: AdminAuctionMonitorItem[] = auctions
      .filter((a: any) => a.status === 'LIVE' || a.status === 'PAUSED' || a.status === 'READY')
      .map((a: any) => {
        const room = rooms.find((r: any) => r.id === a.room_id);
        const auctionLots = lots.filter((l: any) => l.auction_id === a.id);
        const completedLots = auctionLots.filter((l: any) => l.status === 'SOLD' || l.status === 'UNSOLD').length;

        return {
          auctionId: a.id,
          roomId: a.room_id,
          roomCode: room ? room.code : '---',
          roomName: room ? room.name : 'Unknown Room',
          status: a.status,
          currentSequence: a.current_sequence || 0,
          completedLots,
          totalLots: auctionLots.length,
          updatedAt: a.updated_at || a.created_at || new Date().toISOString(),
        };
      });

    // Compute Overall Platform Statistics
    const stats: AdminPlatformStats = {
      totalUsers: profiles.length,
      totalRooms: rooms.length,
      activeRooms: rooms.filter((r: any) => r.status === 'OPEN').length,
      activeAuctions: auctions.filter((a: any) => a.status === 'LIVE' || a.status === 'PAUSED').length,
      completedAuctions: auctions.filter((a: any) => a.status === 'COMPLETED').length,
      totalPlayerSets: playerSets.length,
      totalPlayers: players.length,
    };

    return {
      data: {
        stats,
        rooms: roomItems,
        users: userItems,
        playerSets: playerSetItems,
        activeAuctions: activeAuctionItems,
        currentUserProfile: authCheck.profile,
      },
      error: null,
    };
  } catch (err: any) {
    return {
      data: null,
      error: err?.message || 'FAILED_TO_LOAD_ADMIN_DATA: Could not retrieve platform statistics.',
    };
  }
}
