import React, { useEffect, useState } from 'react';
import { Users, Globe, Copy, RefreshCw, TrendingUp, CheckCircle, XCircle, Clock, Activity, Database } from 'lucide-react';

function ProgressBar({ value, max, color = 'var(--accent)', height = 6 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: 'var(--border)', borderRadius: 99, height, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 99, transition: 'width 0.8s cubic-bezier(.4,0,.2,1)' }} />
    </div>
  );
}

function StatCard({ icon: Icon, title, value, subtitle, color = 'var(--accent)' }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={22} color={color} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</p>
        <p style={{ margin: '2px 0 0', fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{value}</p>
        {subtitle && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text2)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, color = 'var(--accent)', children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color={color} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{title}</span>
      </div>
      <div style={{ padding: '20px 24px' }}>{children}</div>
    </div>
  );
}

function MetricRow({ label, value, total, color, icon: Icon }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {Icon && <Icon size={13} color={color || 'var(--text2)'} />}
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>{label}</span>
        </div>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{value}</span>
      </div>
      {total > 0 && <ProgressBar value={value} max={total} color={color || 'var(--accent)'} />}
    </div>
  );
}

export default function AdminStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.api.admin.getStats();
        if (r?.success) setStats(r.stats);
        else setError(r?.error || 'Erreur inconnue');
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12, color: 'var(--text2)' }}>
      <Activity size={20} />
      <span>Chargement des statistiques...</span>
    </div>
  );

  if (error) return (
    <div style={{ margin: 32, padding: 20, borderRadius: 12, background: '#ff6b6b18', border: '1px solid #ff6b6b55', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <XCircle size={18} /><span>Erreur : {error}</span>
    </div>
  );

  if (!stats) return <p style={{ color: 'var(--text2)', padding: 32 }}>Aucune donnee disponible.</p>;

  const { users, sites, copies, sync } = stats;
  const successRate = copies?.successRate ?? 0;
  const rateColor = successRate >= 90 ? 'var(--success)' : successRate >= 60 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent)22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Activity size={20} color="var(--accent)" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Statistiques globales</h2>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)' }}>Vue d ensemble de la plateforme</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard icon={Users}      title="Clients totaux"  value={users?.total ?? 0}  color="var(--accent)"  subtitle={users?.active + " actifs  " + users?.inactive + " inactifs"} />
        <StatCard icon={Globe}      title="Sites"           value={sites?.total ?? 0}  color="var(--accent2)" subtitle={sites?.withData + " avec donnees"} />
        <StatCard icon={Copy}       title="Copies totales"  value={copies?.total ?? 0} color="var(--warning)" subtitle={copies?.success + " succes"} />
        <StatCard icon={TrendingUp} title="Taux de succes"  value={successRate + "%"}  color={rateColor}      subtitle="copies reussies" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <SectionCard icon={Users} title="Clients" color="var(--accent)">
          <MetricRow label="Actifs"   value={users?.active   ?? 0} total={users?.total ?? 0} color="var(--success)" icon={CheckCircle} />
          <MetricRow label="Inactifs" value={users?.inactive ?? 0} total={users?.total ?? 0} color="var(--danger)"  icon={XCircle} />
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 10, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Taux d activation</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: users?.total > 0 && users.active / users.total >= .7 ? 'var(--success)' : 'var(--warning)' }}>
              {users?.total > 0 ? Math.round((users.active / users.total) * 100) : 0}%
            </span>
          </div>
        </SectionCard>

        <SectionCard icon={Globe} title="Sites" color="var(--accent2)">
          <MetricRow label="Avec donnees" value={sites?.withData ?? 0}                           total={sites?.total ?? 0} color="var(--accent2)" icon={Database} />
          <MetricRow label="Vides"        value={(sites?.total ?? 0) - (sites?.withData ?? 0)}   total={sites?.total ?? 0} color="var(--text2)"   icon={Globe} />
        </SectionCard>

        <SectionCard icon={Copy} title="Copies de badges" color="var(--warning)">
          <MetricRow label="Succes" value={copies?.success ?? 0} total={copies?.total ?? 0} color="var(--success)" icon={CheckCircle} />
          <MetricRow label="Echecs" value={copies?.failed  ?? 0} total={copies?.total ?? 0} color="var(--danger)"  icon={XCircle} />
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Taux de succes</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: rateColor }}>{successRate}%</span>
            </div>
            <ProgressBar value={successRate} max={100} color={rateColor} height={8} />
          </div>
        </SectionCard>

        <SectionCard icon={RefreshCw} title="Synchronisation" color="var(--accent)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={14} color="var(--text2)" />
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>Derniere sync</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {sync?.lastSync ? new Date(sync.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={14} color={sync?.pendingEvents > 0 ? 'var(--warning)' : 'var(--success)'} />
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>En attente</span>
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: sync?.pendingEvents > 0 ? 'var(--warning)' : 'var(--success)' }}>
                {sync?.pendingEvents ?? 0}
              </span>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
