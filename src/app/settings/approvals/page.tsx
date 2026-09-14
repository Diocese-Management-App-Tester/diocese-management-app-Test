import { redirect } from 'next/navigation';

// Moved into the servants module (إدارة الخدام) — /servants
export default function Page() {
  redirect('/servants?tab=approvals');
}
