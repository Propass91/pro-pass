import React, { useEffect, useRef, useState } from 'react';

function filterLog(text) {
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('UID:'))
    .join('\n');
}

function Sync() {
  const [status, setStatus] = useState('idle'); // idle | running
  const [error, setError] = useState('');
  const [log, setLog] = useState('');
  const timerRef = useRef(null);

  const refreshLog = async () => {
    const res = await window.api.matrix.readLog();
    if (res?.success) setLog(filterLog(res.text || ''));
  };

  const start = async () => {
    setError('');
    setStatus('running');
    setLog('');

    const res = await window.api.matrix.sync();
    if (!res?.success) {
      setStatus('idle');
      setError(res?.error || 'Erreur');
      return;
    }

    await refreshLog();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      void refreshLog();
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2937' }}>Synchronisation</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Synchroniser la matrice depuis VAULT/SOURCE_ZERO.bin</div>
        </div>

        <button
          type="button"
          onClick={start}
          disabled={status === 'running'}
          style={{
            fontSize: 14,
            padding: '10px 16px',
            background: '#ffffff',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            cursor: status === 'running' ? 'not-allowed' : 'pointer',
            color: '#1f2937',
          }}
        >
          SYNCHRONISER LA MATRICE
        </button>
      </div>

      {error ? (
        <div style={{ marginTop: 16, color: '#dc2626', fontSize: 14 }}>{String(error)}</div>
      ) : null}

      <div
        style={{
          marginTop: 20,
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: 16,
        }}
      >
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Logs (temps réel)</div>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            color: '#1f2937',
            minHeight: 220,
          }}
        >
          {log || '—'}
        </pre>
      </div>
    </div>
  );
}

export default Sync;
