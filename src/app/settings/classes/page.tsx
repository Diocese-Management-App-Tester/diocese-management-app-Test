'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { School, Plus, ArrowRight, Loader2, X, Pencil, Save, Upload } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { uploadPhoto } from '@/lib/upload';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import type { ClassRoom, Service, Church } from '@/lib/types';

export default function ClassesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ClassRoom | null>(null);
  const [loading, setLoading] = useState(true);

  const canAdd = profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  // Edit per level: owner → all, church manager → his church's classes,
  // service manager → his service's classes, class servant → his own class
  const canEditClass = (c: ClassRoom) => {
    if (!profile) return false;
    if (profile.role === 'owner') return true;
    if (profile.role === 'church_manager') return c.church_id === profile.church_id;
    if (profile.role === 'service_manager') return c.service_id === profile.service_id;
    if (profile.role === 'class_servant') return c.id === profile.class_id;
    return false;
  };

  const load = useCallback(async () => {
    const [{ data: cl }, { data: sv }, { data: ch }] = await Promise.all([
      supabase.from('classes').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('churches').select('*').order('name'),
    ]);
    setClasses(cl ?? []);
    setServices(sv ?? []);
    setChurches(ch ?? []);
    setLoading(false);
  }, [supabase]);

  // Initial fetch — the realtime hook below only reloads on DB change events,
  // so without this the page would sit on the spinner until something changed.
  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'classes-page', [{ table: 'classes' }], load, { enabled: !!profile });

  // church → service → (classes) tree + filter
  const lookups = useMemo(() => toLookups(churches, services, []), [churches, services]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    classes,
    (c, q) => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
  );

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <School className="h-5 w-5 text-sky-600" />
            الفصول
            <span className="badge bg-sky-100 text-sky-700">{classes.length}</span>
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
        <ScopeGroupFilters idPrefix="classes" scope={scope} onScope={setScope} lookups={lookups} deepest="service"
          search={search} onSearch={setSearch} placeholder="بحث باسم الفصل..." />
        <ScopeGroups
          idPrefix="classes"
          rows={visible}
          lookups={lookups}
          deepest="service"
          tone="sky"
          itemName={(c) => c.name}
          emptyText={classes.length === 0 ? 'لا توجد فصول بعد' : 'لا توجد فصول مطابقة'}
          renderItem={(c) => (
            <li key={c.id} className="card flex items-start gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-sky-50 ring-2 ring-sky-100 flex items-center justify-center">
                {c.photo_url ? (
                  <Image src={c.photo_url} alt={c.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <School className="h-6 w-6 text-sky-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{c.name}</p>
                {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
              </div>
              {canEditClass(c) && (
                <button
                  onClick={() => setEditing(c)}
                  aria-label={`تعديل ${c.name}`}
                  className="shrink-0 rounded-xl bg-sky-50 p-2 text-sky-600 hover:bg-sky-100 transition"
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
        <ClassModal
          mode="add"
          churches={churches}
          services={services}
          fixedChurchId={profile?.role === 'church_manager' ? profile.church_id : profile?.role === 'service_manager' ? profile.church_id : null}
          fixedServiceId={profile?.role === 'service_manager' ? profile.service_id : null}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {editing && (
        <ClassModal
          mode="edit"
          cls={editing}
          churches={churches}
          services={services}
          fixedChurchId={profile?.role === 'owner' ? null : profile?.church_id ?? null}
          fixedServiceId={
            profile && ['owner', 'church_manager'].includes(profile.role)
              ? null
              : profile?.service_id ?? null
          }
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function ClassModal({
  mode, cls, churches, services, fixedChurchId, fixedServiceId, onClose, onSaved,
}: {
  mode: 'add' | 'edit';
  cls?: ClassRoom;
  churches: Church[];
  services: Service[];
  fixedChurchId: string | null;
  fixedServiceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(cls?.name ?? '');
  const [description, setDescription] = useState(cls?.description ?? '');
  const [churchId, setChurchId] = useState(fixedChurchId ?? cls?.church_id ?? '');
  const [serviceId, setServiceId] = useState(fixedServiceId ?? cls?.service_id ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const churchLocked = !!fixedChurchId;
  const serviceLocked = !!fixedServiceId;

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : services;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return setError('اختر الخدمة');
    setSaving(true);

    let photo_url = cls?.photo_url ?? null;
    if (photoFile) {
      try {
        photo_url = await uploadPhoto(supabase, 'classes', photoFile);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }

    const payload = {
      church_id: svc.church_id,
      service_id: svc.id,
      name: name.trim(),
      description: description.trim() || null,
      photo_url,
    };

    const { error: err } = mode === 'add'
      ? await supabase.from('classes').insert(payload)
      : await supabase.from('classes').update(payload).eq('id', cls!.id);

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
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة فصل' : 'تعديل الفصل'}</h3>
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
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className={`input-field ${serviceLocked ? 'bg-primary-50 pointer-events-none opacity-80' : ''}`}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              required
            >
              <option value="">اختر الخدمة</option>
              {filteredServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <input className="input-field" placeholder="اسم الفصل * (مثال: ابتدائي أول)" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <textarea className="input-field" placeholder="وصف الفصل" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-sky-300 bg-sky-50/50 px-4 py-3 text-sm font-bold text-sky-600">
            <Upload className="h-4 w-4" />
            {photoFile ? photoFile.name : cls?.photo_url ? 'تغيير صورة الفصل' : 'إضافة صورة الفصل (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'add' ? <Plus className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {mode === 'add' ? 'حفظ الفصل' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
