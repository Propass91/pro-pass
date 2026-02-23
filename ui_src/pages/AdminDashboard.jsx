import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Users, Copy, ChevronDown, LogOut } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Spec-required logic
function getNextDumpExpiry() {
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const result = new Date(today);

  if (day === 0) result.setDate(today.getDate() + 4); // Sun → Thu
  else if (day === 1) result.setDate(today.getDate() + 3); // Mon → Thu
  else if (day === 2) result.setDate(today.getDate() + 2); // Tue → Thu
  else if (day === 3) result.setDate(today.getDate() + 1); // Wed → Thu
  else if (day === 4) result.setDate(today.getDate() + 2); // Thu → Sat
  else if (day === 5) result.setDate(today.getDate() + 1); // Fri → Sat
  else if (day === 6) result.setDate(today.getDate() + 5); // Sat → Thu

  return result;
}

function diffDays(from, to) {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / 86400000);
}

function useAnimatedNumber(target, { durationMs = 650 } = {}) {
  const [value, setValue] = useState(() => Number(target || 0));
  const prevRef = useRef(Number(target || 0));
  const rafRef = useRef(null);

  useEffect(() => {
    const from = Number(prevRef.current || 0);
    const to = Number(target || 0);
    prevRef.current = to;

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      setValue(Number.isFinite(to) ? to : 0);
      return;
    }
    if (from === to) {
      setValue(to);
      return;
    }

    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (to - from) * eased;
      setValue(Math.round(next));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [target, durationMs]);

  return value;
}

