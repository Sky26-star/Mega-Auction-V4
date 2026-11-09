import { describe, expect, it } from 'vitest';
import { validateProductionConfig } from '../../../scripts/check-production-config.mjs';

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key',
  NEXT_PUBLIC_APP_URL: 'https://mega-auction.vercel.app',
  SUPABASE_SERVICE_ROLE_KEY: 'private-key',
  AUCTION_TICK_SECRET: 'a'.repeat(64),
};
describe('production configuration', () => {
  it('accepts hosted free-domain setup without Clerk', () => expect(validateProductionConfig(valid)).toEqual([]));
  it.each(['http://localhost:3000', 'https://127.0.0.1', 'https://[::1]', 'https://192.168.1.2', 'https://10.0.0.2', 'https://user:password@app.vercel.app', 'https://app.vercel.app/path'])(
    'rejects a local or malformed origin %s', origin => expect(validateProductionConfig({ ...valid, NEXT_PUBLIC_APP_URL: origin }).length).toBeGreaterThan(0),
  );
  it('rejects missing secrets and private credentials in public variables without revealing values', () => {
    const issues = validateProductionConfig({ ...valid, AUCTION_TICK_SECRET: '', NEXT_PUBLIC_SERVICE_ROLE_KEY: 'never-print-me' });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).not.toContain('never-print-me');
  });
});
