'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Layers, Plus, ArrowRight, Loader2, X, Pencil, Save, Upload } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { uploadPhoto } from '@/lib/upload';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import type { Service, Church } from '@/lib/types';

export default function ServicesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);

  const canAdd = profile && ['owner', 'church_manager'].includes(profile.role);

  // Edit per level: owner → all, church manager → his church's services,
  // service manager → his own service only
  const canEditService = (s: Service) => {
    if (!profile) return false;
    if (profile.role === 'owner') return true;
    if (profile.role === 'church_manager') return s.church_id === profile.church_id;
    if (profile.role === 'service_manager') return s.id === profile.service_id;
    return false;
  };

  const load = useCallback(async () => {
    const [{ data: sv }, { data: ch }] = await Promise.all([
      supabase.from('services').select('*').order('name'),
      supabase.from('churches').select('*').order('name'),
    ]);
    setServices(sv ?? []);
    setChurches(ch ?? []);
    setLoading(false);
  }, [supabase]);

  // Initial fetch — the realtime hook below only reloads on DB change events,
  // so without this the page would sit on the spinner until something changed.
  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'services-page', [{ table: 'services' }], load, { enabled: !!profile });

  // church → (services) tree + filter
  const lookups = useMemo(() => toLookups(churches, [], []), [churches]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    services,
    (s, q) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
  );

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Layers className="h-5 w-5 text-accent-600" />
            الخدمات
            <span className="badge bg-accent-100 text-accent-700">{services.length}</span>
          </h2>
        </div>
        {canAdd && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <>
        <ScopeGroupFilters idPrefix="services" scope={scope} onScope={setScope} lookups={lookups} deepest="church"
          search={search} onSearch={setSearch} placeholder="بحث باسم الخدمة..." />
        <ScopeGroups
          idPrefix="services"
          rows={visible}
          lookups={lookups}
          deepest="church"
          tone="indigo"
          itemName={(s) => s.name}
          emptyText={services.length === 0 ? 'لا توجد خدمات بعد' : 'لا توجد خدمات مطابقة'}
          renderItem={(s) => (
            <li key={s.id} className="card flex items-start gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-accent-50 ring-2 ring-accent-100 flex items-center justify-center">
                {s.photo_url ? (
                  <Image src={s.photo_url} alt={s.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <Layers className="h-6 w-6 text-accent-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{s.name}</p>
                {s.description && <p className="text-xs text-slate-500 mt-1">{s.description}</p>}
              </div>
              {canEditService(s) && (
                <button
                  onClick={() => setEditing(s)}
                  aria-label={`تعديل ${s.name}`}
                  className="shrink-0 rounded-xl bg-accent-50 p-2 text-accent-600 hover:bg-accent-100 transition"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </li>
          )}
        />
        </>
      )}

      {showAdd && (
        <ServiceModal
          mode="add"
          churches={churches}
          fixedChurchId={profile?.role === 'church_manager' ? profile.church_id : null}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {editing && (
        <ServiceModal
          mode="edit"
          service={editing}
          churches={churches}
          fixedChurchId={profile?.role === 'owner' ? null : profile?.church_id ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function ServiceModal({
  mode, service, churches, fixedChurchId, onClose, onSaved,
}: {
  mode: 'add' | 'edit';
  service?: Service;
  churches: Church[];
  fixedChurchId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [churchId, setChurchId] = useState(fixedChurchId ?? service?.church_id ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const churchLocked = !!fixedChurchId;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    setSaving(true);

    let photo_url = service?.photo_url ?? null;
    if (photoFile) {
      try {
        photo_url = await uploadPhoto(supabase, 'services', photoFile);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }

    const payload = {
      church_id: churchId,
      name: name.trim(),
      description: description.trim() || null,
      photo_url,
    };

    const { error: err } = mode === 'add'
      ? await supabase.from('services').insert(payload)
      : await supabase.from('services').update(payload).eq('id', service!.id);

    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة خدمة' : 'تعديل الخدمة'}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              className={`input-field ${churchLocked ? 'bg-primary-50 pointer-events-none opacity-80' : ''}`}
              value={churchId}
              onChange={(e) => setChurchId(e.target.value)}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <input className="input-field" placeholder="اسم الخدمة * (مثال: مدارس الأحد)" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <textarea className="input-field" placeholder="وصف الخدمة" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-accent-300 bg-accent-50/50 px-4 py-3 text-sm font-bold text-accent-600">
            <Upload className="h-4 w-4" />
            {photoFile ? photoFile.name : service?.photo_url ? 'تغيير صورة الخدمة' : 'إضافة صورة الخدمة (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'add' ? <Plus className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {mode === 'add' ? 'حفظ الخدمة' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
