-- Migration: 00042_cleanup_obsolete_og_sets.sql
-- Description: Clean up old OG player sets (IDs: 9bb0e071-6da5-4cb2-8806-8e6bf19e445b, 66fc8cfe-b4c0-4037-9736-9b9db0235a0c) which are no longer needed and have 0 dependent auctions.

DO $$
BEGIN
    -- Delete players associated strictly with the two obsolete sets
    DELETE FROM public.players
    WHERE player_set_id IN (
        '9bb0e071-6da5-4cb2-8806-8e6bf19e445b'::uuid,
        '66fc8cfe-b4c0-4037-9736-9b9db0235a0c'::uuid
    );

    -- Delete the two obsolete player sets themselves
    DELETE FROM public.player_sets
    WHERE id IN (
        '9bb0e071-6da5-4cb2-8806-8e6bf19e445b'::uuid,
        '66fc8cfe-b4c0-4037-9736-9b9db0235a0c'::uuid
    );
END $$;
