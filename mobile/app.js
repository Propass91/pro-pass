(() => {
  const storageTokenKey = 'pp_mobile_token';
  const storageUserKey = 'pp_mobile_user';
  const storageApiKey = 'pp_mobile_api_base';

  const onlineBadge = document.getElementById('onlineBadge');
  const loginCard = document.getElementById('loginCard');
  const dashboard = document.getElementById('dashboard');
  const nfcCard = document.getElementById('nfcCard');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginButton = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const logoutButton = document.getElementById('logoutBtn');
  const copyButton = document.getElementById('copyBtn');
  const detectButton = document.getElementById('detectBtn');
  const remainingEl = document.getElementById('remaining');
  const totalEl = document.getElementById('total');
  const usedEl = document.getElementById('used');
  const copyStatus = document.getElementById('copyStatus');
  const nfcDetect = document.getElementById('nfcDetect');

  let nfcReader = null;
  let nfcReady = false;
  let copyInProgress = false;
  let lastBadgeDetectedAt = 0;
  let authReady = false;

  function canCopyNow() {
    if (!authReady) return false;
    if (!nfcReady) return false;
    if (copyInProgress) return false;
    return (Date.now() - Number(lastBadgeDetectedAt || 0)) < 20000;
  }

  function updateCopyButtonState() {
    if (!copyButton) return;
    copyButton.disabled = !canCopyNow();
  }

  function getApiBase() {
    const saved = String(localStorage.getItem(storageApiKey) || '').trim();
    if (saved) return saved.replace(/\/+$/, '');
    if (location.protocol.startsWith('http')) return location.origin.replace(/\/+$/, '');
    return 'https://www.pro-pass.app';
  }

  async function apiFetch(path, options = {}) {
    const token = localStorage.getItem(storageTokenKey);
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${getApiBase()}${path}`, { ...options, headers });
    return response;
  }

  async function fetchJsonWithFallback(paths, options = {}) {
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await apiFetch(path, options);
        const raw = await res.text();
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (_) {
          data = null;
        }

        const looksHtml = /^\s*</.test(String(raw || ''));
        if (!data && looksHtml) {
          lastError = new Error(`Réponse HTML inattendue sur ${path}`);
          continue;
        }

        return { res, data };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('api_unavailable');
  }

  function setOnlineBadge(isOnline) {
    onlineBadge.textContent = isOnline ? 'Online' : 'Offline';
    onlineBadge.classList.toggle('ok', !!isOnline);
  }

  function redirectAdminToWebApp() {
    const base = getApiBase();
    const target = `${base}/app`;
    try {
      window.location.href = target;
    } catch (_) {
      if (loginError) loginError.textContent = `Compte admin detecte. Ouvrez: ${target}`;
    }
  }

  async function refreshQuota() {
    try {
      const { res, data } = await fetchJsonWithFallback(['/client/quota', '/api/client/quota']);
      if (res.status === 401) {
        doLogout(false);
        if (copyStatus) copyStatus.textContent = 'Session expirée, reconnectez-vous';
        return;
      }
      if (!res.ok) throw new Error('quota_unavailable');
      const quota = data && data.quota ? data.quota : null;
      if (!quota) throw new Error('quota_missing');
      const remaining = Number(quota.remaining || 0);
      const total = Number(quota.monthly_limit || 0);
      const used = Math.max(0, total - remaining);
      remainingEl.textContent = String(remaining);
      totalEl.textContent = String(total);
      usedEl.textContent = String(used);
      setOnlineBadge(true);
      if (copyStatus) copyStatus.textContent = '';
    } catch (_) {
      setOnlineBadge(false);
      if (copyStatus) copyStatus.textContent = 'Erreur de synchronisation quota';
    }
  }

  async function detectBadge() {
    if (!nfcDetect) return;
    if (!('NDEFReader' in window)) {
      nfcReady = false;
      nfcDetect.textContent = 'Détection badge: NFC non disponible sur ce navigateur/téléphone.';
      updateCopyButtonState();
      return;
    }

    try {
      if (!nfcReader) nfcReader = new NDEFReader();
      nfcDetect.textContent = 'Détection badge: en attente...';
      await nfcReader.scan();
      nfcReader.onreading = (event) => {
        lastBadgeDetectedAt = Date.now();
        const serial = String((event && event.serialNumber) || '').trim();
        nfcReady = true;
        nfcDetect.textContent = serial
          ? `Détection badge: OK (${serial})`
          : 'Détection badge: OK';
        if (copyStatus) copyStatus.textContent = 'Badge détecté, vous pouvez copier';
        updateCopyButtonState();
      };
      nfcReader.onreadingerror = () => {
        nfcReady = false;
        nfcDetect.textContent = 'Détection badge: erreur de lecture, repositionnez le badge';
        updateCopyButtonState();
      };
    } catch (_) {
      nfcReady = false;
      nfcDetect.textContent = 'Détection badge: autorisation NFC refusée';
      updateCopyButtonState();
    }
  }

  async function doCopy() {
    if (!copyButton) return;
    if (!canCopyNow()) {
      if (copyStatus) copyStatus.textContent = 'Posez puis détectez un badge avant de copier';
      updateCopyButtonState();
      return;
    }
    copyInProgress = true;
    updateCopyButtonState();
    if (copyStatus) copyStatus.textContent = 'Copie en cours...';

    try {
      if (!nfcReader || !('NDEFReader' in window)) {
        throw new Error('NFC_UNAVAILABLE');
      }

      const payload = `PROPASS|COPY|${Date.now()}`;
      await nfcReader.write({ records: [{ recordType: 'text', data: payload }] });

      const { res, data } = await fetchJsonWithFallback(['/client/quota/decrement', '/api/client/quota/decrement'], {
        method: 'POST',
        body: '{}'
      });

      if (!res.ok || !data || !data.ok) throw new Error('QUOTA_DECREMENT_FAILED');

      if (copyStatus) copyStatus.textContent = 'Copie validée — retirez votre badge';
      await refreshQuota();
      nfcReady = false;
      if (nfcDetect) nfcDetect.textContent = 'Détection badge: appuyez sur DÉTECTER BADGE';
    } catch (e) {
      const code = String((e && e.message) || e || 'WRITE_FAILED');
      if (copyStatus) {
        if (/NFC_UNAVAILABLE|NotSupportedError/i.test(code)) {
          copyStatus.textContent = 'Copie refusée: écriture NFC non supportée sur ce téléphone';
        } else if (/NotAllowedError|SecurityError/i.test(code)) {
          copyStatus.textContent = 'Copie refusée: autorisation NFC requise';
        } else {
          copyStatus.textContent = 'Copie non validée: écriture NFC impossible sur ce badge';
        }
      }
      nfcReady = false;
      if (nfcDetect) nfcDetect.textContent = 'Détection badge: relancez DÉTECTER BADGE';
    } finally {
      copyInProgress = false;
      updateCopyButtonState();
    }
  }

  function showLoggedIn() {
    loginCard.classList.add('hidden');
    dashboard.classList.remove('hidden');
    nfcCard.classList.remove('hidden');
    authReady = true;
    updateCopyButtonState();
  }

  function showLoggedOut() {
    loginCard.classList.remove('hidden');
    dashboard.classList.add('hidden');
    nfcCard.classList.add('hidden');
    authReady = false;
    nfcReady = false;
    lastBadgeDetectedAt = 0;
    updateCopyButtonState();
  }

  async function doLogin() {
    loginError.textContent = '';
    loginButton.disabled = true;
    try {
      localStorage.removeItem(storageTokenKey);
      const username = String(usernameInput.value || '').trim();
      const password = String(passwordInput.value || '');
      const { res, data: payload } = await fetchJsonWithFallback(['/auth/login', '/api/auth/login'], {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (!res.ok || !payload || !payload.ok || !payload.token) {
        throw new Error('Identifiants invalides');
      }
      const role = String((payload && payload.role) || '').toLowerCase();
      const userPayload = payload && (payload.client || payload.user || { username });
      const userData = { ...userPayload, role: role || String(userPayload && userPayload.role || '') };
      localStorage.setItem(storageTokenKey, payload.token);
      localStorage.setItem(storageUserKey, JSON.stringify(userData));

      if (role === 'admin') {
        if (loginError) loginError.textContent = 'Compte admin detecte: ouverture de l\'interface admin...';
        redirectAdminToWebApp();
        return;
      }

      showLoggedIn();
      await refreshQuota();
      if (nfcDetect) nfcDetect.textContent = 'Détection badge: appuyez sur DÉTECTER BADGE';
    } catch (error) {
      loginError.textContent = error && error.message ? error.message : 'Connexion impossible';
      setOnlineBadge(false);
    } finally {
      loginButton.disabled = false;
    }
  }

  function doLogout(clearStatus = true) {
    localStorage.removeItem(storageTokenKey);
    localStorage.removeItem(storageUserKey);
    showLoggedOut();
    if (clearStatus && copyStatus) copyStatus.textContent = '';
  }

  function initNfcHint() {
    if (!nfcDetect) return;
    const hasWebNfc = typeof window !== 'undefined' && 'NDEFReader' in window;
    if (hasWebNfc) {
      nfcDetect.textContent = 'Détection badge: NFC disponible. Appuyez sur DÉTECTER BADGE.';
      return;
    }
    nfcDetect.textContent = 'Détection badge: NFC non disponible ici (copie bloquée pour sécurité).';
  }

  loginButton.addEventListener('click', doLogin);
  if (copyButton) copyButton.addEventListener('click', doCopy);
  if (detectButton) detectButton.addEventListener('click', detectBadge);
  logoutButton.addEventListener('click', doLogout);

  if (localStorage.getItem(storageTokenKey)) {
    let savedUser = null;
    try { savedUser = JSON.parse(localStorage.getItem(storageUserKey) || 'null'); } catch (_) { savedUser = null; }
    const savedRole = String(savedUser && savedUser.role || '').toLowerCase();
    if (savedRole === 'admin') {
      redirectAdminToWebApp();
    } else {
      showLoggedIn();
      refreshQuota();
    }
  } else {
    showLoggedOut();
    setOnlineBadge(navigator.onLine);
  }

  window.addEventListener('online', () => setOnlineBadge(true));
  window.addEventListener('offline', () => setOnlineBadge(false));

  initNfcHint();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if (window.caches && typeof window.caches.keys === 'function') {
      window.caches.keys()
        .then((keys) => Promise.all(keys.map((k) => window.caches.delete(k))))
        .catch(() => {});
    }
  }
})();
