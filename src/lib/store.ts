'use client';

// ---------- Points store module (إستبدال النقاط) — client data layer ----------
// Inventory CRUD goes straight to `store_items` (RLS scoped). The sale
// itself is ONE RPC (`store_checkout`) that re-validates everything inside
// a transaction (module, scope, stock, balance) and writes the bill +
// the −points row. Cancelling is `store_cancel_order` (managers only).

import { legacyCode } from '@/lib/code-templates';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  StoreItem, StoreOrder, StoreOrderItem, StoreCheckoutResult, EnrollmentWithPerson,
} from '@/lib/types';
import { ALL, type ScopeSelection } from '@/lib/queries';

// ---------- Basket ----------
export interface BasketLine {
  item: StoreItem;
  qty: number;
}

export const basketTotal = (lines: BasketLine[]) =>
  lines.reduce((s, l) => s + l.item.price * l.qty, 0);
export const basketCount = (lines: BasketLine[]) =>
  lines.reduce((s, l) => s + l.qty, 0);

/** Does the item apply to this child's enrollment scope? */
export const itemAppliesTo = (
  it: Pick<StoreItem, 'church_id' | 'service_id' | 'class_id'>,
  e: Pick<EnrollmentWithPerson, 'church_id' | 'service_id' | 'class_id'>
) =>
  it.church_id === e.church_id &&
  (it.service_id === null || it.service_id === e.service_id) &&
  (it.class_id === null || it.class_id === e.class_id);

