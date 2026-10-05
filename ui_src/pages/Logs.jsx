import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Download } from 'lucide-react';

function formatDateTime(ts) {
  const d = new Date(Number(ts || 0));
  if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
  return {
    date: d.toLocaleDateString('fr-FR'),
    time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  };
}

function pagesCompact({ page, pageCount }) {
  if (pageCount <= 11) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out = [];
  const add = (x) => out.push(x);
  add(1);
  const left = Math.max(2, page - 2);
  const right = Math.min(pageCount - 1, page + 2);
  if (left > 2) add('…');
  for (let p = left; p <= right; p++) add(p);
  if (right < pageCount - 1) add('…');
  add(pageCount);
  return out;
}

export default function Logs() {
  const [qSociete, setQSociete] = useState('');
  const [qAction, setQAction] = useState('Tous');
  const [qStart, setQStart] = useState('');
  const [qEnd, setQEnd] = useState('');

  const [filters, setFilters] = useState({ societe: '', action: 'Tous', dateDebut: '', dateFin: '' });
  const [page, setPage] = useState(1);
  const [clientNames, setClientNames] = useState([]);
  const limit = 10;

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const r = await window.api.admin.getLogs({ ...filters, page, limit });
      if (r?.success) {
        setRows(Array.isArray(r.rows) ? r.rows : []);
        setTotal(Number(r.total || 0));
        setPageCount(Number(r.pageCount || 1));
      }
    } catch (_) {
      // ignore
    } finally {
      setLastRefresh(Date.now());
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load({ silent: true }), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  const liveLabel = useMemo(() => {
    const d = new Date(lastRefresh);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `En direct · ${time}`;
  }, [lastRefresh]);

  // Liste des sociétés pour l'autocomplétion du champ de recherche
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await window.api.admin.getClients();
        if (!alive || !r?.success) return;
        const names = (r.clients || [])
          .map((c) => String(c?.company_name || c?.name || '').trim())
          .filter(Boolean);
        setClientNames([...new Set(names)].sort((a, b) => a.localeCompare(b, 'fr')));
      } catch (_) {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, []);

  // Recherche automatique : les filtres s'appliquent dès qu'ils changent
  // (avec un léger délai pendant la frappe du nom de société)
  useEffect(() => {
    const t = setTimeout(() => {
      const next = { societe: qSociete.trim(), action: qAction, dateDebut: qStart, dateFin: qEnd };
      if (
        filters.societe === next.societe && filters.action === next.action &&
        filters.dateDebut === next.dateDebut && filters.dateFin === next.dateFin
      ) return;
      setFilters(next);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qSociete, qAction, qStart, qEnd]);

  const reset = () => {
    setQSociete('');
    setQAction('Tous');
    setQStart('');
    setQEnd('');
    setFilters({ societe: '', action: 'Tous', dateDebut: '', dateFin: '' });
    setPage(1);
  };

  const exportCsv = async () => {
    try {
      await window.api.admin.exportLogs(filters);
    } catch (_) {
      // ignore
    }
  };

  return (
    <div className="logs-page">
      <header className="logs-header">
        <div className="logs-title">
          <h1>Logs</h1>
          <div className="logs-live">
            <span className="dash-live-dot" />
            <span>{liveLabel}</span>
          </div>
        </div>

        <button className="btn-dark" onClick={exportCsv}>
          <Download size={18} />
          Télécharger les logs
        </button>
      </header>

      <div className="logs-filters">
        <div className="logs-search">
          <Search size={16} className="logs-search-icon" />
          <input
            className="input"
            placeholder="Rechercher un client…"
            list="logs-clients"
            value={qSociete}
            onChange={(e) => setQSociete(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQSociete(''); }}
          />
          {qSociete ? (
            <button type="button" className="logs-search-clear" onClick={() => setQSociete('')} title="Effacer">
              <X size={14} />
            </button>
          ) : null}
          <datalist id="logs-clients">
            {clientNames.map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>
        <select className="input" value={qAction} onChange={(e) => setQAction(e.target.value)}>
          <option>Tous</option>
          <option>Copié</option>
          <option>Échec copie</option>
        </select>
        <input className="input" type="date" value={qStart} onChange={(e) => setQStart(e.target.value)} />
        <input className="input" type="date" value={qEnd} onChange={(e) => setQEnd(e.target.value)} />
        <button className="link gray" onClick={reset} type="button">Réinitialiser les filtres</button>
      </div>

      <div className="logs-table-wrap">
        <table className="logs-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Société</th>
              <th>Actions</th>
              <th>Date</th>
              <th>Heure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const { date, time } = formatDateTime(r.ts);
              const act = String(r.action || '—');
              const badgeClass = act === 'Copié' ? 'pill ok' : (act === 'Échec copie' ? 'pill fail' : 'pill');
              return (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>{r.company_name || '—'}</td>
                  <td><span className={badgeClass}>{act}</span></td>
                  <td>{date}</td>
                  <td>{time}</td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={5} className="empty">{loading ? 'Chargement…' : 'Aucun log'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        {pagesCompact({ page, pageCount }).map((p, idx) => (
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
        <button
          className="page"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          title="Page suivante"
        >
          »
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        Total: {total}
      </div>
    </div>
  );
}
