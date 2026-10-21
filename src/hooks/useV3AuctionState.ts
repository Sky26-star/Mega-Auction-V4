import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@clerk/nextjs';
import { V3AuctionState, V3Auction, V3AuctionLot, V3Team, V3Player } from '@/lib/v3-auction-types';

let nextV3AuctionStateInstanceId = 0;

export function useV3AuctionState(roomId: string) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [instanceId] = useState(() => ++nextV3AuctionStateInstanceId);
  const [state, setState] = useState<V3AuctionState>({
    auction: null,
    currentLot: null,
    currentPlayer: null,
    teams: [],
    miniSession: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animation, setAnimation] = useState<{
    status: 'SOLD' | 'UNSOLD';
    lot: V3AuctionLot;
    player: V3Player;
  } | null>(null);


  const authRef = useRef({ isLoaded, isSignedIn, getToken });
  useEffect(() => {
    authRef.current = { isLoaded, isSignedIn, getToken };
  }, [isLoaded, isSignedIn, getToken]);

  const supabase = useMemo(
    () =>
      createClient(async () => {
        if (!authRef.current.isLoaded || !authRef.current.isSignedIn) return null;
        return authRef.current.getToken({ template: 'supabase' });
      }),
    []
  );

  // Synchronize Realtime authentication with Clerk JWT
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;

    const syncRealtimeToken = async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!cancelled && token) {
          await supabase.realtime.setAuth(token);
        }
      } catch (err) {
        console.error('[useV3AuctionState] Failed to set Realtime auth token:', err);
      }
    };

    syncRealtimeToken();
    const refreshInterval = setInterval(syncRealtimeToken, 50000);

    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
  }, [isLoaded, isSignedIn, getToken, supabase]);

  const mountedRef = useRef(true);
  const lastAnimatedLotIdRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  const fetchSeqRef = useRef<number>(0);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const triggerAnimation = useCallback(async (lotId: string, knownLot?: V3AuctionLot, knownPlayer?: V3Player | null) => {
    if (lastAnimatedLotIdRef.current === lotId) return;

    try {
      let lot = knownLot;
      if (!lot) {
        const { data } = await supabase.from('auction_lots').select('*').eq('id', lotId).single();
        lot = data;
      }

      if (!lot || (lot.status !== 'SOLD' && lot.status !== 'UNSOLD')) {
        return;
      }

      let player = knownPlayer;
      if (!player || player.id !== lot.player_id) {
        const { data } = await supabase.from('players').select('*').eq('id', lot.player_id).single();
        player = data;
      }

      if (player && mountedRef.current) {
        lastAnimatedLotIdRef.current = lotId;
        setAnimation({ status: lot.status as 'SOLD' | 'UNSOLD', lot, player });

        setTimeout(() => {
          if (mountedRef.current) {
            setAnimation(null);
          }
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to trigger animation authoritatively', err);
    }
  }, [supabase]);

  const fetchState = useCallback(async () => {
    if (!roomId) return;
    if (!isLoaded) return; // Wait for Clerk authentication to resolve
    if (!isSignedIn) {
      if (mountedRef.current) {
        setError('Authentication required');
        setLoading(false);
      }
      return;
    }

    const seq = ++fetchSeqRef.current;

    try {
      setError(null);
      // 1. Fetch Auction (Prioritize active auction using exact same logic as backend)
      let { data: auctions, error: auctionError } = await supabase
        .from('auctions')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false });

      if (auctionError) throw auctionError;

      if (!auctions || auctions.length === 0) {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'get_authoritative_auction_state',
          { p_room_id: roomId }
        );

        if (rpcError) throw rpcError;

        const raw = rpcData as Record<string, any> | null;

        // When RPC explicitly returns NO_AUCTION_FOUND, treat this as valid room/lobby state
        if (raw?.status === 'NO_AUCTION_FOUND') {
          if (mountedRef.current && seq === fetchSeqRef.current) {
            setState({
              auction: null,
              currentLot: null,
              currentPlayer: null,
              teams: [],
              miniSession: null,
            });
            setError(null);
          }
          return;
        }

        if (!raw?.success || !raw.auctionId || !raw.status) {
          throw new Error(
            'Auction state unavailable: direct query and authoritative RPC returned no usable state'
          );
        }

        const playerStats = raw.player_stats ?? {};

        const allowedLotStatuses = [
          'PENDING',
          'GET_READY',
          'ACTIVE',
          'BIDDING',
          'SOLD',
          'UNSOLD',
          'SKIPPED',
        ];

        const rpcLotStatus = allowedLotStatuses.includes(raw.lotStatus)
          ? raw.lotStatus
          : null;

        const rpcTeams: V3Team[] = (
          Array.isArray(raw.teams) ? raw.teams : []
        ).map((team: any) => ({
          id: team.id,
          name: team.name,
          short_name: team.shortName ?? team.name,
          purse: Number(team.purse ?? 0),
          initial_purse: Number(team.initial_purse ?? team.purse ?? 0),
          players_bought: Number(team.playersBought ?? 0),
          overseas_count: Number(team.overseas_count ?? 0),
          is_bot: Boolean(team.is_bot),
        }));

        const rpcPlayer: V3Player | null =
          raw.playerId && playerStats.name
            ? {
              id: raw.playerId,
              name: playerStats.name,
              role: playerStats.role,
              category: playerStats.category,
              country: playerStats.country ?? '',
              age: playerStats.age ?? null,
              batting_hand: playerStats.batting_hand ?? null,
              base_price: Number(playerStats.base_price ?? 0),
              is_overseas:
                typeof playerStats.is_overseas === 'boolean'
                  ? playerStats.is_overseas
                  : String(playerStats.country ?? '').toLowerCase() !== 'india',
              image_url: playerStats.image_url ?? null,
              matches: playerStats.matches ?? null,
              runs: playerStats.runs ?? null,
              batting_average: playerStats.batting_average ?? null,
              strike_rate: playerStats.strike_rate ?? null,
              hundreds: playerStats.hundreds ?? null,
              fifties: playerStats.fifties ?? null,
              highest_score: playerStats.highest_score ?? null,
              boundaries: playerStats.boundaries ?? null,
              overs: playerStats.overs ?? null,
              wickets: playerStats.wickets ?? null,
              bowling_average: playerStats.bowling_average ?? null,
              economy_rate: playerStats.economy_rate ?? null,
              bowling_strike_rate: playerStats.bowling_strike_rate ?? null,
              best_bowling: playerStats.best_bowling ?? null,
              three_wicket_hauls: playerStats.three_wicket_hauls ?? null,
              catches: playerStats.catches ?? null,
              stumpings: playerStats.stumpings ?? null,
            }
            : null;

        const rpcLot: V3AuctionLot | null =
          raw.lotId && raw.playerId && rpcLotStatus
            ? {
              id: raw.lotId,
              auction_id: raw.auctionId,
              player_id: raw.playerId,
              lot_index: Number(raw.lotIndex ?? 0),
              status: rpcLotStatus as V3AuctionLot['status'],
              base_price: Number(playerStats.base_price ?? 0),
              current_bid: Number(raw.currentBid ?? 0),
              highest_bidder_team_id: raw.highestBidderId ?? null,
              winning_team_id: raw.winningTeamId ?? null,
              winning_bid:
                typeof raw.winningBid === 'number' ? raw.winningBid : null,
              get_ready_expires_at: raw.getReadyExpiresAt ?? null,
              timer_expires_at: raw.timerExpiresAt ?? null,
              is_mini_round: Boolean(raw.isUnsoldRound),
            }
            : null;

        const rpcAuction: V3Auction = {
          id: raw.auctionId,
          room_id: roomId,
          status: raw.status as V3Auction['status'],
          current_lot_id: raw.lotId ?? null,
          current_lot_index: Number(raw.lotIndex ?? 0),
          is_unsold_round: Boolean(raw.isUnsoldRound),
        };

        if (mountedRef.current && seq === fetchSeqRef.current) {
          if (rpcLot && (rpcLot.status === 'SOLD' || rpcLot.status === 'UNSOLD') && rpcPlayer) {
            triggerAnimation(rpcLot.id, rpcLot, rpcPlayer);
          }

          setState(prev => {
            let nextLot = rpcLot;
            if (
              prev.currentLot &&
              nextLot &&
              prev.currentLot.id === nextLot.id
            ) {
              const prevBid = Number(prev.currentLot.current_bid ?? 0);
              const incomingBid = Number(nextLot.current_bid ?? 0);
              const isStaleStatus = prev.currentLot.status === 'BIDDING' && nextLot.status === 'GET_READY';
              const effectiveStatus = isStaleStatus ? 'BIDDING' : nextLot.status;

              if (Number.isFinite(prevBid) && Number.isFinite(incomingBid) && prevBid > incomingBid) {
                nextLot = {
                  ...nextLot,
                  status: effectiveStatus,
                  current_bid: prevBid,
                  highest_bidder_team_id: prev.currentLot.highest_bidder_team_id,
                  timer_expires_at: prev.currentLot.timer_expires_at || nextLot.timer_expires_at,
                };
              } else if (isStaleStatus) {
                nextLot = {
                  ...nextLot,
                  status: effectiveStatus,
                };
              }
            }

            return {
              auction: rpcAuction,
              currentLot: nextLot,
              currentPlayer: rpcPlayer,
              teams: rpcTeams,
              miniSession: null,
            };
          });
        }

        return;
      }

      const statusWeight = (status: string) => {
        if (status === 'IN_PROGRESS') return 1;
        if (status === 'PAUSED') return 2;
        if (status === 'MINI_AUCTION') return 3;
        if (status === 'COMPLETED') return 4;
        return 5;
      };

      auctions.sort((a, b) => {
        const weightA = statusWeight(a.status);
        const weightB = statusWeight(b.status);
        if (weightA !== weightB) return weightA - weightB;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      const auctionData = auctions[0];
      const auction: V3Auction = auctionData;

      // 2. Fetch Teams
      const { data: teamsData, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .eq('auction_id', auction.id)
        .order('name');

      if (teamsError) throw teamsError;

      // 3. Fetch Current Lot and Player (if active)
      let currentLot: V3AuctionLot | null = null;
      let currentPlayer: V3Player | null = null;

      if (auction.current_lot_id) {
        const { data: lotData, error: lotError } = await supabase
          .from('auction_lots')
          .select('*')
          .eq('id', auction.current_lot_id)
          .single();

        if (lotError && lotError.code !== 'PGRST116') throw lotError; // PGRST116 is no rows
        if (lotData) {
          currentLot = lotData;
        }
      }

      // Authoritative fallback: if current_lot_id is null/delayed, resolve by lot_index
      if (!currentLot && typeof auction.current_lot_index === 'number') {
        const { data: lotData } = await supabase
          .from('auction_lots')
          .select('*')
          .eq('auction_id', auction.id)
          .eq('lot_index', auction.current_lot_index)
          .maybeSingle();

        if (lotData) {
          currentLot = lotData;
        }
      }

      // Fallback: active lot in progress
      if (!currentLot && auction.status === 'IN_PROGRESS') {
        const { data: lotData } = await supabase
          .from('auction_lots')
          .select('*')
          .eq('auction_id', auction.id)
          .in('status', ['BIDDING', 'GET_READY'])
          .order('lot_index', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (lotData) {
          currentLot = lotData;
        }
      }

      if (currentLot) {
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('*')
          .eq('id', currentLot.player_id)
          .single();

        if (playerError && playerError.code !== 'PGRST116') throw playerError;
        if (playerData) {
          currentPlayer = playerData;
        }
      }

      // Check if current lot is finalized (SOLD/UNSOLD)
      if (currentLot && (currentLot.status === 'SOLD' || currentLot.status === 'UNSOLD') && currentPlayer) {
        triggerAnimation(currentLot.id, currentLot, currentPlayer);
      }

      // Check if previous lot was just finalized and transitioned to next lot
      const prevLot = stateRef.current.currentLot;
      if (
        prevLot &&
        currentLot &&
        prevLot.id !== currentLot.id &&
        prevLot.auction_id === auction.id &&
        lastAnimatedLotIdRef.current !== prevLot.id
      ) {
        const { data: finalizedLot } = await supabase
          .from('auction_lots')
          .select('*')
          .eq('id', prevLot.id)
          .single();
        if (finalizedLot && (finalizedLot.status === 'SOLD' || finalizedLot.status === 'UNSOLD')) {
          triggerAnimation(finalizedLot.id, finalizedLot, stateRef.current.currentPlayer);
        }
      }

      // Check if auction is COMPLETED and final lot needs animation
      if (auction.status === 'COMPLETED' && !currentLot) {
        const targetLot = prevLot;
        if (targetLot && lastAnimatedLotIdRef.current !== targetLot.id) {
          const { data: finalizedLot } = await supabase
            .from('auction_lots')
            .select('*')
            .eq('id', targetLot.id)
            .single();
          if (finalizedLot && (finalizedLot.status === 'SOLD' || finalizedLot.status === 'UNSOLD')) {
            triggerAnimation(finalizedLot.id, finalizedLot, stateRef.current.currentPlayer);
          }
        }
      }

      // 4. Fetch Mini Auction Session (if exists)
      const { data: miniData, error: miniError } = await supabase
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', auction.id)
        .maybeSingle();

      if (miniError && miniError.code !== 'PGRST116') {
        console.error('Error fetching mini auction session:', miniError);
      }

      if (mountedRef.current && seq === fetchSeqRef.current) {
        setState(prev => {
          let nextLot = currentLot;
          if (
            prev.currentLot &&
            nextLot &&
            prev.currentLot.id === nextLot.id
          ) {
            const prevBid = Number(prev.currentLot.current_bid ?? 0);
            const incomingBid = Number(nextLot.current_bid ?? 0);
            const isStaleStatus = prev.currentLot.status === 'BIDDING' && nextLot.status === 'GET_READY';
            const effectiveStatus = isStaleStatus ? 'BIDDING' : nextLot.status;

            if (Number.isFinite(prevBid) && Number.isFinite(incomingBid) && prevBid > incomingBid) {
              nextLot = {
                ...nextLot,
                status: effectiveStatus,
                current_bid: prevBid,
                highest_bidder_team_id: prev.currentLot.highest_bidder_team_id,
                timer_expires_at: prev.currentLot.timer_expires_at || nextLot.timer_expires_at,
              };
            } else if (isStaleStatus) {
              nextLot = {
                ...nextLot,
                status: effectiveStatus,
              };
            }
          }

          return {
            auction,
            currentLot: nextLot,
            currentPlayer,
            teams: teamsData || [],
            miniSession: miniData || null,
          };
        });
      }
    } catch (err: any) {
      const errName = err?.name || (err?.code ? `PostgrestError(${err.code})` : 'Error');
      const errMessage = err?.message || (typeof err === 'string' ? err : 'Unknown error');
      const errCode = err?.code ? ` [Code: ${err.code}]` : '';
      const errDetails = err?.details ? ` [Details: ${err.details}]` : '';
      const errHint = err?.hint ? ` [Hint: ${err.hint}]` : '';

      console.error(
        `Error fetching V3 auction state: ${errName}: ${errMessage}${errCode}${errDetails}${errHint}`,
        err
      );
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setError(err?.message || (typeof err === 'string' ? err : 'Failed to fetch auction state'));
      }
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [roomId, isLoaded, isSignedIn, supabase, triggerAnimation]);

  useEffect(() => {
    mountedRef.current = true;

    if (roomId && isLoaded) {
      fetchState();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [roomId, isLoaded, fetchState]);

  // Ref to hold the current player synchronously for animation
  const currentPlayerRef = useRef<V3Player | null>(null);
  useEffect(() => {
    currentPlayerRef.current = state.currentPlayer;
  }, [state.currentPlayer]);

  // Realtime Subscriptions
  useEffect(() => {
    if (!roomId || !state.auction?.id) return;

    const auctionId = state.auction.id;
    let refreshTimeout: NodeJS.Timeout | null = null;

    // Debounced refresh to avoid rapid re-renders if many events fire at once
    const triggerRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        if (mountedRef.current) {
          fetchState();
        }
      }, 200);
    };

    const channelId = `v3_auction_${auctionId}_instance_${instanceId}`;

    // Ensure Realtime socket has the authenticated Clerk token before subscribing
    if (authRef.current.isLoaded && authRef.current.isSignedIn) {
      authRef.current.getToken({ template: 'supabase' }).then((token) => {
        if (token && mountedRef.current) {
          supabase.realtime.setAuth(token).catch(() => {});
        }
      }).catch(() => {});
    }

    const channel = supabase.channel(channelId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'auctions',
        filter: `id=eq.${auctionId}`
      }, () => {
        triggerRefresh();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'auction_lots',
        filter: `auction_id=eq.${auctionId}`
      }, async (payload) => {
        const updatedLot = payload.new as V3AuctionLot;

        // Intercept SOLD / UNSOLD for animation
        if (updatedLot.status === 'SOLD' || updatedLot.status === 'UNSOLD') {
          triggerAnimation(updatedLot.id, updatedLot, currentPlayerRef.current);
        }

        // Apply state instantly to avoid fetch delays/caching issues for timers
        // Apply only non-stale lot updates.
        if (mountedRef.current) {
          const incomingBid = Number(updatedLot.current_bid);

          fetchSeqRef.current++;

          setState((prev) => {
            const currentLot = prev.currentLot;

            // Update for the same lot
            if (currentLot && currentLot.id === updatedLot.id) {
              const displayedBid = Number(currentLot.current_bid);

              // Monotonic bid protection on the SAME lot:
              // Never move bid backwards while actively bidding
              if (
                Number.isFinite(incomingBid) &&
                Number.isFinite(displayedBid) &&
                incomingBid < displayedBid &&
                currentLot.status === 'BIDDING' &&
                updatedLot.status === 'BIDDING'
              ) {
                return {
                  ...prev,
                  currentLot: {
                    ...currentLot,
                    ...updatedLot,
                    current_bid: displayedBid,
                    highest_bidder_team_id: currentLot.highest_bidder_team_id || updatedLot.highest_bidder_team_id,
                  },
                };
              }

              return {
                ...prev,
                currentLot: {
                  ...currentLot,
                  ...updatedLot,
                },
              };
            }

            // Update for a different lot (lot transition or newly active lot)
            const isNewActiveLot =
              !currentLot ||
              updatedLot.status === 'GET_READY' ||
              updatedLot.status === 'BIDDING' ||
              (updatedLot.status as string) === 'ACTIVE' ||
              ((currentLot.status === 'SOLD' || currentLot.status === 'UNSOLD') && updatedLot.lot_index >= currentLot.lot_index);

            if (isNewActiveLot) {
              // Lot changes must not retain stale bid state from the prior lot
              return {
                ...prev,
                currentLot: updatedLot,
              };
            }

            return prev;
          });

          // If the lot transitioned and player is not yet loaded, load it asynchronously
          if (updatedLot.player_id && stateRef.current.currentPlayer?.id !== updatedLot.player_id) {
            supabase
              .from('players')
              .select('*')
              .eq('id', updatedLot.player_id)
              .single()
              .then(({ data: newPlayer }) => {
                if (newPlayer && mountedRef.current) {
                  setState((latest) => {
                    if (latest.currentLot?.id === updatedLot.id) {
                      return { ...latest, currentPlayer: newPlayer };
                    }
                    return latest;
                  });
                }
              });
          }
        }

        triggerRefresh();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bids',
        filter: `auction_id=eq.${auctionId}`
      }, (payload) => {
        const newBid = payload.new as any;
        if (newBid && mountedRef.current) {
          const incomingBid = Number(newBid.amount);
          setState((prev) => {
            if (prev.currentLot && prev.currentLot.id === newBid.lot_id) {
              const currentBid = Number(prev.currentLot.current_bid ?? 0);
              if (Number.isFinite(incomingBid) && incomingBid > currentBid) {
                return {
                  ...prev,
                  currentLot: {
                    ...prev.currentLot,
                    current_bid: incomingBid,
                    highest_bidder_team_id: newBid.team_id,
                  }
                };
              }
            }
            return prev;
          });
        }
        triggerRefresh();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'teams',
        filter: `auction_id=eq.${auctionId}`
      }, () => {
        triggerRefresh();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mini_auction_sessions',
        filter: `auction_id=eq.${auctionId}`
      }, () => {
        triggerRefresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          triggerRefresh();
        }
      });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [roomId, state.auction?.id, fetchState, supabase, triggerAnimation, instanceId]);

  // Active sync heartbeat: while bidding or get_ready is in progress, poll state every 1000ms
  // so the browser UI never lags behind server bot bids even if websocket events are delayed.
  useEffect(() => {
    if (!roomId || !isLoaded || !isSignedIn) return;
    if (state.auction?.status !== 'IN_PROGRESS') return;
    if (state.currentLot?.status !== 'BIDDING' && state.currentLot?.status !== 'GET_READY') return;

    const syncInterval = setInterval(() => {
      if (mountedRef.current) {
        fetchState();
      }
    }, 1000);

    return () => clearInterval(syncInterval);
  }, [
    roomId,
    isLoaded,
    isSignedIn,
    state.auction?.status,
    state.currentLot?.status,
    state.currentLot?.id,
    fetchState
  ]);

  // The authenticated server worker owns transitions. Refresh after expiry so the
  // client reflects the worker's authoritative state without invoking a global tick.
  useEffect(() => {
    const lot = state.currentLot;

    let targetTime: string | null = null;
    if (state.auction?.status === 'MINI_AUCTION' && state.miniSession?.status === 'SELECTION_OPEN') {
      targetTime = state.miniSession.selection_expires_at ?? null;
    } else if (lot?.status === 'GET_READY') {
      targetTime = lot.get_ready_expires_at;
    } else if (lot?.status === 'BIDDING') {
      targetTime = lot.timer_expires_at;
    }

    if (!targetTime) return;

    const remainingMs = new Date(targetTime).getTime() - Date.now();
    const timeout = setTimeout(() => {
      if (mountedRef.current) {
        fetchState();
      }
    }, Math.max(0, remainingMs) + 300);

    return () => clearTimeout(timeout);
  }, [
    state.currentLot?.id,
    state.currentLot?.status,
    state.currentLot?.get_ready_expires_at,
    state.currentLot?.timer_expires_at,
    state.auction?.status,
    state.miniSession?.status,
    state.miniSession?.selection_expires_at,
    fetchState
  ]);

  return {
    state,
    loading,
    error,
    refresh: fetchState,
    animation,
    triggerAnimation
  };
}
