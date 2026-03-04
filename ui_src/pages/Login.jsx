import React, { useEffect, useState } from 'react';

const LOGIN_TITLE_LOGO_SRC = 'assets/logo.png';

const EyeOff = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);
const EyeOn = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const Logo = () => (
  <div className="login-logo">
    <img src="data:image/png;base64," alt="PROPASS" className="login-logo-img"
      onError={(e) => { e.target.style.display = 'none'; }} />
  </div>
);

function Login({ onLoginSuccess }) {
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [error,      setError]      = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [showPwd,    setShowPwd]    = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [step,         setStep]         = useState('login');
  const [resetUser,    setResetUser]    = useState('');
  const [resetMsg,     setResetMsg]     = useState('');
  const [resetIsOk,    setResetIsOk]    = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    try {
      document.body.classList.add('login-body');
      const saved = localStorage.getItem('propass_remember');
      if (saved) {
        const { u, p } = JSON.parse(saved);
        setUsername(u || ''); setPassword(p || ''); setRememberMe(true);
      }
      return () => document.body.classList.remove('login-body');
    } catch (_) { return () => {}; }
  }, []);

  const submit = async () => {
    setError(null); setLoading(true);
    try {
      const u = String(username || '').trim();
      const p = String(password || '');
      const res = await window.api.auth.login(u, p);
      if (res?.success && res.user) {
        if (rememberMe) localStorage.setItem('propass_remember', JSON.stringify({ u, p }));
        else            localStorage.removeItem('propass_remember');
        const payload = { ...(res.user || {}) };
        if (res.token) payload.token = String(res.token);
        onLoginSuccess && onLoginSuccess(payload);
        return;
      }
      setError(res?.error === 'OFFLINE' ? 'Connexion Internet requise' : 'Identifiants invalides');
    } catch (e) { setError(e?.message || 'Erreur login'); }
    finally     { setLoading(false); }
  };

  const sendReset = async (e) => {
    e.preventDefault();
    setResetMsg(''); setResetLoading(true);
    try {
      const usernameValue = String(resetUser || '').trim();
      if (!usernameValue) {
        setResetMsg('Veuillez saisir un nom d utilisateur.');
        setResetLoading(false);
        return;
      }
      const r = await window.api.auth.requestReset({ username: usernameValue });
      if (r?.success) { setResetIsOk(true); setResetMsg('Lien envoye ! Verifiez votre email.'); }
      else              setResetMsg('Utilisateur introuvable.');
    } catch (_) { setResetMsg('Erreur reseau.'); }
    finally     { setResetLoading(false); }
  };

  const backToLogin = () => { setStep('login'); setResetMsg(''); setResetUser(''); setResetIsOk(false); };

  /* ── ECRAN MOT DE PASSE OUBLIE ── */
  if (step === 'forgot') return (
    <div className="login-screen">
      <div className="lp-card">
        <Logo />
        <button className="lp-back" onClick={backToLogin}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          Retour
        </button>

        {!resetIsOk ? (
          <>
            <h2 className="lp-title">Mot de passe oublie ?</h2>
            <p className="lp-desc">Entrez votre nom d utilisateur. Vous recevrez un lien par email pour reinitialiser votre mot de passe.</p>
            <form onSubmit={sendReset}>
              <label className="lp-label">Nom d utilisateur</label>
              <input className="login-input" value={resetUser}
                onChange={e => setResetUser(e.target.value)}
                placeholder="Utilisateur" required autoFocus
                style={{marginBottom:'16px'}} />
              {resetMsg && <div className="lp-msg lp-msg-err">{resetMsg}</div>}
              <button className="login-button" type="submit" disabled={resetLoading}>
                {resetLoading ? 'Envoi...' : 'Envoyer le lien'}
              </button>
            </form>
          </>
        ) : (
          <div style={{textAlign:'center', padding:'10px 0'}}>
            <div className="lp-success-icon">✓</div>
            <h2 className="lp-title">Email envoye !</h2>
            <p className="lp-desc">Cliquez sur le lien dans votre email pour reinitialiser votre mot de passe.</p>
            <button className="login-button" onClick={backToLogin}>Retour a la connexion</button>
          </div>
        )}
      </div>
    </div>
  );

  /* ── ECRAN LOGIN PRINCIPAL ── */
  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Logo />
        <div className="login-title login-title-logo-wrap">
          <img
            src={LOGIN_TITLE_LOGO_SRC}
            alt="PROPASS"
            className="login-title-logo"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              if (e.currentTarget.parentElement) e.currentTarget.parentElement.textContent = 'PROPASS';
            }}
          />
        </div>
        <div className="login-subtitle">Badge Management System</div>
        <div className="login-section">Acces</div>

        <input className="login-input" value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Utilisateur" autoFocus />

        <div className="login-password-wrap">
          <input className="login-input"
            type={showPwd ? 'text' : 'password'}
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe" />
          <button type="button" className="login-eye-btn"
            onClick={() => setShowPwd(!showPwd)} tabIndex={-1}>
            {showPwd ? <EyeOff /> : <EyeOn />}
          </button>
        </div>

        <div className="login-remember">
          <input type="checkbox" id="rememberMe" checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)} />
          <label htmlFor="rememberMe">Se souvenir de moi</label>
        </div>

        <button className="login-button" type="submit" disabled={loading}>
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
        {error ? <div className="login-error">{error}</div> : null}

        <div className="login-forgot-wrap">
          <span className="login-forgot-link"
            onClick={() => { setStep('forgot'); setResetUser(username); }}>
            Mot de passe oublie ?
          </span>
        </div>
      </form>
    </div>
  );
}

export default Login;

