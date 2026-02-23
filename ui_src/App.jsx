import React, { useEffect, useState } from 'react';
import Login from './pages/Login';
import MainLayout from './MainLayout';

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Restore validated cloud session first (token + user)
        try {
          const raw = localStorage.getItem('ppc_session_v1');
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed && parsed.token && parsed.user) {
            const r = await window.api.auth.restoreSession({ token: parsed.token, user: parsed.user });
            if (r?.success && r.user) {
              setUser(r.user);
              try {
                const role = String(r.user && r.user.role || '');
                if (role === 'admin') window.location.hash = '/admin';
              } catch (_) {}
              return;
            }
            localStorage.removeItem('ppc_session_v1');
          }
        } catch (_) {
          try { localStorage.removeItem('ppc_session_v1'); } catch (_e2) {}
        }

        // Legacy cleanup: user-only restore breaks cloud session (keeps UI stuck on Session admin)
        try {
          localStorage.removeItem('user');
          localStorage.removeItem('ppc_user');
        } catch (_) {}

        const currentUser = await window.api.auth.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          try {
            const role = String(currentUser && currentUser.role || '');
            if (role === 'admin') window.location.hash = '/admin';
          } catch (_) {}
        }
      } catch (_) {}
    })();
  }, []);

  const onLogout = async () => {
    try { await window.api.auth.logout(); } catch (_) {}
    try {
      localStorage.removeItem('user');
      localStorage.removeItem('ppc_user');
      localStorage.removeItem('ppc_session_v1');
    } catch (_) {}
    setUser(null);
  };

  if (!user) {
    return (
      <Login
        onLoginSuccess={(userData) => {
          try {
            console.log('Tentative de connexion OK pour:', userData && (userData.username || userData.clientUsername || '')); 
          } catch (_) {}
          setUser(userData);
          try {
            const token = userData && userData.token;
            const cleanUser = { ...(userData || {}) };
            delete cleanUser.token;
            if (token) {
              localStorage.setItem('ppc_session_v1', JSON.stringify({ token, user: cleanUser }));
            }
          } catch (_) {}

          // Redirect right after login
          try {
            const role = String((userData && userData.role) || '');
            window.location.hash = role === 'admin' ? '/admin' : '/copy';
          } catch (_) {}
        }}
      />
    );
  }

  return <MainLayout user={user} onLogout={onLogout} />;
}

export default App;