function readWeeklyRows() {
  try {
    const raw = localStorage.getItem('ppc_weekly_captures_v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch (_) {
    return [];
  }
}

function isSuccessStatus(status) {
  const s = String(status || '').toUpperCase();
  return s.includes('RÉUSS') || s.includes('REUSS') || s.includes('OK');
}

function loadSyncedKeys() {
  try {
    const raw = localStorage.getItem('ppc_copy_events_synced_v1');
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch (_) {
    return new Set();
  }
}

function persistSyncedKeys(set) {
  try {
    localStorage.setItem('ppc_copy_events_synced_v1', JSON.stringify(Array.from(set).slice(-5000)));
  } catch (_) {}
}

export default function AdminDashboard({ user, onLogout }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const [stats, setStats] = useState({ totalClients: 0, totalCopies: 0 });
  const [chart, setChart] = useState({ labels: [], success: [], fail: [] });
  const [lastRefreshTs, setLastRefreshTs] = useState(Date.now());

  const expiryDate = useMemo(() => getNextDumpExpiry(), [Math.floor(Date.now() / 60000)]);
  const expiryDiff = useMemo(() => diffDays(new Date(), expiryDate), [expiryDate]);

  const expiryTone = useMemo(() => {
    if (expiryDiff <= 0) return 'danger';
    if (expiryDiff === 1) return 'warning';
    return 'success';
  }, [expiryDiff]);

  const animatedClients = useAnimatedNumber(stats.totalClients);
  const animatedCopies = useAnimatedNumber(stats.totalCopies);

  const syncLocalLogsToServer = async () => {
    const rows = readWeeklyRows();
    if (!rows.length) return;

    const synced = loadSyncedKeys();
    const events = [];
    for (const r of rows) {
      const key = r && r.id != null ? String(r.id) : null;
      const ts = Number(r && r.ts);
      if (!key || !Number.isFinite(ts)) continue;
      if (synced.has(key)) continue;
      const ok = isSuccessStatus(r && r.status);
      events.push({ key, ts, status: ok ? 'success' : 'fail', source: 'ui' });
    }
    if (!events.length) return;

    const res = await window.api.admin.syncCopyEvents(events);
    if (res?.success) {
      for (const ev of events) synced.add(String(ev.key));
      persistSyncedKeys(synced);
    }
  };

  const refreshStats = async () => {
    try {
      await syncLocalLogsToServer();
    } catch (_) {
      // ignore
    }

    try {
      const r = await window.api.admin.getStats();
      if (r?.success && r.stats) {
        setStats({
          totalClients: Number(r.stats.totalClients || 0),
          totalCopies: Number(r.stats.totalCopies || 0)
        });
      }
    } catch (_) {
      // ignore
    }
    setLastRefreshTs(Date.now());
  };

  const refreshChart = async (p = period) => {
    try {
      await syncLocalLogsToServer();
    } catch (_) {}

    try {
      const r = await window.api.admin.getCopyStats(p);
      if (r?.success) {
        setChart({
          labels: Array.isArray(r.labels) ? r.labels : [],
          success: Array.isArray(r.success) ? r.success : [],
          fail: Array.isArray(r.fail) ? r.fail : []
        });
      }
    } catch (_) {
      // ignore
    }
  };

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshChart(period);
    const t = setInterval(() => refreshChart(period), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    const onWeekly = () => {
      refreshStats();
      refreshChart(period);
    };
    try {
      window.addEventListener('ppc:weeklyLogsUpdated', onWeekly);
    } catch (_) {}
    return () => {
      try { window.removeEventListener('ppc:weeklyLogsUpdated', onWeekly); } catch (_) {}
    };
  }, [period]);

  const expiryLabel = useMemo(() => {
    return expiryDate.toLocaleDateString('fr-FR');
  }, [expiryDate]);

  const liveText = useMemo(() => {
    const d = new Date(lastRefreshTs);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `En direct · ${time}`;
  }, [lastRefreshTs]);

  const chartData = useMemo(() => {
    return {
      labels: chart.labels,
      datasets: [
        {
          label: 'Copies réussies',
          data: chart.success,
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22,163,74,0.12)',
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 4
        },
        {
          label: 'Copies échouées',
          data: chart.fail,
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220,38,38,0.10)',
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 4
        }
      ]
    };
  }, [chart]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    };
  }, []);

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div className="dash-title">
          <h1>Bienvenue {user?.username || 'admin'}</h1>
          <div className="dash-live">
            <span className="dash-live-dot" />
            <span>{liveText}</span>
          </div>
        </div>

        <div className="dash-user">
          <button className="dash-user-btn" onClick={() => setDropdownOpen((v) => !v)}>
            <span className="dash-user-name">{user?.username || 'admin'}</span>
            <ChevronDown size={16} />
          </button>
          {dropdownOpen ? (
            <div className="dash-user-menu">
              <button
                className="dash-user-item"
                onClick={() => {
                  setDropdownOpen(false);
                  try { onLogout && onLogout(); } catch (_) {}
                }}
              >
                <LogOut size={16} />
                Déconnexion
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <section className="dash-cards">
        <div className={`dash-card dash-expiry ${expiryTone}`}>
          <div className="dash-card-icon success">
            <CalendarDays size={20} />
          </div>
          <div className="dash-card-body">
            <div className="dash-card-value">{expiryLabel}</div>
            <div className="dash-card-label">Fin de validité du dump</div>
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-icon success">
            <Users size={20} />
          </div>
          <div className="dash-card-body">
            <div className="dash-card-value">{animatedClients}</div>
            <div className="dash-card-label">Nombre total de clients</div>
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-icon success">
            <Copy size={20} />
          </div>
          <div className="dash-card-body">
            <div className="dash-card-value">{animatedCopies}</div>
            <div className="dash-card-label">Nombre de copies vendues</div>
          </div>
        </div>
      </section>

      <section className="dash-chart">
        <div className="dash-chart-head">
          <h2>Nombre total de copies faites</h2>
          <div className="dash-toggle">
            <button
              className={period === 'monthly' ? 'active' : ''}
              onClick={() => setPeriod('monthly')}
            >
              Mensuel
            </button>
            <button
              className={period === 'weekly' ? 'active' : ''}
              onClick={() => setPeriod('weekly')}
            >
              Hebdomadaire
            </button>
          </div>
        </div>

        <div className="dash-chart-canvas">
          <Line data={chartData} options={chartOptions} />
        </div>
      </section>
    </div>
  );
}
