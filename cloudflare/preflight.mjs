#!/usr/bin/env node
// Preflight for `npm run cf:build` (Cloudflare Workers Builds / local).
//
// NEXT_PUBLIC_* variables are inlined into the bundle by `next build`, so
// they must exist in the BUILD environment. When they are missing the Next
// build fails ~2 minutes later with a cryptic prerender error on all 77
// pages ("@supabase/ssr: Your project's URL and API key are required…").
// Fail fast here with an actionable message instead.
//
// Cloudflare dashboard → Workers & Pages → <worker> → Settings → Build →
// "Variables and secrets" (these are the BUILD variables — different from
// the runtime "Variables and Secrets" section, which is also needed).
import { existsSync, readFileSync } from 'node:fs';

// Mirror Next's .env loading order so a local `.env.local` also satisfies the check.
for (const f of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const RECOMMENDED = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY'];

const missing = REQUIRED.filter((k) => !(process.env[k] ?? '').trim());
const missingRec = RECOMMENDED.filter((k) => !(process.env[k] ?? '').trim());

if (missingRec.length) {
  console.warn(`\n[cf:build] ⚠ optional build variable(s) not set: ${missingRec.join(', ')} (push notifications will use the runtime fallback /api/notifications/vapid)\n`);
}

if (missing.length) {
  console.error(`
[cf:build] ✘ Missing required BUILD variable(s): ${missing.join(', ')}

NEXT_PUBLIC_* values are baked into the bundle during \`next build\`, so they
must be available while Cloudflare builds the project (not only at runtime).

Fix (Cloudflare dashboard):
  Workers & Pages → this Worker → Settings → Build → Variables and secrets
    → add ${REQUIRED.join(' and ')}
      (copy the values from Vercel → Settings → Environment Variables)
  Also make sure:
    Build command  = npm run cf:build
    Deploy command = npx wrangler deploy
  Then Settings → Variables and Secrets (RUNTIME) → add the same NEXT_PUBLIC_*
  plus SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
  VAPID_SUBJECT, CRON_SECRET.

Local: copy .env.example → .env.local and fill it in.
`);
  process.exit(1);
}

console.log('[cf:build] ✓ build variables present');
