// ---------- FAMILY MODULE (العائلات) — migration 20260924120000 ----------
// A family groups persons (children / servants). Members are added with
// their INDIVIDUAL code (QR). On the scanner, scanning ONE member's code
// resolves the whole family so the servant picks the person the operation
// is for — and, when that person is enrolled in 2+ services, the service.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnrollmentWithPerson, Person } from '@/lib/types';

export interface Family {
  id: string;
  code: string;          // the family's own QR (F-XXXXXX)
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export type FamilyRelation =
  | 'father' | 'mother' | 'son' | 'daughter' | 'brother' | 'sister'
  | 'grandfather' | 'grandmother' | 'husband' | 'wife' | 'other';

export const RELATION_LABELS: Record<FamilyRelation, string> = {
  father: 'أب',
  mother: 'أم',
  son: 'ابن',
  daughter: 'ابنة',
  brother: 'أخ',
  sister: 'أخت',
  grandfather: 'جد',
  grandmother: 'جدة',
  husband: 'زوج',
  wife: 'زوجة',
  other: 'أخرى',
};
export const RELATIONS = Object.keys(RELATION_LABELS) as FamilyRelation[];

export const relationLabel = (r: string | null | undefined) =>
  r && r in RELATION_LABELS ? RELATION_LABELS[r as FamilyRelation] : '';

export interface FamilyMember {
  id: string;
  family_id: string;
  person_id: string;
  relation: FamilyRelation | null;
  created_at: string;
  created_by: string | null;
}

/** `family_members` row joined with its person (list pages). */
export interface FamilyMemberWithPerson extends FamilyMember {
  person: Person;
}

/** Enrollment as returned by `family_lookup` — plus the working-day status. */
export interface FamilyLookupEnrollment extends EnrollmentWithPerson {
  /** the person attended this enrollment on the working day (any event) */
  attended_today: boolean;
  /** the events he attended today in this enrollment */
  today_event_ids: string[];
}

export interface FamilyLookupMember {
  /** null when the scanned person has no family (lone member) */
  member_id: string | null;
  relation: FamilyRelation | null;
  person: Person;
  /** enrollments inside the CALLER's scopes only */
  enrollments: FamilyLookupEnrollment[];
}

export interface FamilyLookup {
  matched: 'person' | 'family' | null;
  /** the scanned person when a PERSON code was scanned */
  person: Person | null;
  /** null when the scanned person belongs to no family */
  family: Family | null;
  members: FamilyLookupMember[];
}

/**
 * Scanner entry point: a PERSON code or a FAMILY code → the family and all
 * its members with their enrollments (scoped) and «attended today» flags.
 * Returns `matched: null` for an unknown code.
 */
export async function lookupFamily(
  supabase: SupabaseClient,
  code: string,
  day?: string,
): Promise<FamilyLookup> {
  const { data, error } = await supabase.rpc('family_lookup', { p_code: code.trim(), p_day: day ?? null });
  if (error) throw error;
  const r = (data ?? {}) as Partial<FamilyLookup>;
  return {
    matched: r.matched ?? null,
    person: r.person ?? null,
    family: r.family ?? null,
    members: (r.members ?? []).map((m) => ({
      ...m,
      enrollments: (m.enrollments ?? []).map((e) => ({
        ...e,
        attended_today: !!e.attended_today,
        today_event_ids: e.today_event_ids ?? [],
      })),
    })),
  };
}

export type FamilyAddError =
  | 'forbidden' | 'family_not_found' | 'no_access' | 'person_not_found'
  | 'already_member' | 'in_other_family' | 'invalid_relation' | 'failed';

export const FAMILY_ADD_ERROR_LABELS: Record<FamilyAddError, string> = {
  forbidden: 'ليس لديك صلاحية إدارة العائلات',
  family_not_found: 'العائلة غير موجودة',
  no_access: 'هذه العائلة خارج نطاقك',
  person_not_found: 'كود غير معروف — لا يوجد شخص بهذا الكود',
  already_member: 'هذا الشخص موجود بالفعل في هذه العائلة',
  in_other_family: 'هذا الشخص في عائلة أخرى',
  invalid_relation: 'صلة القرابة غير صالحة',
  failed: 'تعذر إضافة الفرد، حاول مجدداً',
};

export interface FamilyAddResult {
  member_id: string;
  relation: FamilyRelation | null;
  person: Person;
  moved_from: { id: string; name: string } | null;
}

export type FamilyAddOutcome =
  | { ok: true; result: FamilyAddResult }
  | { ok: false; error: FamilyAddError; otherFamily?: { id: string; name: string } };

/**
 * Add the person whose code is `code` to the family. `move = true` moves
 * him out of his current family when he already belongs to another one.
 */
export async function addFamilyMemberByCode(
  supabase: SupabaseClient,
  familyId: string,
  code: string,
  relation: FamilyRelation | null,
  move = false,
): Promise<FamilyAddOutcome> {
  const { data, error } = await supabase.rpc('family_add_member_by_code', {
    p_family: familyId,
    p_code: code.trim(),
    p_relation: relation,
    p_move: move,
  });
  if (error) {
    const msg = error.message ?? '';
    const key = (Object.keys(FAMILY_ADD_ERROR_LABELS) as FamilyAddError[]).find((k) => msg.includes(k)) ?? 'failed';
    const details = (error as { details?: string; hint?: string });
    return {
      ok: false,
      error: key,
      otherFamily: key === 'in_other_family' && details.hint
        ? { id: details.hint, name: details.details ?? '' }
        : undefined,
    };
  }
  return { ok: true, result: data as FamilyAddResult };
}

export async function removeFamilyMember(supabase: SupabaseClient, memberId: string) {
  const { error } = await supabase.rpc('family_remove_member', { p_member: memberId });
  if (error) throw error;
}

export async function setFamilyMemberRelation(
  supabase: SupabaseClient, memberId: string, relation: FamilyRelation | null,
) {
  const { error } = await supabase.rpc('family_set_relation', { p_member: memberId, p_relation: relation });
  if (error) throw error;
}

export interface FamilyPermissions { view: boolean; manage: boolean }

export async function fetchFamilyPermissions(supabase: SupabaseClient): Promise<FamilyPermissions> {
  const { data, error } = await supabase.rpc('family_permissions');
  if (error) return { view: false, manage: false };
  const r = (data ?? {}) as Partial<FamilyPermissions>;
  return { view: !!r.view, manage: !!r.manage };
}

/** All families visible to the caller with their members (persons joined). */
export async function fetchFamilies(supabase: SupabaseClient): Promise<{ families: Family[]; members: FamilyMemberWithPerson[] }> {
  const [{ data: fam, error: e1 }, { data: mem, error: e2 }] = await Promise.all([
    supabase.from('families').select('*').order('name'),
    supabase.from('family_members').select('*, person:persons(*)').order('created_at'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return {
    families: (fam ?? []) as Family[],
    members: ((mem ?? []) as FamilyMemberWithPerson[]).filter((m) => m.person),
  };
}

/** Human summary of a scanned enrollment's service for the picker rows. */
export const memberCount = (n: number) => (n === 1 ? 'فرد واحد' : n === 2 ? 'فردان' : `${n} أفراد`);
