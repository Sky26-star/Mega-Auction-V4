import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function validateProductionConfig(env) {
  const issues = [];
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_APP_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AUCTION_TICK_SECRET'];
  for (const name of required) {
    if (!env[name] || /your-project|your-supabase|replace-with|placeholder/i.test(env[name])) issues.push(`${name} must be configured.`);
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL']) {
    try {
      const url = new URL(env[name]);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1'
        || host.includes(':') || /^(0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
      if (url.protocol !== 'https:' || privateHost || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port) throw new Error();
    } catch { issues.push(`${name} must be a public HTTPS origin without a path, port or credentials.`); }
  }
  if (!env.AUCTION_TICK_SECRET || env.AUCTION_TICK_SECRET.length < 32 || /\s/.test(env.AUCTION_TICK_SECRET)) issues.push('AUCTION_TICK_SECRET must contain at least 32 characters without whitespace.');
  if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) issues.push('Public and server Supabase keys must be different.');
  for (const name of Object.keys(env)) {
    if (/^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|DATABASE_URL)/.test(name) && env[name]) issues.push(`${name} must not expose a private credential.`);
  }
  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { default: nextEnv } = await import('@next/env');
  nextEnv.loadEnvConfig(process.cwd(), false);
  const issues = validateProductionConfig(process.env);
  if (issues.length) {
    console.error('Production configuration check failed:\n' + issues.map(issue => '- ' + issue).join('\n'));
    process.exitCode = 1;
  } else console.log('Production configuration shape verified. Live credentials and hosted migrations still require verification.');
}
