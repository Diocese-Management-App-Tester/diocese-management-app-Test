'use client';

// ---------- Saved report templates (`report_templates`, migration 0050) ----------

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportDefinition, ReportTemplate } from './types';
import { normalizeDefinition } from './types';

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0050_report_templates.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  const code = (err as { code?: string } | null)?.code ?? '';
  return code === '42P01' || (/report_templates|report_enrollment_period_stats/.test(msg) && /does not exist|not find|schema cache|relation/i.test(msg));
}

export function reportErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  const code = (err as { code?: string } | null)?.code;
  if (code === '42501') return 'ليس لديك صلاحية على هذه العملية';
  const msg = (err as { message?: string } | null)?.message;
  return msg ? `${fallback}: ${msg}` : fallback;
}

export async function fetchTemplates(supabase: SupabaseClient): Promise<ReportTemplate[]> {
  const { data, error } = await supabase
    .from('report_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name');
  if (error) throw error;
  return ((data ?? []) as ReportTemplate[]).map((t) => ({ ...t, definition: normalizeDefinition(t.definition) }));
}

export interface TemplateInput {
  name: string;
  description: string | null;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  definition: ReportDefinition;
  is_default?: boolean;
}

export async function saveTemplate(supabase: SupabaseClient, id: string | null, input: TemplateInput, userId: string | undefined): Promise<ReportTemplate> {
  const row = {
    name: input.name.trim(), description: input.description?.trim() || null,
    church_id: input.church_id, service_id: input.service_id, class_id: input.class_id,
    source: input.definition.query.source, definition: input.definition, is_default: input.is_default ?? false,
  };
  const q = id
    ? supabase.from('report_templates').update({ ...row, edited_by: userId ?? null }).eq('id', id)
    : supabase.from('report_templates').insert({ ...row, created_by: userId ?? null });
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  const t = data as ReportTemplate;
  return { ...t, definition: normalizeDefinition(t.definition) };
}

export async function deleteTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('report_templates').delete().eq('id', id);
  if (error) throw error;
}
