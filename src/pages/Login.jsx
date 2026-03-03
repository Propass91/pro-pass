import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('propass_remember');
    if (saved) {
      try {
        const { u, p } = JSON.parse(saved);
        setUsername(u || '');
        setPassword(p || '');
        setRememberMe(true);
      } catch (_) {}
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await window.api.auth.login(username, password);
      if (!result?.success) {
        setError(result?.error || 'Identifiants invalides');
        return;
      }
      if (rememberMe) {
        localStorage.setItem('propass_remember', JSON.stringify({ u: username, p: password }));
      } else {
        localStorage.removeItem('propass_remember');
      }
      navigate('/home');
    } catch (e) {
      setError('Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">

        <img
          src={logo}
          alt="PROPASS"
          style={{ height: '80px', display: 'block', margin: '0 auto 12px' }}
        />

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Acces</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="client1"
              required
            />
          </div>

          <div className="form-group">
            <label>Mot de passe</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                required
                style={{ width: '100%', paddingRight: '40px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: '10px', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '0',
                  color: '#888', fontSize: '18px', lineHeight: '1',
                  display: 'flex', alignItems: 'center'
                }}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 16px' }}>
            <input
              type="checkbox"
              id="rememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#6c2bd9' }}
            />
            <label htmlFor="rememberMe"
              style={{ margin: '0', fontSize: '13px', color: '#888', cursor: 'pointer', fontWeight: 'normal' }}>
              Se souvenir de moi
            </label>
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>

          {error && <div className="error">{error}</div>}
        </form>

        <p style={{ textAlign: 'center', fontSize: '12px', color: '#555', marginTop: '12px' }}>
          <a href="#" style={{ color: '#6c2bd9' }}>Mot de passe oublié ?</a>
        </p>
      </div>
    </div>
  );
}

export default Login;
