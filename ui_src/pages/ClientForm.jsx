import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const SALES_REPS = ['Commercial 1', 'Commercial 2', 'Commercial 3'];

function toIsoDate(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

export default function ClientForm() {
  const navigate = useNavigate();
  const params = useParams();
  const clientId = params && params.id ? Number(params.id) : null;
  const isEdit = Number.isFinite(clientId) && clientId != null;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({
    companyName: '',
    legalForm: '',
    salesRep: SALES_REPS[0],
    firstName: '—',
    lastName: '—',
    phone: '',
    email: '',
    copiesTotal: 300,
    contractStart: toIsoDate(new Date()),
    validUntil: toIsoDate(new Date(Date.now() + 30 * 86400000))
  });

  const canSave = useMemo(() => {
    const f = form;
    return !!(
      f.companyName && f.legalForm && f.salesRep &&
      f.firstName && f.lastName && f.phone && f.email &&
      Number(f.copiesTotal) > 0 && f.contractStart && f.validUntil
    );
  }, [form]);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    (async () => {
      try {
        const r = await window.api.admin.getClients();
        const row = (r?.success && Array.isArray(r.clients))
          ? r.clients.find((c) => Number(c.id) === Number(clientId))
          : null;
        if (!row) {
          setError('Client introuvable');
          return;
        }
        setForm({
          companyName: row.company_name || row.name || '',
          legalForm: row.legal_form || '',
          salesRep: row.sales_rep || SALES_REPS[0],
          firstName: row.contact_first_name || '',
          lastName: row.contact_last_name || '',
          phone: row.contact_phone || '',
          email: row.email || '',
          copiesTotal: Number(row.monthly_limit || 0) || 300,
          contractStart: toIsoDate(row.contract_start || row.created_at) || toIsoDate(new Date()),
          validUntil: toIsoDate(row.valid_until) || toIsoDate(new Date(Date.now() + 30 * 86400000))
        });
      } catch (_) {
        setError('Chargement impossible');
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, clientId]);

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const save = async () => {
    setError(null);
    if (!canSave) {
      setError('Champs requis manquants');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const r = await window.api.admin.updateClient(clientId, form);
        if (!r?.success) throw new Error(r?.error || 'save_failed');
        navigate('/clients');
      } else {
        const r = await window.api.admin.createClient(form);
        if (!r?.success) throw new Error(r?.error || 'save_failed');
        if (r?.tempPassword) {
          window.alert(`Client créé. Mot de passe temporaire: ${r.tempPassword}`);
        }
        navigate('/clients');
      }
    } catch (e) {
      setError(String(e?.message || e || 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="client-form-page">
      <header className="clients-header">
        <div className="clients-title">
          <h1>{isEdit ? 'Modifier le client' : 'Ajouter un client'}</h1>
        </div>
      </header>

      <div className="form-card">
        <h2>Société</h2>
        <div className="form-grid">
          <label>
            Nom de la société*
            <input className="input" value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} />
          </label>
          <label>
            Raison sociale*
            <input className="input" value={form.legalForm} onChange={(e) => set({ legalForm: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="form-card">
        <h2>Contact principal</h2>
        <div className="form-grid">
          <label>
            Téléphone*
            <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </label>
          <label>
            E-mail*
            <input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="form-card">
        <h2>Contrat</h2>
        <div className="form-grid">
          <label>
            Nombre de copies*
            <input
              className="input"
              type="number"
              value={form.copiesTotal}
              onChange={(e) => set({ copiesTotal: Number(e.target.value) })}
              min={1}
            />
          </label>
          <label>
            Date de début de contrat*
            <input className="input" type="date" value={form.contractStart} onChange={(e) => set({ contractStart: e.target.value })} />
          </label>
          <label>
            Date de validité*
            <input className="input" type="date" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
          </label>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="form-actions">
        <button className="btn-save" onClick={save} disabled={saving || loading || !canSave}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn-cancel" onClick={() => navigate('/clients')} disabled={saving}>
          Annuler
        </button>
      </div>
    </div>
  );
}
