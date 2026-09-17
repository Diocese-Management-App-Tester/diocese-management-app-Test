// POST /api/backup/auth-restore — re-create the servants' LOGIN ACCOUNTS
// from a backup file (migration 0044). Owner only.
//
// The browser cannot touch auth.users; the Admin API can create a user with
// a given id AND a given bcrypt hash, so after a restore every servant logs
// in with the same code + the same password as before.
// Body: { users: BackupFile['auth_users'] }   (max 2000)
import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, restoreAuthUsers } from '@/lib/server/backup-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const who = await requireOwner();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const users = (body as { users?: unknown })?.users;
  if (!Array.isArray(users) || users.length === 0) return NextResponse.json({ error: 'no_users' }, { status: 400 });
  if (users.length > 2000) return NextResponse.json({ error: 'too_many' }, { status: 400 });
  const result = await restoreAuthUsers(who.admin, users);
  return NextResponse.json(result);
}
