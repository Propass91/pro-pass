import React, { useEffect, useState } from 'react';

function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

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

  const forgot = async () => {
    try {
      const choice = window.prompt('1 = Envoyer email\n2 = Valider token', '1');
      if (!choice) return;
      if (String(choice).trim() === '2') {
        const token = window.prompt('Token reçu par email:');
        if (!token) return;
        const newPassword = window.prompt('Nouveau mot de passe:');
        if (!newPassword) return;
        const r = await window.api.auth.confirmReset(token, newPassword);
        if (r?.success) window.alert('Mot de passe mis à jour.');
        else window.alert('Token invalide ou expiré.');
        return;
      }
      const u = window.prompt('Utilisateur:', username || '');
      if (!u) return;
      const r = await window.api.auth.requestReset(u);
      if (r?.success) window.alert('Si le compte existe, un email a été envoyé.');
      else window.alert('Demande impossible.');
    } catch (_) {
      window.alert('Demande impossible.');
    }
  };

  return (
    <div className="login-screen">
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
          <span className="login-forgot-link" onClick={forgot}>
            Mot de passe oublié ?
          </span>
        </div>

        <button className="login-button" type="submit" disabled={loading}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        {error ? <div className="login-error">{error}</div> : null}
      </form>
    </div>
  );
}

export default Login;
