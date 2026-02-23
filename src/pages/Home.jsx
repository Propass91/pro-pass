import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

function Home({ user }) {
  const [quota, setQuota] = useState({ used: 1, total: 15, remaining: 14 });
  const [stats, setStats] = useState({ copiesThisMonth: 1, totalCopies: 1 });

  useEffect(() => {
    loadQuota();
  }, []);

  const loadQuota = async () => {
    try {
      const quotaData = await window.api.dumps.getQuota();
      setQuota({
        used: quotaData.copies_this_month || 1,
        total: quotaData.monthly_limit || 15,
        remaining: quotaData.remaining || 14
      });
    } catch (e) {
      console.error('Failed to load quota', e);
    }
  };

  const percentage = (quota.used / quota.total) * 100;

  return (
    <div className="page home-page">
      <header className="page-header">
        <div>
          <h1>Bienvenue</h1>
          <p className="subtitle">Entreprise Démo</p>
        </div>
        <button className="btn-refresh" onClick={loadQuota}>
          <RefreshCw size={16} />
          Actualiser
        </button>
      </header>

      <div className="quota-section">
        <h2>
          <span className="icon">📋</span>
          Votre quota mensuel
          <span className="badge">{quota.remaining} restantes sur {quota.total}</span>
        </h2>

        <div className="quota-display">
          <div className="circular-progress">
            <svg viewBox="0 0 100 100">
              <circle className="bg" cx="50" cy="50" r="45" />
              <circle 
                className="progress" 
                cx="50" 
                cy="50" 
                r="45"
                style={{ strokeDasharray: `${percentage * 2.83} 283` }}
              />
            </svg>
            <div className="progress-text">
              <span className="number">{quota.used}</span>
              <span className="total">/ {quota.total}</span>
            </div>
          </div>

          <div className="quota-details">
            <div className="detail-row">
              <span>Copies utilisées</span>
              <strong>{quota.used}</strong>
            </div>
            <div className="detail-row">
              <span>Quota total</span>
              <strong>{quota.total}</strong>
            </div>
            <div className="detail-row">
              <span>Restantes</span>
              <strong>{quota.remaining}</strong>
              <div className="mini-bar">
                <div className="fill" style={{ width: `${(quota.remaining/quota.total)*100}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">📄</div>
          <div className="stat-number">{quota.used}</div>
          <div className="stat-label">Copies ce mois</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">📋</div>
          <div className="stat-number">{stats.totalCopies}</div>
          <div className="stat-label">Total copies</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">📅</div>
          <div className="stat-number">{quota.total}</div>
          <div className="stat-label">Limite mensuelle</div>
        </div>
      </div>
    </div>
  );
}

export default Home;
