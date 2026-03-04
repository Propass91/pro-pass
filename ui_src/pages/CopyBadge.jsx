import React, { useState, useEffect, useRef } from 'react';
import { Loader, Copy } from 'lucide-react';

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function ringDash(pct) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const p = clamp01(pct);
  const dash = c * p;
  const gap = c - dash;
  return `${dash} ${gap}`;
}

function CopyBadge({ user }) {
  const [readerConnected, setReaderConnected] = useState(false);
  const [cardPresent, setCardPresent] = useState(false);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState(null);
  const [copyLogs, setCopyLogs] = useState([]);
  const [quota, setQuota] = useState({ remaining: 14, total: 15 });

  const copyingRef = useRef(false);
  useEffect(() => {
    copyingRef.current = !!copying;
  }, [copying]);

  const [dumpState, setDumpState] = useState({
    ok: false,
    source: 'none',
    warning: null,
    lastSyncTs: 0
  });

  useEffect(() => {
    let alive = true;
    let poll = null;
    let dumpPoll = null;

    const initNfcRealtime = async () => {
      let ok = false;
      try {
        const r = await window.api.nfc.init();
        if (!alive) return;
        if (r?.connected || r === true) ok = true;
      } catch (_) {}

      try {
        const w = await window.api.nfc.startPresenceWatch();
        if (!alive) return;
        if (w?.connected || w?.success) ok = ok || !!w?.connected;
      } catch (_) {}

      setReaderConnected(!!ok);
    };

    initNfcRealtime();
    loadQuota();

    const refreshDumpState = async () => {
      try {
        const r = await window.api.dumps.getActiveDump();
        if (!alive) return;
        if (r?.success && r?.data) {
          setDumpState({
            ok: true,
            source: String(r.source || 'cloud'),
            warning: r.warning || null,
            lastSyncTs: Number(r.lastSyncTs || 0)
          });
        } else {
          setDumpState({ ok: false, source: 'none', warning: null, lastSyncTs: Number(r?.lastSyncTs || 0) });
        }
      } catch (_) {}
    };

    refreshDumpState();

    // Keep client always synchronized with latest server extraction.
    dumpPoll = setInterval(() => {
      refreshDumpState();
    }, 10000);

    let unsubDumpUpdated = null;
    try {
      if (window.api?.dumps?.onDumpUpdated) {
        unsubDumpUpdated = window.api.dumps.onDumpUpdated((p) => {
          const ts = Number((p && p.lastSyncTs) || 0);
          setDumpState((prev) => ({ ...prev, lastSyncTs: ts || Date.now(), source: 'cloud', ok: true }));
        });
      }
    } catch (_) {}

    let unsubQuota = null;
    try {
      if (window.api?.cloud?.onQuotaUpdate) {
        unsubQuota = window.api.cloud.onQuotaUpdate((q) => {
          setQuota({
            remaining: Number(q?.remaining ?? 0),
            total: Number(q?.monthly_limit ?? 15)
          });
        });
      }
    } catch (_) {}

    let unsubPyLog = null;
    try {
      if (window.api?.nfc?.onPyLog) {
        unsubPyLog = window.api.nfc.onPyLog((line) => {
          if (!copyingRef.current) return;
          const s = String(line == null ? '' : line).replace(/\r/g, '').trimEnd();
          if (!s) return;
          if (s.startsWith('[watch]') || s.startsWith('[watch:')) return;
          setCopyLogs((prev) => {
            const next = prev.concat([s]);
            return next.length > 220 ? next.slice(next.length - 220) : next;
          });
        });
      }
    } catch (_) {}

    const unsubscribePresent = window.api.nfc.onCardPresent(() => {
      setReaderConnected(true);
      setCardPresent(true);
    });

    const unsubscribeRemoved = window.api.nfc.onCardRemoved(() => {
      setCardPresent(false);
    });

    poll = setInterval(async () => {
      try {
        const state = await window.api.nfc.isConnected();
        if (!alive) return;
        const isReaderConnected = !!(state?.connected || state === true);
        setReaderConnected(isReaderConnected);
        if (isReaderConnected) {
          try { await window.api.nfc.startPresenceWatch(); } catch (_) {}
        } else {
          setCardPresent(false);
        }
      } catch (_) {}
    }, 2500);

    return () => {
      alive = false;
      try { if (poll) clearInterval(poll); } catch (_) {}
      try { if (dumpPoll) clearInterval(dumpPoll); } catch (_) {}
      unsubscribePresent();
      unsubscribeRemoved();
      try { if (typeof unsubQuota === 'function') unsubQuota(); } catch (_) {}
      try { if (typeof unsubDumpUpdated === 'function') unsubDumpUpdated(); } catch (_) {}
      try { if (typeof unsubPyLog === 'function') unsubPyLog(); } catch (_) {}
      try { window.api.nfc.stopPresenceWatch(); } catch (_) {}
    };
  }, []);

  const loadQuota = async () => {
    const q = await window.api.dumps.getQuota();
    const remaining = Number(q?.remaining ?? 0);
    const total = Math.max(1, Number(q?.monthly_limit ?? 15));
    setQuota({ remaining, total });
  };

  const handleCopy = async () => {
    if (!cardPresent) return;

    setCopying(true);
    setResult(null);
    setCopyLogs([]);

    try {
      const online = await window.api.cloud.isOnline();
      if (!online?.ok || !online?.online) {
        setResult({ success: false, message: 'Connexion Internet requise' });
        try { await window.api.dumps.logCopyFail(); } catch (_) {}
        setCopying(false);
        return;
      }

      const activeDump = await window.api.dumps.getActiveDump();
      if (!activeDump?.success || !activeDump?.data) {
        setDumpState({ ok: false, source: 'none', warning: null, lastSyncTs: Number(activeDump?.lastSyncTs || 0) });
        setResult({ success: false, message: String(activeDump?.error || 'Aucun dump disponible - connectez-vous à internet') });
        try { await window.api.dumps.logCopyFail(); } catch (_) {}
        setCopying(false);
        return;
      }

      setDumpState({
        ok: true,
        source: String(activeDump.source || 'cloud'),
        warning: activeDump.warning || null,
        lastSyncTs: Number(activeDump.lastSyncTs || 0)
      });

      const writeRes = await window.api.nfc.writeDump(String(activeDump.data));

      if (writeRes.success) {
        const dec = await window.api.dumps.writeAdminDump({ username: user && user.username ? user.username : 'client1' });
        if (!dec?.success) {
          const err = String(dec?.error || 'cloud_sync_failed');
          const relogHint = /not_authenticated|session_invalid|invalid token|jwt|unauthorized|401/i.test(err)
            ? ' Session cloud expirée: reconnectez-vous.'
            : '';
          setResult({ success: false, message: `Copie OK, mais sync cloud impossible (${err}).${relogHint}` });
          try { await window.api.dumps.logCopyFail(); } catch (_) {}
          setCopying(false);
          return;
        }

        setResult({ success: true, message: 'BADGE COPIER' });
        loadQuota();
      } else {
        setResult({ success: false, message: writeRes.message || writeRes.error || 'Échec écriture' });
        try { await window.api.dumps.logCopyFail(); } catch (_) {}
      }
    } catch (e) {
      setResult({ success: false, message: `Erreur: ${e.message}` });
      try { await window.api.dumps.logCopyFail(); } catch (_) {}
    }

    setCopying(false);
  };

  return (
    <div className="client-copy-page">
      <div className="client-copy-grid">
        <aside className="client-steps-panel">
          <div className="client-step-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>PRODUCTION</span>
            <span className={`client-sync ${dumpState.ok ? (dumpState.source === 'cloud' ? 'ok' : 'warn') : 'bad'}`}>
              {dumpState.ok ? (dumpState.source === 'cloud' ? '🟢 Synchronisé' : '🟡 Hors ligne') : '🔴 Aucun dump'}
            </span>
          </div>

          <div className="client-sync-sub">
            {dumpState.lastSyncTs
              ? `Dernière synchro: ${new Date(dumpState.lastSyncTs).toLocaleDateString('fr-FR')} à ${new Date(dumpState.lastSyncTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Dernière synchro: —'}
          </div>

          {dumpState.warning ? <div className="client-sync-warning">{dumpState.warning}</div> : null}

          <div className={`client-step-box ${readerConnected ? 'done' : ''}`}>
            <div className="client-step-title">1. BRANCHER LECTEUR</div>
            <div className="client-step-sub">{readerConnected ? 'Lecteur connecté' : 'En attente de connexion…'}</div>
          </div>

          <div className={`client-step-box ${cardPresent ? 'done' : ''}`}>
            <div className="client-step-title">2. POSER LE BADGE</div>
            <div className="client-step-sub">{cardPresent ? 'Badge détecté' : (readerConnected ? 'En attente du badge…' : 'Branchez d\'abord le lecteur')}</div>
          </div>

          <div className="client-step-box">
            <div className="client-step-title">3. SYNCHRONISER</div>
            <button className="client-copy-btn" onClick={handleCopy} disabled={!dumpState.ok || !cardPresent || copying || quota.remaining <= 0}>
              {copying ? (
                <>
                  <Loader className="spin" size={16} />
                  SYNCHRO…
                </>
              ) : (
                <>
                  <Copy size={16} />
                  COPIER
                </>
              )}
            </button>
            {quota.remaining <= 0 ? <div className="client-step-warn">Quota mensuel atteint</div> : null}
          </div>

          {result ? (
            <div className={`client-copy-result ${result.success ? 'ok' : 'err'}`}>
              {result.success ? result.message : '✗ Copie non validée'}
            </div>
          ) : null}

        </aside>

        <section className="client-copy-center">
          <div className="client-quota-panel">
            <div className="client-ring">
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="54" strokeWidth="12" className="client-ring-bg" />
                <circle
                  cx="70"
                  cy="70"
                  r="54"
                  strokeWidth="12"
                  className="client-ring-fg"
                  strokeDasharray={ringDash(quota.total ? quota.remaining / quota.total : 0)}
                />
              </svg>
              <div className="client-ring-value">{quota.remaining}</div>
            </div>

            <div className="client-quota-stats">
              <div className="client-quota-row">
                <span>Copies utilisées</span>
                <span>{Math.max(0, quota.total - quota.remaining)}</span>
              </div>
              <div className="client-quota-row">
                <span>Quota total</span>
                <span>{quota.total}</span>
              </div>
              <div className="client-quota-row">
                <span>Restantes</span>
                <span>{quota.remaining}</span>
              </div>
              <div className="client-quota-bar">
                <div className="client-quota-bar-fill" style={{ width: `${Math.round(100 * clamp01(quota.total ? quota.remaining / quota.total : 0))}%` }} />
              </div>
            </div>
          </div>

          <div className="client-cards-row">
            <div className="client-card">
              <div className="client-card-icon">📄</div>
              <div className="client-card-value">{Math.max(0, quota.total - quota.remaining)}</div>
              <div className="client-card-label">Copies ce mois</div>
            </div>
            <div className="client-card">
              <div className="client-card-icon">📃</div>
              <div className="client-card-value">{Math.max(0, quota.total - quota.remaining)}</div>
              <div className="client-card-label">Total copies</div>
            </div>
            <div className="client-card">
              <div className="client-card-icon">🗓️</div>
              <div className="client-card-value">{quota.total}</div>
              <div className="client-card-label">Limite mensuelle</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CopyBadge;
