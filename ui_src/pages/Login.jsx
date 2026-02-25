import React, { useEffect, useState } from 'react';

function Login({ onLoginSuccess }) {
  // Ajout du mode cloud/local
  const [cloudMode, setCloudMode] = useState(() => {
    // Par défaut, mode cloud
    return 'cloud';
  });
  const [cloudUrl, setCloudUrl] = useState(() => {
    return 'https://johnny-chasmic-nonconstructively.ngrok-free.dev';
  });
  useEffect(() => {
    localStorage.setItem('ppcCloudMode', cloudMode);
    setCloudUrl('https://johnny-chasmic-nonconstructively.ngrok-free.dev');
    window.api.setCloudUrl && window.api.setCloudUrl('https://johnny-chasmic-nonconstructively.ngrok-free.dev');
  }, [cloudMode]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Nouveaux états pour le mode "mot de passe oublié"
  const [forgotMode, setForgotMode] = useState(false);
  const [resetStep, setResetStep] = useState(1); // 1: demander email, 2: token+mdp
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    try {
      document.body.classList.add('login-body');
      return () => document.body.classList.remove('login-body');
    } catch (_) {
      return () => {};
    }
  }, []);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      try { console.log('Tentative de connexion pour:', username); } catch (_) {}
      const res = await window.api.auth.login(username, password);
      if (res?.success && res.user) {
        try {
          const userPayload = { ...(res.user || {}) };
          if (res.token) userPayload.token = String(res.token);
          onLoginSuccess && onLoginSuccess(userPayload);
        } catch (_) {}
        return;
      }
      if (res?.error === 'OFFLINE') setError('Connexion Internet requise');
      else setError('Identifiants invalides');
    } catch (e) {
      setError(e?.message || 'Erreur login');
    } finally {
      setLoading(false);
    }
  };


  // Nouvelle gestion "mot de passe oublié"
  const handleForgotRequest = async (e) => {
    e && e.preventDefault();
    setResetError('');
    setResetMessage('');
    setResetLoading(true);
    try {
      const r = await window.api.auth.requestReset(resetEmail);
      if (r?.success) {
        setResetMessage('Si le compte existe, un email a été envoyé.');
        setResetStep(2);
      } else {
        setResetError('Demande impossible.');
      }
    } catch (err) {
      setResetError('Erreur lors de la demande.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleForgotConfirm = async (e) => {
    e && e.preventDefault();
    setResetError('');
    setResetMessage('');
    setResetLoading(true);
    try {
      const r = await window.api.auth.confirmReset(resetToken, resetNewPassword);
      if (r?.success) {
        setResetMessage('Mot de passe mis à jour. Vous pouvez vous connecter.');
        setTimeout(() => {
          setForgotMode(false);
          setResetStep(1);
          setResetEmail('');
          setResetToken('');
          setResetNewPassword('');
          setResetMessage('');
        }, 2000);
      } else {
        setResetError('Token invalide ou expiré.');
      }
    } catch (err) {
      setResetError('Erreur lors de la validation.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div style={{marginBottom:16, textAlign:'center'}}>
        <span style={{fontWeight:'bold'}}>Mode serveur :</span>
        <button
          style={{marginLeft:8, marginRight:8, background: cloudMode==='local'? '#4caf50':'#eee', color: cloudMode==='local'? '#fff':'#333', border:'none', borderRadius:4, padding:'4px 12px'}}
          onClick={() => setCloudMode('local')}
        >Local</button>
        <button
          style={{marginLeft:8, background: cloudMode==='cloud'? '#2196f3':'#eee', color: cloudMode==='cloud'? '#fff':'#333', border:'none', borderRadius:4, padding:'4px 12px'}}
          onClick={() => setCloudMode('cloud')}
        >Cloud</button>
        <span style={{marginLeft:12, fontSize:'0.9em', color:'#888'}}>{cloudUrl}</span>
      </div>
      {!forgotMode ? (
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="login-logo" aria-label="PROPASS">
            <span className="login-dot" />
            <span className="login-brand">PROPASS</span>
          </div>

          <div className="login-title">Connexion</div>
          <div className="login-subtitle">PROPASS</div>

          <div className="login-section">Accès</div>

          <input
            className="login-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Utilisateur"
            autoFocus
          />
          <input
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
          />

          <div className="login-forgot">
            <span className="login-forgot-link" onClick={() => setForgotMode(true)}>
              Mot de passe oublié ?
            </span>
          </div>

          <button className="login-button" type="submit" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>

          {error ? <div className="login-error">{error}</div> : null}
        </form>
      ) : (
        <form className="login-card" onSubmit={resetStep === 1 ? handleForgotRequest : handleForgotConfirm}>
          <div className="login-logo" aria-label="PROPASS">
            <span className="login-dot" />
            <span className="login-brand">PROPASS</span>
          </div>
          <div className="login-title">Mot de passe oublié</div>
          <div className="login-section">
            {resetStep === 1 ? (
              <>
                <div>Entrez votre adresse e-mail ou identifiant pour recevoir un lien de réinitialisation.</div>
                <input
                  className="login-input"
                  type="text"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder="E-mail ou identifiant"
                  autoFocus
                />
                <button className="login-button" type="submit" disabled={resetLoading} style={{marginTop:12}}>
                  {resetLoading ? 'Envoi…' : 'Envoyer le lien'}
                </button>
              </>
            ) : (
              <>
                <div>Collez le code reçu par e-mail et choisissez un nouveau mot de passe.</div>
                <input
                  className="login-input"
                  type="text"
                  value={resetToken}
                  onChange={e => setResetToken(e.target.value)}
                  placeholder="Code reçu par e-mail"
                  autoFocus
                />
                <input
                  className="login-input"
                  type="password"
                  value={resetNewPassword}
                  onChange={e => setResetNewPassword(e.target.value)}
                  placeholder="Nouveau mot de passe"
                />
                <button className="login-button" type="submit" disabled={resetLoading} style={{marginTop:12}}>
                  {resetLoading ? 'Validation…' : 'Valider'}
                </button>
              </>
            )}
            <div style={{marginTop:10}}>
              <span className="login-forgot-link" onClick={() => {
                setForgotMode(false);
                setResetStep(1);
                setResetEmail('');
                setResetToken('');
                setResetNewPassword('');
                setResetMessage('');
                setResetError('');
              }}>
                Retour à la connexion
              </span>
            </div>
            {resetMessage && <div className="login-success">{resetMessage}</div>}
            {resetError && <div className="login-error">{resetError}</div>}
          </div>
        </form>
      )}
    </div>
  );
}

export default Login;
