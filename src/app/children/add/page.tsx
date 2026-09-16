import { redirect } from 'next/navigation';

// The add-child flow moved to «إدارة المخدومين» (migration 0042).
export default function AddChildRedirect() {
  redirect('/children/manage?tab=add');
}
