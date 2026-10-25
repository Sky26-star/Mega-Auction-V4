import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routeSource = resolve(process.cwd(), 'src/app/api/diag/route.ts');
const manifestPath = resolve(process.cwd(), '.next/server/app-paths-manifest.json');

if (existsSync(routeSource)) {
  throw new Error('Unsafe diagnostic route source is present at src/app/api/diag/route.ts');
}

if (!existsSync(manifestPath)) {
  throw new Error('Production app paths manifest is missing; run npm run build first.');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const diagnosticRoutes = Object.keys(manifest).filter(route =>
  route === '/api/diag' || route === '/api/diag/route'
);

if (diagnosticRoutes.length > 0) {
  throw new Error(`Unsafe diagnostic endpoint is present in the production manifest: ${diagnosticRoutes.join(', ')}`);
}

console.log('Verified: /api/diag is absent from source routing and the production app paths manifest.');