// ---------- Error mapping (RPC raise → Arabic) ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة إستبدال النقاط غير مفعّلة لنطاقك'],
  ['enrollment_not_found', 'المخدوم غير موجود'],
  ['empty_basket', 'السلة فارغة'],
  ['invalid_line', 'بند غير صالح في السلة'],
  ['item_not_found', 'أحد الأصناف لم يعد موجوداً في المخزون'],
  ['item_inactive', 'الصنف «%» غير متاح للبيع'],
  ['item_out_of_scope', 'الصنف «%» غير متاح لفصل هذا المخدوم'],
  ['insufficient_stock', 'الكمية المتاحة من «%» لا تكفي'],
  ['insufficient_points', 'رصيد النقاط لا يكفي لهذه السلة'],
  ['not_completed', 'هذه الفاتورة ملغاة بالفعل'],
  ['not_found', 'الفاتورة غير موجودة'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0026_points_store.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /store_items|store_orders|store_order_items|store_checkout|store_cancel_order|store_lookup_item/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

export function storeErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if ((err as { code?: string } | null)?.code === '23505') return 'هذا الكود مستخدم بالفعل لصنف آخر في نفس الكنيسة';
  for (const [key, label] of ERRORS) {
    const i = msg.indexOf(key);
    if (i >= 0) {
      if (label.includes('%')) {
        const after = msg.slice(i + key.length);
        const m = after.match(/^:([^\n"]*)/);
        return label.replace('%', (m?.[1] ?? '').trim() || 'الصنف');
      }
      return label;
    }
  }
  return fallback;
}

// ---------- Inventory ----------
export async function fetchStoreItems(
  supabase: SupabaseClient,
  scope: ScopeSelection = {},
  opts: { activeOnly?: boolean } = {}
): Promise<StoreItem[]> {
  let q = supabase.from('store_items').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (opts.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('name');
  if (error) throw error;
  let rows = (data ?? []) as StoreItem[];
  // service / class narrowing keeps "all" items (null) that still apply
  if (scope.service && scope.service !== ALL) {
    rows = rows.filter((r) => r.service_id === null || r.service_id === scope.service);
  }
  if (scope.class && scope.class !== ALL) {
    rows = rows.filter((r) => r.class_id === null || r.class_id === scope.class);
  }
  return rows;
}

/** Resolve a scanned item QR (the item code) — may return several rows
 *  (one per church); the caller narrows to the child's church. */
export async function lookupStoreItem(supabase: SupabaseClient, code: string): Promise<StoreItem[]> {
  const { data, error } = await supabase.rpc('store_lookup_item', { p_code: code.trim() });
  if (error) throw error;
  return (data ?? []) as StoreItem[];
}

// ---------- Sale ----------
export async function storeCheckout(
  supabase: SupabaseClient,
  enrollmentId: string,
  lines: BasketLine[],
  note?: string
): Promise<StoreCheckoutResult> {
  const { data, error } = await supabase.rpc('store_checkout', {
    p_enrollment: enrollmentId,
    p_lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty })),
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as StoreCheckoutResult;
}

export async function storeCancelOrder(
  supabase: SupabaseClient,
  orderId: string,
  note?: string
): Promise<{ order_id: string; refunded: number; balance_after: number }> {
  const { data, error } = await supabase.rpc('store_cancel_order', {
    p_order: orderId,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as { order_id: string; refunded: number; balance_after: number };
}

// ---------- Archive ----------
export interface StoreOrderWithPerson extends StoreOrder {
  person: { id: string; name: string; national_id: string; image_url: string | null } | null;
}

const ORDER_LIST_SELECT = '*, person:persons(id, name, national_id, image_url)';

export const ORDERS_PAGE_SIZE = 50;

export async function fetchStoreOrders(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  opts: { page?: number; pageSize?: number; search?: string; enrollmentId?: string } = {}
): Promise<{ rows: StoreOrderWithPerson[]; hasMore: boolean }> {
  const page = opts.page ?? 0;
  const size = opts.pageSize ?? ORDERS_PAGE_SIZE;
  const search = (opts.search ?? '').trim();
  const select = search ? ORDER_LIST_SELECT.replace('person:persons(', 'person:persons!inner(') : ORDER_LIST_SELECT;
  let q = supabase.from('store_orders').select(select);
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (scope.service && scope.service !== ALL) q = q.eq('service_id', scope.service);
  if (scope.class && scope.class !== ALL) q = q.eq('class_id', scope.class);
  if (opts.enrollmentId) q = q.eq('enrollment_id', opts.enrollmentId);
  if (search) {
    const s = search.replace(/[,()]/g, ' ');
    q = q.or(`name.ilike.%${s}%,national_id.ilike.%${s}%`, { referencedTable: 'person' });
  }
  const { data, error } = await q.order('created_at', { ascending: false }).range(page * size, page * size + size);
  if (error) throw error;
  const list = (data ?? []) as unknown as StoreOrderWithPerson[];
  const hasMore = list.length > size;
  return { rows: hasMore ? list.slice(0, size) : list, hasMore };
}

export async function fetchStoreOrderItems(supabase: SupabaseClient, orderId: string): Promise<StoreOrderItem[]> {
  const { data, error } = await supabase
    .from('store_order_items').select('*').eq('order_id', orderId).order('item_name');
  if (error) throw error;
  return (data ?? []) as StoreOrderItem[];
}

/** Names of the servants who recorded the given orders (profiles RLS may
 *  hide some → they fall back to '—'). */
export async function fetchRecorderNames(
  supabase: SupabaseClient, ids: (string | null)[]
): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  const m = new Map<string, string>();
  if (uniq.length === 0) return m;
  const { data } = await supabase.from('servant_enrollments').select('id, full_name').in('id', uniq);
  ((data ?? []) as { id: string; full_name: string }[]).forEach((p) => m.set(p.id, p.full_name));
  return m;
}

// ---------- QR labels ----------
export type LabelSize = 'small' | 'medium' | 'large';
export const LABEL_SIZES: Record<LabelSize, { w: number; h: number; qr: number; label: string }> = {
  small:  { w: 38, h: 25, qr: 18, label: 'صغير 38×25 مم' },
  medium: { w: 50, h: 30, qr: 22, label: 'متوسط 50×30 مم' },
  large:  { w: 70, h: 40, qr: 30, label: 'كبير 70×40 مم' },
};

/** Built-in item code suggestion, e.g. ST-4F7K2Q — components use useCodeGenerator('store_item') */
export function suggestItemCode(): string {
  return legacyCode('store_item');
}
