// /api/backup/file — stored (scheduled) backup files. Owner only.
//   GET    ?run=<id>   → the JSON file as a download (Content-Disposition)
//   DELETE ?run=<id>   → remove the file from the bucket + the history row
// Files of MANUAL backups are never stored — they go straight to the device.
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOwner, BACKUPS_BUCKET } from '@/lib/server/backup-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function findRun(admin: SupabaseClient, runId: string) {
  const { data } = await admin.from('backup_runs').select('id, file_name, storage_path').eq('id', runId).maybeSingle();
  return data as { id: string; file_name: string | null; storage_path: string | null } | null;
}

export async function GET(req: NextRequest) {
  const who = await requireOwner();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const runId = req.nextUrl.searchParams.get('run') ?? '';
  const run = runId ? await findRun(who.admin, runId) : null;
  if (!run || !run.storage_path) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { data, error } = await who.admin.storage.from(BACKUPS_BUCKET).download(run.storage_path);
  if (error || !data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const name = run.file_name ?? 'backup.json';
  return new NextResponse(data.stream(), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function DELETE(req: NextRequest) {
  const who = await requireOwner();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const runId = req.nextUrl.searchParams.get('run') ?? '';
  const run = runId ? await findRun(who.admin, runId) : null;
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (run.storage_path) await who.admin.storage.from(BACKUPS_BUCKET).remove([run.storage_path]);
  await who.admin.from('backup_runs').delete().eq('id', run.id);
  return NextResponse.json({ ok: true });
}
