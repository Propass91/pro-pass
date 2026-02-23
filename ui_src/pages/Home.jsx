import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

function Home() {
  const [stats, setStats] = useState({
    copiesThisMonth: 0,
    quotaRemaining: 0,
    quotaTotal: 0
  });
  const [recent, setRecent] = useState([]);

  const load = async () => {
    try {
      const r = await window.api.getStats();
      if (r?.ok && r.stats) {
        setStats({
          copiesThisMonth: Number(r.stats.copiesThisMonth ?? 0),
          quotaRemaining: Number(r.stats.quotaRemaining ?? 0),
          quotaTotal: Number(r.stats.quotaTotal ?? 0)
        });
        setRecent(Array.isArray(r.recent) ? r.recent : []);
      }
    } catch (_) {
      // ignore
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Vue globale</p>
        </div>
        <button className="btn-refresh" onClick={load}>
          <RefreshCw size={16} />
          Actualiser
        </button>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">📄</div>
          <div className="stat-value">{stats.copiesThisMonth}</div>
          <div className="stat-label">Copies ce mois</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">📌</div>
          <div className="stat-value">{stats.quotaRemaining}</div>
          <div className="stat-label">Quota restant</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">📅</div>
          <div className="stat-value">{stats.quotaTotal}</div>
          <div className="stat-label">Limite mensuelle</div>
        </div>
      </div>

      <div className="recent-copies">
        <div className="section-header">
          <h2>Copies récentes</h2>
          <span className="badge-blue">{recent.length}</span>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>UID</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {recent.length ? recent.map((row, idx) => (
              <tr key={idx}>
                <td>{row.date || '-'}</td>
                <td className="uid">{row.uid || '-'}</td>
                <td><span className="badge-success">OK</span></td>
              </tr>
            )) : (
              <tr>
                <td colSpan={3} style={{ color: '#6b7280' }}>Aucune donnée</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Home;
