// OpenNext configuration for the Cloudflare Workers deployment.
// Used only by `npm run cf:build` (@opennextjs/cloudflare) — Vercel ignores it.
//
// The app is a realtime, fully dynamic PWA: every page is rendered per
// request and nothing uses ISR / revalidateTag / revalidatePath. The only
// prerendered routes are /branding/manifest and /offline (force-static) and
// Next simply re-renders them when the cache misses. So we deliberately keep
// the default "dummy" cache components — no R2 / KV / D1 / Durable Objects
// bindings have to be created before the first deploy, which keeps the
// Worker free-plan friendly.
//
// Should ISR ever be introduced, follow https://opennext.js.org/cloudflare/caching
// (R2 incremental cache + Durable Object queue) and add the bindings to
// wrangler.jsonc.
import { defineCloudflareConfig } from '@opennextjs/cloudflare/config';

export default defineCloudflareConfig({});
