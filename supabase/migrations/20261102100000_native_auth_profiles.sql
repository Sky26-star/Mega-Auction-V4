-- Native Supabase Auth identities keep the same UUID as their profile.
-- Historical Clerk mappings are preserved for review, never merged by email.
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_username text := NULLIF(left(regexp_replace(lower(COALESCE(NEW.raw_user_meta_data->>'username', '')), '[^a-z0-9_]', '', 'g'), 20), '');
  v_fallback text := 'manager_' || replace(NEW.id::text, '-', '');
  v_display text := left(COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''), NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), v_username, 'Auction manager'), 50);
  v_avatar text := CASE WHEN NEW.raw_user_meta_data->>'avatar_url' LIKE 'https://%' THEN NEW.raw_user_meta_data->>'avatar_url' ELSE NULL END;
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, username, display_name, avatar_url, is_admin)
    VALUES (NEW.id, COALESCE(v_username, v_fallback), v_display, v_avatar, false)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    -- Different people may choose the same name or share an email prefix.
    INSERT INTO public.profiles (id, username, display_name, avatar_url, is_admin)
    VALUES (NEW.id, v_fallback, v_display, v_avatar, false)
    ON CONFLICT (id) DO NOTHING;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;

-- Repair missing rows by verified Auth UUID only. Existing profiles and their
-- ownership/admin flags are untouched. No email/Clerk identity reassignment.
INSERT INTO public.profiles (id, username, display_name, is_admin)
SELECT u.id, 'manager_' || replace(u.id::text, '-', ''),
  left(COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), NULLIF(u.raw_user_meta_data->>'full_name', ''), 'Auction manager'), 50), false
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT DO NOTHING;

COMMIT;
