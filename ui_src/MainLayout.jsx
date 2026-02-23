import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Admin from './pages/Admin';
import Dump from './pages/Dump';
import Clients from './pages/Clients';
import ClientForm from './pages/ClientForm';
import Logs from './pages/Logs';
import CopyBadge from './pages/CopyBadge';

function formatDdMm(d) {
  try {
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  } catch (_) {
    return '—';
  }
}

export default function MainLayout({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const isClient = user?.role === 'client';

  const [adminToken, setAdminToken] = useState(null);

  const [clientQuota, setClientQuota] = useState(null);

  useEffect(() => {
    if (!isClient) {
      setClientQuota(null);
      return;
    }

    let alive = true;
    let unsub = null;

    const load = async () => {
      try {
        const q = await window.api.dumps.getQuota();
        if (!alive) return;
        if (q) setClientQuota(q);
      } catch (_) {}
    };

    load();

    try {
      if (window.api?.cloud?.onQuotaUpdate) {
        unsub = window.api.cloud.onQuotaUpdate((q) => {
          if (!alive) return;
          setClientQuota(q || null);
        });
      }
    } catch (_) {}

    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
      try { if (typeof unsub === 'function') unsub(); } catch (_) {}
    };
  }, [isClient]);

  useEffect(() => {
    if (!isAdmin) {
      setAdminToken(null);
      return;
    }
    (async () => {
      try {
        const r = await window.api.admin.getSessionToken();
        if (r?.success && r.token) setAdminToken(r.token);
      } catch (_) {}
    })();
  }, [isAdmin]);

  // Keep dashboard metrics fresh even when user is on another page.
  useEffect(() => {
    if (!isAdmin) return;

    let alive = true;
    const key = 'ppc_admin_metrics_v1';

    const write = (patch) => {
      try {
        const raw = localStorage.getItem(key);
        const cur = raw ? JSON.parse(raw) : {};
        const next = { ...(cur || {}), ...(patch || {}), updatedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(next));
      } catch (_) {}
      try { window.dispatchEvent(new Event('ppc:metricsUpdated')); } catch (_) {}
    };

    const tick = async () => {
      if (!alive) return;
      try {
        const online = await window.api.cloud.isOnline();
        write({ serverOnline: !!(online && online.ok && online.online) });
      } catch (_) {
        write({ serverOnline: false });
      }

      try {
        const r = await window.api.admin.getSessionToken();
        if (r?.success && r.token) {
          const clients = await window.api.admin.listClients(r.token);
          if (clients?.success && Array.isArray(clients.clients)) {
            write({ totalClients: clients.clients.length });
          }
        }
      } catch (_) {
        // ignore
      }
    };

    tick();
    const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [isAdmin]);

  const path = location?.pathname || '/';
  const activePage = useMemo(() => {
    if (isAdmin) {
      if (path === '/dump') return 'dump';
      if (path === '/clients') return 'clients';
      if (path === '/history') return 'history';
      return 'unites';
    }
    return 'copy';
  }, [isAdmin, path]);

  const clientEmail = useMemo(() => {
    if (!isClient) return '';
    return String(user?.email || user?.username || 'client');
  }, [isClient, user]);

  const clientValidity = useMemo(() => {
    if (!isClient) return '';
    const endIso = clientQuota && clientQuota.valid_until;
    if (!endIso) return 'Validité : —';
    const end = new Date(String(endIso));
    if (Number.isNaN(end.getTime())) return 'Validité : —';
    const start = new Date();
    return `Validité : ${formatDdMm(start)} au ${formatDdMm(end)}`;
  }, [isClient, clientQuota]);

  return (
    <div className={`app-layout ${isClient ? 'theme-client' : 'theme-admin'}`}>
      {isAdmin ? (
        <Sidebar
          user={user}
          activePage={activePage}
          onLogout={onLogout}
          onNavigate={(id) => {
            if (id === 'dump') navigate('/dump');
            else if (id === 'clients') navigate('/clients');
            else if (id === 'history') navigate('/history');
            else navigate('/admin');
          }}
        />
      ) : null}

      <main className="main-content">
        {isClient ? (
          <header className="client-topbar">
            <div className="client-topbar-left">
              <div className="client-brand" onClick={() => navigate('/copy')} role="button" tabIndex={0}>
                <span className="client-brand-name">PROPASS</span>
              </div>
            </div>

            <div className="client-topbar-right">
              <div className="client-meta">
                <span className="client-email">{clientEmail}</span>
                <span className="client-validity">{clientValidity}</span>
              </div>
              <button className="client-logout" onClick={onLogout} title="Déconnexion">
                <LogOut size={16} />
                Déconnexion
              </button>
            </div>
          </header>
        ) : ((!!user && (isAdmin && path !== '/admin')) ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button
              className="dash-user-btn"
              onClick={onLogout}
              title="Déconnexion"
              style={{ gap: 10 }}
            >
              <LogOut size={16} />
              Déconnexion
            </button>
          </div>
        ) : null)}
        <Routes>
          <Route
            path="/"
            element={isAdmin ? <Navigate to="/admin" replace /> : <Navigate to="/copy" replace />}
          />

          <Route
            path="/admin"
            element={isAdmin ? (
              <Admin
                user={user}
                onLogout={onLogout}
                activePage="unites"
                externalFilterSiteId={null}
                onExternalFilterSiteId={() => {}}
              />
            ) : (
              <Navigate to="/home" replace />
            )}
          />
          <Route
            path="/clients"
            element={isAdmin ? <Clients /> : <Navigate to="/home" replace />}
          />

          <Route
            path="/clients/new"
            element={isAdmin ? <ClientForm /> : <Navigate to="/home" replace />}
          />

          <Route
            path="/clients/:id"
            element={isAdmin ? <ClientForm /> : <Navigate to="/home" replace />}
          />
          <Route
            path="/history"
            element={isAdmin ? <Logs /> : <Navigate to="/home" replace />}
          />
          <Route
            path="/dump"
            element={isAdmin ? <Dump adminToken={adminToken} /> : <Navigate to="/home" replace />}
          />

          <Route path="/home" element={<Navigate to="/copy" replace />} />
          <Route
            path="/copy"
            element={isClient ? <CopyBadge user={user} /> : <Navigate to="/admin" replace />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
