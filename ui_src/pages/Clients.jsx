import React, { useMemo, useState, useEffect } from 'react';
import { Mail, Pencil, Lock, Unlock, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function formatDateFr(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR');
}

function computeUsedTotal(row) {
  const total = Math.max(0, Number(row?.monthly_limit ?? 0));
  const remaining = Math.max(0, Number(row?.quota_remaining ?? 0));
  const used = Math.max(0, total - remaining);
  return { used, total };
}

function paginatePages({ page, pageCount }) {
  if (pageCount <= 11) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out = [];
  const add = (v) => out.push(v);

  add(1);
  const left = Math.max(2, page - 2);
  const right = Math.min(pageCount - 1, page + 2);

  if (left > 2) add('…');
  for (let p = left; p <= right; p++) add(p);
  if (right < pageCount - 1) add('…');
  add(pageCount);
  return out;
}

export default function Clients() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [qCompany, setQCompany] = useState('');
  const [qState, setQState] = useState('Tous');
  const [applied, setApplied] = useState({ company: '', state: 'Tous' });

  const [page, setPage] = useState(1);
  const pageSize = 12;

  const load = async () => {
    setLoading(true);
    try {
      const r = await window.api.admin.getClients();
      if (r?.success && Array.isArray(r.clients)) setRows(r.clients);
      else setRows([]);
    } catch (_) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const companyNeedle = String(applied.company || '').trim().toLowerCase();
    const state = String(applied.state || 'Tous');
    return rows.filter((r) => {
      const name = String(r?.company_name || r?.name || '').toLowerCase();
      const okCompany = !companyNeedle || name.includes(companyNeedle);
      const isActive = Number(r?.is_active ?? 1) ? true : false;
      const okState = state === 'Tous' || (state === 'Activé' ? isActive : !isActive);
      return okCompany && okState;
    });
  }, [rows, applied]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [applied.company, applied.state]);

  const doFilter = () => {
    setApplied({ company: qCompany, state: qState });
  };

  const doReset = () => {
    setQCompany('');
    setQState('Tous');
    setApplied({ company: '', state: 'Tous' });
  };

  const toggleStatus = async (id) => {
    try {
      const r = await window.api.admin.toggleClientStatus(id);
      if (r?.success) await load();
    } catch (_) {}
  };

  const sendInvite = async (id) => {
    try {
      const r = await window.api.admin.sendInvitationEmail(id);
      if (r?.ok && r.sent) {
        window.alert('Email envoyé.');
        return;
      }
      if (r?.ok && !r.sent) {
        const err = r?.error ? String(r.error) : 'Envoi échoué';
        const url = r?.resetUrl ? String(r.resetUrl) : '';
        if (url) {
          window.alert(`Email non envoyé: ${err}\n\nLien d'activation (one-shot) :\n${url}`);
        } else {
          window.alert(`Email non envoyé: ${err}`);
        }
        return;
      }
      window.alert(`Envoi impossible.${r?.error ? `\n\n${String(r.error)}` : ''}`);
    } catch (_) {
      window.alert('Envoi impossible.');
    }
  };


  const deleteClient = async (id, name) => {
    if (!window.confirm('Supprimer ce client ? Action irreversible.')) return;
    try {
      const r = await window.api.admin.deleteClient(id);
      if (r?.success) { await load(); }
      else { window.alert('Erreur : ' + (r?.error || 'Suppression impossible')); }
    } catch (_) { window.alert('Erreur lors de la suppression.'); }
  };

  return (
    <div className="clients-page">
      <header className="clients-header">
        <div className="clients-title">
          <h1>Mes clients</h1>
          <span className="clients-count">{filtered.length} clients</span>
        </div>
        <button className="btn-primary clients-add" onClick={() => navigate('/clients/new')}>
          <Plus size={18} />
          + Ajouter un client
        </button>
      </header>

      <div className="clients-filters">
        <div className="clients-filter-row">
          <input
            className="input"
            placeholder="Société"
            value={qCompany}
            onChange={(e) => setQCompany(e.target.value)}
          />

          <select className="input" value={qState} onChange={(e) => setQState(e.target.value)}>
            <option>Tous</option>
            <option>Activé</option>
            <option>Désactivé</option>
          </select>

          <button className="btn-primary" onClick={doFilter} disabled={loading}>Filtrer</button>
          <button className="link" onClick={doReset} type="button">Réinitialiser</button>
        </div>
      </div>

      <div className="clients-table-wrap">
        <table className="clients-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nom de la société</th>
              <th>Commercial responsable</th>
              <th>Date début contrat</th>
              <th>Date de validité</th>
              <th>Nombre de copies</th>
              <th>État</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const { used, total } = computeUsedTotal(r);
              const active = Number(r?.is_active ?? 1) ? true : false;
              return (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.company_name || r.name || '—'}</td>
                  <td>{r.sales_rep || '—'}</td>
                  <td>{formatDateFr(r.contract_start || r.created_at)}</td>
                  <td>{formatDateFr(r.valid_until)}</td>
                  <td>{used}/{total || 0}</td>
                  <td>
                    <span className={active ? 'badge active' : 'badge inactive'}>
                      {active ? 'Activé' : 'Désactivé'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <button className="icon-btn" title="Envoyer email de téléchargement" onClick={() => sendInvite(r.id)}>
                        <Mail size={18} />
                      </button>
                      <button className="icon-btn" title="Modifier le client" onClick={() => navigate(`/clients/${r.id}`)}>
                        <Pencil size={18} />
                      </button>
                      <button
                        className={active ? 'icon-btn danger' : 'icon-btn'}
                        title={active ? 'Bloquer' : 'Débloquer'}
                        onClick={() => toggleStatus(r.id)}
                      >
                        {active ? <Lock size={18} /> : <Unlock size={18} />}
                      </button>
                      <button className="icon-btn danger" title="Supprimer ce client" onClick={() => deleteClient(r.id, r.company_name || r.username)}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!pageRows.length ? (
              <tr>
                <td colSpan={8} className="empty">{loading ? 'Chargement…' : 'Aucun client'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        {paginatePages({ page, pageCount }).map((p, idx) => (
          <button
            key={idx}
            className={p === page ? 'page active' : 'page'}
            disabled={p === '…'}
            onClick={() => {
              if (p === '…') return;
              setPage(Number(p));
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

