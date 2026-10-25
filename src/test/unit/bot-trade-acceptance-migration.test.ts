import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = readProjectFile('supabase/migrations/20261020180000_bot_trade_acceptance_rpc.sql');
const tradeFoundation = readProjectFile('supabase/migrations/00059_player_trade_foundation.sql');
const botRespondRoute = readProjectFile('src/app/api/trade/bot-respond/route.ts');
const botCycleRoute = readProjectFile('src/app/api/trade/bot-cycle/route.ts');
const humanTradeHook = readProjectFile('src/hooks/useV3Trades.ts');

describe('dedicated bot trade acceptance migration and route contract', () => {
  it('patches only the reviewed ACCEPT predicate and preserves the existing function security settings', () => {
    expect(migration).toContain("'public.v3_respond_trade(uuid,text,text)'::regprocedure");
    expect(migration).toContain("v_before_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]");
    expect(migration).toContain('v_before_owner oid');
    expect(migration).toContain('v_before_config text[]');
    expect(migration).toContain('v_before_security_definer boolean');
    expect(migration).toContain("p_action = 'ACCEPT' AND auth.jwt()->>'role' = 'service_role'");
    expect(migration).toContain('NOT v_is_proposer OR v_is_bot_accept');
    expect(migration).toContain('v3_respond_trade differs from the reviewed 00059 authorization baseline');
  });

  it('requires a service-role JWT and derives the host from UUID identity or the Clerk mapping table', () => {
    expect(migration).toContain("IF v_role IS DISTINCT FROM 'service_role'");
    expect(migration).toContain('p_host_clerk_user_id::UUID');
    expect(migration).toContain('FROM public.clerk_user_mappings m');
    expect(migration).toContain("v_room.host_id IS DISTINCT FROM v_host_profile_id");
    expect(migration).toContain("'ERR_UNAUTHORIZED_BOT_TRADE_HOST'");
  });

  it('checks room/auction scope, both franchise rows, bot receiver, participant representation, pending state, and expiry', () => {
    expect(migration).toContain('FOR UPDATE OF tm');
    expect(migration).toContain('SELECT a.room_id INTO v_auction_room_id');
    expect(migration).toContain('v_auction_room_id IS DISTINCT FROM v_trade.room_id');
    expect(migration).toContain('tm.id = v_trade.proposer_team_id AND tm.auction_id = v_trade.auction_id');
    expect(migration).toContain('tm.id = v_trade.receiver_team_id AND tm.auction_id = v_trade.auction_id');
    expect(migration).toContain('IF NOT v_receiver_team.is_bot THEN');
    expect(migration).toContain('FROM public.room_participants rp');
    expect(migration).toContain("v_trade.status IS DISTINCT FROM 'PENDING'");
    expect(migration).toContain('v_now >= v_trade.expires_at');
  });

  it('delegates the atomic swap to the existing response function and clears the scoped context', () => {
    expect(migration).toContain("public.v3_respond_trade(v_trade.id, 'ACCEPT', p_notes)");
    expect(migration).toContain("set_config('app.v3_bot_trade_host_profile_id', v_host_profile_id::TEXT, true)");
    expect(migration).toContain("set_config('app.v3_bot_trade_host_profile_id', '', true)");
    expect(migration).toContain('EXCEPTION WHEN OTHERS THEN');
    // The migration must not copy those state-changing rules. Assert that the
    // delegated implementation still owns ownership, roster, player swap,
    // competing-offer, and audit-log behavior.
    expect(tradeFoundation).toContain('ERR_PROPOSER_PLAYER_NO_LONGER_OWNED');
    expect(tradeFoundation).toContain('ERR_RECEIVER_PLAYER_NO_LONGER_OWNED');
    expect(tradeFoundation).toContain('ERR_RECEIVER_SQUAD_LIMIT_EXCEEDED');
    expect(tradeFoundation).toContain('ERR_RECEIVER_OVERSEAS_LIMIT_EXCEEDED');
    expect(tradeFoundation).toContain('UPDATE public.squad_players');
    expect(tradeFoundation).toContain('FOR UPDATE SKIP LOCKED');
    expect(tradeFoundation).toContain("'ACCEPTED'");
  });

  it('grants the bot RPC only to service_role and keeps the ordinary RPC authenticated-only', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.v3_respond_bot_trade(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.v3_respond_bot_trade(UUID, TEXT, TEXT) TO service_role;');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.v3_respond_trade(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.v3_respond_trade(UUID, TEXT, TEXT) TO authenticated;');
    expect(migration).toContain('ALTER FUNCTION public.v3_respond_bot_trade(UUID, TEXT, TEXT) OWNER TO postgres;');
    expect(migration).toContain("pg_catalog.has_function_privilege('service_role', v_bot_oid, 'EXECUTE')");
    expect(migration).toContain("pg_catalog.has_function_privilege('authenticated', v_bot_oid, 'EXECUTE')");
    expect(migration).toContain("pg_catalog.has_function_privilege('anon', v_human_oid, 'EXECUTE')");
    expect(migration).toContain("p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public, auth']::text[]");
  });

  it('routes bot ACCEPT through the dedicated RPC, keeps REJECT/COUNTER and human acceptance on their existing paths', () => {
    expect(botRespondRoute).toContain("admin.rpc('v3_respond_bot_trade'");
    expect(botRespondRoute).toContain('p_host_clerk_user_id: userId');
    expect(botRespondRoute).toContain("callerClient.rpc('v3_respond_trade'");
    expect(botRespondRoute).toContain("callerClient.rpc('v3_propose_trade'");
    expect(botCycleRoute).toContain("admin.rpc('v3_respond_bot_trade'");
    expect(botCycleRoute).toContain("caller.rpc('v3_respond_trade'");
    expect(humanTradeHook).toContain("supabase.rpc('v3_respond_trade'");
  });
});
