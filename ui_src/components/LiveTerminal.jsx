import React, { useEffect, useRef } from 'react';

export default function LiveTerminal({ title = 'LOGS', lines = [], className = '' }) {
  const endRef = useRef(null);

  useEffect(() => {
    try {
      endRef.current?.scrollIntoView({ block: 'end' });
    } catch (_) {
      // ignore
    }
  }, [lines]);

  if (!lines || !lines.length) return null;

  return (
    <div className={`client-copy-logs ${className}`.trim()}>
      <div className="client-copy-logs-title">{title}</div>
      <pre className="client-copy-logs-body">
        {lines.join('\n')}
        <span ref={endRef} />
      </pre>
    </div>
  );
}
