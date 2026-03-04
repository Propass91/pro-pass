import React, { useEffect, useState } from 'react';
import { Cpu, Loader2 } from 'lucide-react';

export default function Dump() {
  const [listening, setListening] = useState(false);
  const [captureBanner, setCaptureBanner] = useState(null); // { kind:'success'|'error', text }
  const [readerStatus, setReaderStatus] = useState('—');
  const [badgeStatus, setBadgeStatus] = useState('—');
  const [flashOk, setFlashOk] = useState(false);

  const lastKey = 'ppc_dump_last_save_v1';
  const journalKey = 'ppc_dump_journal_v1';
  const [lastSaveTs, setLastSaveTs] = useState(0);
  const [journalRows, setJournalRows] = useState([]); // [{ id, ts }]

  const formatDateFr = (ts) => {
    try {
      if (!ts) return '—';
      return new Date(Number(ts)).toLocaleDateString('fr-FR');
    } catch (_) {
      return '—';
    }
  };

  const formatTimeFr = (ts) => {
    try {
      if (!ts) return '—';
      return new Date(Number(ts)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return '—';
    }
  };

  const recordSave = (ts) => {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return;
    setLastSaveTs(n);
    try {
      localStorage.setItem(lastKey, JSON.stringify({ ts: n }));
    } catch (_) {}

    setJournalRows((prev) => {
      const row = { id: `${n}_${Math.random().toString(16).slice(2)}`, ts: n };
      const next = [row, ...(Array.isArray(prev) ? prev : [])].slice(0, 30);
      try {
        localStorage.setItem(journalKey, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  useEffect(() => {
    // Real-time badge detection (does not replace Python dump engine)
    let unsubPresent = null;
    let unsubRemoved = null;
    let alive = true;

    const initRealtime = async () => {
      try {
        setReaderStatus('Détection…');
        setBadgeStatus('Non détecté');
        const r = await window.api.nfc.startPresenceWatch();
        if (!alive) return;
        if (r?.success) setReaderStatus('OK');
        else setReaderStatus('Non détecté');
      } catch (_) {
        if (!alive) return;
        setReaderStatus('Non détecté');
      }

      try {
        unsubPresent = window.api.nfc.onCardPresent((uid) => {
          try {
            setReaderStatus('OK');
            setBadgeStatus(uid ? 'OK' : 'OK');
          } catch (_) {}
        });
        unsubRemoved = window.api.nfc.onCardRemoved(() => {
          try {
            setReaderStatus('OK');
            setBadgeStatus('Non détecté');
          } catch (_) {}
        });
      } catch (_) {}

    };

    initRealtime();
    try {
      const raw = localStorage.getItem(lastKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const ts = Number(parsed && parsed.ts || 0);
        if (Number.isFinite(ts) && ts > 0) setLastSaveTs(ts);
      }
    } catch (_) {}

    try {
      const raw = localStorage.getItem(journalKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setJournalRows(parsed);
      }
    } catch (_) {}

    return () => {
      alive = false;
      try { if (typeof unsubPresent === 'function') unsubPresent(); } catch (_) {}
      try { if (typeof unsubRemoved === 'function') unsubRemoved(); } catch (_) {}
      try { window.api.nfc.stopPresenceWatch(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extractNow = async () => {
    setCaptureBanner(null);
    setListening(true);
    setReaderStatus('Détection…');
    setBadgeStatus('Détection…');
    try {
      const res = await window.api.nfc.readDump();
      if (!res?.success) {
        const err = String(res?.error || '');
        if (err.includes('SYNC_SERVER_FAILED')) {
          setCaptureBanner({ kind: 'error', text: 'CAPTURE OK MAIS SYNC SERVEUR ÉCHOUÉE' });
          setReaderStatus('OK');
          setBadgeStatus('OK');
          return;
        }
        setCaptureBanner({ kind: 'error', text: 'ÉCHEC DE LA CAPTURE' });
        const code = String(res?.error || '');
        if (code === 'NO_READER' || code === 'PYSCARD_MISSING' || code === 'PYTHON_NOT_FOUND') {
          setReaderStatus('Non détecté');
          setBadgeStatus('—');
        } else if (code === 'CARD_TIMEOUT') {
          setReaderStatus('OK');
          setBadgeStatus('Non détecté');
        } else {
          setReaderStatus('OK');
          setBadgeStatus('Erreur');
        }
        return;
      }
      const ts = Date.now();
      const now = new Date(ts);
      const dateStr = now.toLocaleDateString('fr-FR');
      const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      setCaptureBanner({ kind: 'success', text: `CAPTURE RÉUSSIE - ${dateStr} à ${timeStr}` });
      setReaderStatus('OK');
      setBadgeStatus('OK');
      setFlashOk(true);
      setTimeout(() => setFlashOk(false), 2000);
      recordSave(ts);
    } catch (_) {
      setCaptureBanner({ kind: 'error', text: 'ÉCHEC DE LA CAPTURE' });
      setReaderStatus('OK');
      setBadgeStatus('Non détecté');
    } finally {
      setListening(false);
    }
  };

  // Production mode: no monitoring stats here.

  return (
    <div className="dump-prod">
      <div className="recent-copies dump-prod-card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <button className={flashOk ? 'btn-success' : 'btn-primary'} onClick={extractNow} disabled={listening}>
            {listening ? <Loader2 className="spin" size={18} /> : <Cpu size={18} />}
            EXTRAIRE
          </button>

          <div className="status-leds">
            <div className="status-led-row">
              <span className={`led ${readerStatus === 'OK' ? 'green' : (readerStatus === 'Non détecté' ? 'red' : 'gray')}`} />
              <span>LECTEUR</span>
            </div>
            <div className="status-led-row">
              <span className={`led ${badgeStatus === 'OK' ? 'green' : (badgeStatus === 'Non détecté' ? 'red' : 'gray')}`} />
              <span>BADGE</span>
            </div>
          </div>
        </div>

        {captureBanner ? (
          <div className={`dump-banner ${captureBanner.kind}`} style={{ marginTop: 12, textAlign: 'center' }}>
            {captureBanner.text}
          </div>
        ) : null}

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
          <div className="dump-info-card">
            <div className="dump-info-label">Dernière sauvegarde</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Heure</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatDateFr(lastSaveTs)}</td>
                  <td>{formatTimeFr(lastSaveTs)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="dump-info-card">
            <div className="dump-info-label">Journal</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Heure</th>
                </tr>
              </thead>
              <tbody>
                {journalRows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateFr(r.ts)}</td>
                    <td>{formatTimeFr(r.ts)}</td>
                  </tr>
                ))}
                {!journalRows.length ? (
                  <tr>
                    <td colSpan={2} style={{ color: '#64748b', fontSize: 12, padding: 12, textAlign: 'center' }}>
                      Aucune sauvegarde
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
