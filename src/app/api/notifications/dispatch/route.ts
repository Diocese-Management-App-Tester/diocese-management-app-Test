// /api/notifications/dispatch — run notif_tick() and push the pending queue.
//   POST  — kicked by the app right after a send (no secret: it only
//           delivers what the database already decided; rate-limited by
//           the queue itself). Nothing is exposed in the response but counts.
//   GET   — for a scheduler (Vercel Cron / external cron). When CRON_SECRET
//           is set the request must carry `Authorization: Bearer <secret>`
//           (Vercel adds it automatically for cron jobs).
import { NextResponse, type NextRequest } from 'next/server';
import { dispatchPending } from '@/lib/server/push-dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  // app kicks: gated (one real run per 45 s across ALL devices)
  const r = await dispatchPending(300, { gateSeconds: 45 });
  return NextResponse.json({ ok: !r.error, skipped: !!r.skipped, queued: r.queued, sent: r.sent, failed: r.failed, gone: r.gone, configured: r.configured });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    const q = req.nextUrl.searchParams.get('secret') ?? '';
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  // scheduler: never gated
  const r = await dispatchPending(500, { gateSeconds: 0 });
  return NextResponse.json(r);
}
