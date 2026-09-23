'use client';

// ---------- إدارة الأفراد (owner module) — data layer ----------
// Thin wrappers over the owner-only RPCs of migration
// 20260923120000_owner_persons_management.sql:
//   owner_persons_page          list (filters + pagination, enrollments embedded)
//   owner_persons_counts        header counters
//   owner_bulk_enroll           add many persons → many classes
//   owner_bulk_unenroll         remove many persons from a scope
//   owner_bulk_delete_persons   delete many persons completely (cascade)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRole, ApprovalStatus, EnrollmentStatus, Gender, Person, ScopeRef } from '@/lib/types';

/** One enrollment as embedded by owner_persons_page. */
export interface OwnerEnrollment {
  id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  kind: 'child' | 'servant';
  servant_id: string | null;
  status: EnrollmentStatus;
  points: number;
  attendance_count: number;
  created_at: string;
}

/** The servant account bound to this person (null for a plain child). */
export interface OwnerServantInfo {
  id: string;
  role: AppRole;
  status: ApprovalStatus;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  scopes: ScopeRef[];
}

/** A row of إدارة الأفراد — the full person + everything bound to him. */
export interface OwnerPersonRow extends Omit<Person, 'created_by' | 'edited_by'> {
  gender: Gender | null;
  enrollments: OwnerEnrollment[];
  servant: OwnerServantInfo | null;
  has_password: boolean;
  total_count: number;
}

export type ScopeMode = 'all' | 'scope' | 'none';
export type PersonKindFilter = 'all' | 'child' | 'servant';

export interface OwnerPersonsFilter {
  search?: string;
  scopeMode: ScopeMode;
  church?: string | null;
  service?: string | null;
  class?: string | null;
  gender?: Gender | null;
  kind: PersonKindFilter;
}

export const OWNER_PAGE_SIZE = 100;

export async function fetchOwnerPersons(
  supabase: SupabaseClient,
  f: OwnerPersonsFilter,
  page = 0,
  pageSize = OWNER_PAGE_SIZE,
): Promise<{ rows: OwnerPersonRow[]; total: number }> {
  const { data, error } = await supabase.rpc('owner_persons_page', {
    p_search: f.search?.trim() || null,
    p_scope_mode: f.scopeMode,
    p_church: f.scopeMode === 'scope' ? f.church || null : null,
    p_service: f.scopeMode === 'scope' ? f.service || null : null,
    p_class: f.scopeMode === 'scope' ? f.class || null : null,
    p_gender: f.gender || null,
    p_kind: f.kind,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw error;
  const rows = ((data ?? []) as OwnerPersonRow[]).map((r) => ({
    ...r,
    enrollments: (r.enrollments ?? []) as OwnerEnrollment[],
    servant: (r.servant ?? null) as OwnerServantInfo | null,
  }));
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export interface OwnerPersonsCounts {
  total: number;
  unenrolled: number;
  servants: number;
  children: number;
}

export async function fetchOwnerPersonsCounts(supabase: SupabaseClient): Promise<OwnerPersonsCounts | null> {
  const { data, error } = await supabase.rpc('owner_persons_counts');
  if (error || !data) return null;
  return data as OwnerPersonsCounts;
}

export interface BulkEnrollResult { added: number; skipped: number; persons: number; scopes: number }

export async function bulkEnroll(
  supabase: SupabaseClient,
  personIds: string[],
  scopes: ScopeRef[],
): Promise<BulkEnrollResult> {
  const { data, error } = await supabase.rpc('owner_bulk_enroll', {
    p_person_ids: personIds,
    p_scopes: scopes.map((s) => ({ church_id: s.church_id, service_id: s.service_id, class_id: s.class_id })),
  });
  if (error) throw error;
  return data as BulkEnrollResult;
}

export async function bulkUnenroll(
  supabase: SupabaseClient,
  personIds: string[],
  scope: { church_id: string; service_id?: string | null; class_id?: string | null },
): Promise<{ removed: number }> {
  const { data, error } = await supabase.rpc('owner_bulk_unenroll', {
    p_person_ids: personIds,
    p_church: scope.church_id,
    p_service: scope.service_id ?? null,
    p_class: scope.class_id ?? null,
  });
  if (error) throw error;
  return data as { removed: number };
}

export async function bulkDeletePersons(
  supabase: SupabaseClient,
  personIds: string[],
): Promise<{ deleted: number; skipped_servants: number }> {
  const { data, error } = await supabase.rpc('owner_bulk_delete_persons', { p_person_ids: personIds });
  if (error) throw error;
  return data as { deleted: number; skipped_servants: number };
}

/** Human message for the RPC errors above. */
export function ownerPersonsError(err: unknown, fallback = 'تعذر تنفيذ العملية'): string {
  const m = (err as { message?: string; code?: string } | null)?.message ?? '';
  const code = (err as { code?: string } | null)?.code ?? '';
  if (code === 'PGRST202' || /Could not find the function/i.test(m)) {
    return 'تحديث قاعدة البيانات مطلوب — شغّل 20260923120000_owner_persons_management.sql';
  }
  if (m.includes('forbidden')) return 'هذه الصفحة لمالك التطبيق فقط';
  if (m.includes('no_access')) return 'ليس لديك صلاحية على هذا النطاق';
  if (m.includes('invalid_scope')) return 'الفصل لا يتبع الخدمة / الكنيسة المختارة';
  if (m.includes('class_required')) return 'اختر الفصل — التسجيل يكون دائمًا في فصل';
  if (m.includes('church_required')) return 'اختر الكنيسة أولاً';
  if (m.includes('persons_required')) return 'لم يُحدَّد أي شخص';
  if (m.includes('scopes_required')) return 'اختر فصلًا واحدًا على الأقل';
  return fallback;
}
