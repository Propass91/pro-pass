import React, { useEffect, useMemo, useState } from 'react';
import AdminDashboard from './AdminDashboard';

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function sanitizeHex(str) {
  return String(str || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function buildDumpFromSectors(sectors) {
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const h = sanitizeHex(sectors[i] || '');
    if (h.length !== 128) return { ok: false, error: `Secteur ${i}: 128 hex requis (64 bytes)` };
    parts.push(h);
  }
  return { ok: true, dumpHex: parts.join('') };
}

function Admin({ user, onLogout, activePage, externalFilterSiteId, onExternalFilterSiteId }) {
  const [token, setToken] = useState(null);
  const [loginError, setLoginError] = useState(false);

  const showUnits = activePage === 'unites';
  const showDump = activePage === 'dump';
  const showClients = activePage === 'clients';
  const showHistory = activePage === 'history';

  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [quotaInputs, setQuotaInputs] = useState({});

  const [allSites, setAllSites] = useState([]);
  const [filterSiteId, setFilterSiteId] = useState(''); // '' => no filter

  const [logs, setLogs] = useState([]);

  const [dumpMode, setDumpMode] = useState('direct'); // direct | manual
  const [manualHex, setManualHex] = useState('');
  const [manualFileName, setManualFileName] = useState('');
  const [sectorHex, setSectorHex] = useState(() => Array.from({ length: 16 }, () => ''));
  const [manualError, setManualError] = useState(null);

  const [sites, setSites] = useState([]);
  const [siteNameInput, setSiteNameInput] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState(null); // null => Global

  const selectedClient = useMemo(() => {
    const id = Number(selectedClientId);
    return clients.find((c) => Number(c.id) === id) || null;
  }, [clients, selectedClientId]);

  useEffect(() => {
    // Tableau de bord does not need the internal admin token.
    if (showUnits) return;
    if (token) return;
    (async () => {
      try {
        const r = await window.api.admin.getSessionToken();
        if (r?.success && r.token) {
          setToken(r.token);
          await refreshClients(r.token);
        } else {
          setLoginError(true);
        }
      } catch (_) {
        setLoginError(true);
      }
    })();
  }, [token, showUnits]);

  useEffect(() => {
    if (!token) return;

    let unsub = null;
    if (window.api?.admin?.onLog) {
      unsub = window.api.admin.onLog((line) => {
        setLogs((prev) => {
          const next = prev.concat([String(line)]);
          return next.slice(-200);
        });
      });
    }

    (async () => {
      try {
        const r = await window.api.admin.getAdminLogs(token);
        if (r?.success && Array.isArray(r.logs)) setLogs(r.logs);
      } catch (_) {}
    })();

    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch (_) {}
    };
  }, [token]);

  const refreshClients = async (t = token) => {
    if (!t) return;
    const r = await window.api.admin.listClients(t);
    if (r?.success) {
      setClients(r.clients || []);
      if (!selectedClientId && r.clients && r.clients[0]) {
        setSelectedClientId(r.clients[0].id);
      }
    }
  };

  const refreshAllSites = async (t = token) => {
    if (!t) return;
    try {
      const r = await window.api.admin.listAllSites(t);
      if (r?.success) setAllSites(r.sites || []);
    } catch (_) {
      setAllSites([]);
    }
  };

  useEffect(() => {
    if (!token) return;
    refreshAllSites();
  }, [token]);

  useEffect(() => {
    if (externalFilterSiteId == null) {
      setFilterSiteId('');
      return;
    }
    setFilterSiteId(String(externalFilterSiteId));
  }, [externalFilterSiteId]);

  const filteredClients = useMemo(() => {
    if (!filterSiteId) return clients;
    const sid = Number(filterSiteId);
    const site = allSites.find((s) => Number(s.id) === sid);
    if (!site) return clients;
    const cid = Number(site.client_id);
    return clients.filter((c) => Number(c.id) === cid);
  }, [clients, filterSiteId, allSites]);

  const refreshSites = async (clientId = selectedClientId, t = token) => {
    if (!t || !clientId) {
      setSites([]);
      setSelectedSiteId(null);
      return;
    }
    try {
      const r = await window.api.admin.listSites(t, { clientId: Number(clientId) });
      if (r?.success) {
        setSites(r.sites || []);
      }
    } catch (_) {
      setSites([]);
    }
  };

  useEffect(() => {
    if (!token) return;
    refreshSites();
  }, [token, selectedClientId]);

  const handleBackupDb = async () => {
    await window.api.admin.backupDb(token);
  };

  const handleAddQuota = async (clientId) => {
    const addQuota = Number(quotaInputs[clientId] || 0);
    if (!Number.isFinite(addQuota) || addQuota === 0) return;
    const r = await window.api.admin.addQuota(token, { clientId, addQuota });
    if (r?.success) {
      setQuotaInputs((prev) => ({ ...prev, [clientId]: '' }));
      await refreshClients();
    }
  };

  const handleToggleClientStatus = async (client) => {
    if (!client || client.id == null) return;
    const isActive = client.is_active !== false && client.active !== false;
    const prompt = isActive
      ? `Désactiver le client "${client.name || client.username}" ?`
      : `Réactiver le client "${client.name || client.username}" ?`;
    if (!window.confirm(prompt)) return;
    const r = await window.api.admin.toggleClientStatus(client.id);
    if (r?.success) {
      await refreshClients();
    }
  };

  const handleCreateMasterDump = async () => {
    if (!selectedClientId) return;
    if (dumpMode === 'manual') {
      const h = sanitizeHex(manualHex);
      if (h.length !== 2048) {
        setManualError('Dump manuel invalide (2048 hex requis = 1024 bytes)');
        return;
      }
      setManualError(null);
      await window.api.admin.createMasterDump(token, { clientId: Number(selectedClientId), siteId: selectedSiteId == null ? null : Number(selectedSiteId), mode: 'manual', dumpHex: h });
    } else {
      await window.api.admin.createMasterDump(token, { clientId: Number(selectedClientId), siteId: selectedSiteId == null ? null : Number(selectedSiteId), mode: 'direct' });
    }
    await refreshClients();
  };

  const handleAddSite = async () => {
    if (!selectedClientId || !siteNameInput.trim()) return;
    const r = await window.api.admin.createSite(token, { clientId: Number(selectedClientId), name: siteNameInput.trim() });
    if (r?.success) {
      setSiteNameInput('');
      await refreshSites();
    }
  };

  const handleRenameSite = async (siteId) => {
    const current = sites.find((s) => Number(s.id) === Number(siteId));
    const next = window.prompt('Nouveau nom du site:', current?.name || '');
    if (!next || !next.trim()) return;
    await window.api.admin.renameSite(token, { siteId: Number(siteId), name: next.trim() });
    await refreshSites();
  };

  const handleDeleteSite = async (siteId) => {
    const ok = window.confirm('Supprimer ce site ?');
    if (!ok) return;
    await window.api.admin.deleteSite(token, { siteId: Number(siteId) });
    if (Number(selectedSiteId) === Number(siteId)) setSelectedSiteId(null);
    await refreshSites();
  };

  const handleCaptureFromFile = async (file) => {
    setManualError(null);
    try {
      if (!file) return;
      setManualFileName(file.name || '');
      const buf = new Uint8Array(await file.arrayBuffer());

      // Accept either binary dump (>=1024 bytes) or a text file containing hex.
      let hex = '';
      const asText = (() => {
        try {
          const dec = new TextDecoder('utf-8', { fatal: false });
          return dec.decode(buf);
        } catch (_) {
          return '';
        }
      })();

      const maybeHex = sanitizeHex(asText);
      if (maybeHex.length >= 2048) {
        hex = maybeHex.slice(0, 2048);
      } else if (buf.length >= 1024) {
        hex = bytesToHex(buf.slice(0, 1024));
      } else {
        setManualError('Fichier dump trop petit (attendu 1024 bytes ou 2048 hex)');
        return;
      }

      setManualHex(hex);
    } catch (e) {
      setManualError(e?.message || 'Import impossible');
    }
  };

  const handleBuildFromSectors = () => {
    const r = buildDumpFromSectors(sectorHex);
    if (!r.ok) {
      setManualError(r.error);
      return;
    }
    setManualError(null);
    setManualHex(r.dumpHex);
  };

  const handleTestCopy = async () => {
    if (!selectedClientId) return;
    await window.api.admin.testCopy(token, { clientId: Number(selectedClientId) });
    await refreshClients();
  };

  if (!token && !showUnits) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h1>Admin</h1>
            <p className="subtitle">Accès protégé</p>
          </div>
        </header>

        <div className="quota-section">
          <h2>Session admin</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 10, fontSize: 13 }}>
            Initialisation…
          </p>
          {loginError && (
            <p style={{ color: 'var(--danger)', marginTop: 10, fontSize: 13 }}>
              Impossible d'initialiser la session admin
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {!showUnits ? (
        <header className="page-header">
          <div>
            <h1>Admin</h1>
            <p className="subtitle">Gestion clients • Laboratoire • Sauvegardes</p>
          </div>
          <button className="btn-refresh" onClick={() => refreshClients()}>Actualiser</button>
        </header>
      ) : null}

      {showUnits ? (
        <AdminDashboard user={user} onLogout={onLogout} />
      ) : null}

      {showClients ? (
        <div className="recent-copies">
          <div className="section-header">
            <h2>Gestion & sécurité</h2>
            <span className="badge-blue">SQLite</span>
          </div>
          <button className="btn-refresh" onClick={handleBackupDb}>SAUVEGARDE DB</button>
        </div>
      ) : null}

      {showClients ? (
      <div className="recent-copies">
        <div className="section-header">
          <h2>Clients</h2>
          <span className="badge-blue">{filteredClients.length}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Filtrer par Site/Boutique:</span>
          <select
            value={filterSiteId}
            onChange={(e) => {
              const v = e.target.value;
              setFilterSiteId(v);
              try {
                if (typeof onExternalFilterSiteId === 'function') onExternalFilterSiteId(v ? Number(v) : null);
              } catch (_) {}
              if (!v) return;
              const sid = Number(v);
              const site = allSites.find((s) => Number(s.id) === sid);
              if (site && site.client_id != null) {
                setSelectedClientId(Number(site.client_id));
              }
            }}
            style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border)', minWidth: 260 }}
          >
            <option value="">Tous les sites</option>
            {allSites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {(s.client_name || s.client_username || 'Client') + ' — ' + s.name}
              </option>
            ))}
          </select>

          <button className="btn-refresh" onClick={() => refreshAllSites()}>Rafraîchir sites</button>
        </div>

        <div className="admin-table-wrap">
          <table className="data-table admin-table">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 6px' }}>Client</th>
                <th style={{ padding: '10px 6px', width: 160 }}>Actions</th>
                <th style={{ padding: '10px 6px' }}>Email</th>
                <th style={{ padding: '10px 6px' }}>Quota mensuel</th>
                <th style={{ padding: '10px 6px' }}>Validité</th>
                <th style={{ padding: '10px 6px', width: 220 }}>Ajouter quota</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 6px' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={Number(selectedClientId) === Number(c.id)}
                        onChange={() => setSelectedClientId(c.id)}
                      />
                      <span>{c.name || c.username}</span>
                    </label>
                  </td>
                  <td style={{ padding: '10px 6px' }}>
                    <button className="btn-refresh" onClick={() => handleToggleClientStatus(c)}>
                      {c.is_active === false || c.active === false ? 'Réactiver' : 'Supprimer'}
                    </button>
                  </td>
                  <td style={{ padding: '10px 6px', color: 'var(--text-muted)' }}>{c.email || '-'}</td>
                  <td style={{ padding: '10px 6px' }}><strong>{c.quota_remaining}</strong> / {c.monthly_limit}</td>
                  <td style={{ padding: '10px 6px', color: 'var(--text-muted)' }}>{c.valid_until ? new Date(c.valid_until).toLocaleDateString() : '-'}</td>
                  <td style={{ padding: '10px 6px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={quotaInputs[c.id] ?? ''}
                        onChange={(e) => setQuotaInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        placeholder="+10"
                        style={{ width: 90, padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}
                      />
                      <button className="btn-refresh" onClick={() => handleAddQuota(c.id)}>Ajouter</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
          Règle: toute recharge quota met à jour automatiquement la date de validité (+30 jours).
        </p>
      </div>
      ) : null}

      {showDump ? (
      <div className="recent-copies">
        <div className="section-header">
          <h2>Master Dump (Hybride)</h2>
          <span className="badge-blue">NFC</span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn-refresh"
            onClick={() => setDumpMode('manual')}
            style={{ opacity: dumpMode === 'manual' ? 1 : 0.75 }}
          >
            Dump Manuel (Upload)
          </button>
          <button
            className="btn-refresh"
            onClick={() => setDumpMode('direct')}
            style={{ opacity: dumpMode === 'direct' ? 1 : 0.75 }}
          >
            Dump Automatique (Lecteur)
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Site:</span>
            <select
              value={selectedSiteId == null ? '' : String(selectedSiteId)}
              onChange={(e) => setSelectedSiteId(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}
            >
              <option value="">Global (client)</option>
              {sites.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {dumpMode === 'direct' ? (
          <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
            Posez le badge source sur l’ACR122U puis cliquez sur “Capture Directe”. Le dump est lu et envoyé au serveur.
          </p>
        ) : (
          <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
            Importez un dump (.bin/.nfc) ou saisissez secteur par secteur (16 secteurs × 64 bytes) puis envoyez.
          </p>
        )}

        {dumpMode === 'manual' && (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="file"
                accept=".bin,.nfc,.dump,.txt"
                onChange={(e) => handleCaptureFromFile(e.target.files && e.target.files[0])}
              />
              {manualFileName ? (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{manualFileName}</span>
              ) : null}
              <button className="btn-refresh" onClick={handleBuildFromSectors}>Assembler depuis secteurs</button>
            </div>

            <textarea
              value={manualHex}
              onChange={(e) => setManualHex(e.target.value)}
              placeholder="Dump HEX (2048 caractères)"
              style={{ width: '100%', minHeight: 120, padding: 10, borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}
            />

            <div style={{ display: 'grid', gap: 8 }}>
              {sectorHex.map((v, idx) => (
                <div key={idx} style={{ display: 'grid', gap: 6 }}>
                  <label style={{ color: 'var(--text-muted)', fontSize: 12 }}>Secteur {idx} (128 hex)</label>
                  <input
                    value={v}
                    onChange={(e) => setSectorHex((prev) => {
                      const next = prev.slice();
                      next[idx] = e.target.value;
                      return next;
                    })}
                    placeholder="00.. (64 bytes)"
                    style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}
                  />
                </div>
              ))}
            </div>

            {manualError && (
              <div style={{ color: 'var(--danger)', fontSize: 12 }}>{manualError}</div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-refresh" onClick={handleCreateMasterDump}>
            {dumpMode === 'direct' ? 'CAPTURE DIRECTE' : 'ENVOYER DUMP MANUEL'}
          </button>
          <button className="btn-refresh" onClick={handleTestCopy}>
            TESTER COPIE (ADMIN)
          </button>
        </div>

        <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
          Règle: dès qu’un dump (manuel ou direct) est associé à un client, la validité est mise à jour (+30 jours).
        </p>
      </div>
      ) : null}

      {showUnits ? (
      <div className="recent-copies">
        <div className="section-header">
          <h2>Multi-sites (SQLite)</h2>
          <span className="badge-blue">{sites.length}</span>
        </div>

        {!selectedClient ? (
          <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>Sélectionnez un client.</p>
        ) : (
          <>
            <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
              Sites rattachés à <strong>{selectedClient.name || selectedClient.username}</strong>
            </p>

            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={siteNameInput}
                onChange={(e) => setSiteNameInput(e.target.value)}
                placeholder="Nom du site"
                style={{ width: 220, padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}
              />
              <button className="btn-refresh" onClick={handleAddSite}>+ Ajouter site</button>
              <button className="btn-refresh" onClick={() => refreshSites()}>Recharger</button>
            </div>

            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '10px 6px' }}>Site</th>
                    <th style={{ padding: '10px 6px', width: 220 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 6px' }}>{s.name}</td>
                      <td style={{ padding: '10px 6px' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn-refresh" onClick={() => { setSelectedSiteId(Number(s.id)); }}>Utiliser</button>
                          <button className="btn-refresh" onClick={() => handleRenameSite(s.id)}>Renommer</button>
                          <button className="btn-refresh" onClick={() => handleDeleteSite(s.id)}>Supprimer</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sites.length === 0 ? (
                    <tr>
                      <td style={{ padding: '10px 6px', color: 'var(--text-muted)' }} colSpan={2}>Aucun site</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      ) : null}

      {showHistory ? (
      <div className="recent-copies">
        <div className="section-header">
          <h2>Logs lecteur</h2>
          <span className="badge-blue">Live</span>
        </div>
        <div style={{
          background: '#0b1220',
          color: '#e5e7eb',
          borderRadius: 8,
          padding: 12,
          height: 160,
          overflow: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 12
        }}>
          {logs.length ? logs.map((l, i) => <div key={i}>{l}</div>) : <div style={{ color: '#9ca3af' }}>Aucun log</div>}
        </div>
      </div>
      ) : null}
    </div>
  );
}

export default Admin;
