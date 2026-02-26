import React, { useEffect, useState } from 'react';

export default function CopyBadge(){
  const TOTAL = 15;
  const KEY = 'remaining_syncs';
  const [remaining, setRemaining] = useState(() => {
    const v = localStorage.getItem(KEY);
    return v !== null ? parseInt(v,10) : (TOTAL - 1);
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // ensure key exists
    if(localStorage.getItem(KEY) == null) localStorage.setItem(KEY, String(remaining));
  }, []);

  async function handleSecuritySync(){
    if(loading) return;
    setLoading(true);
    try{
      let res = null;
      // preferred APIs from preload: window.api.nfc.readDump / writeDumpMagic
      if(window.api && window.api.nfc && typeof window.api.nfc.writeDumpMagic === 'function'){
        // try to obtain a dump first if available
        let dump = null;
        try{
          if(typeof window.api.nfc.readDump === 'function'){
            dump = await window.api.nfc.readDump();
          } else if(window.ppc && typeof window.ppc.invoke === 'function'){
            dump = await window.ppc.invoke('nfc:readDump');
          }
        }catch(e){ /* continue without dump */ }

        // call writeDumpMagic with dump when available
        if(dump) res = await window.api.nfc.writeDumpMagic(dump);
        else res = await window.api.nfc.writeDumpMagic();
      } else if(window.ppc && window.ppc.nfcWriteGen2){
        res = await window.ppc.nfcWriteGen2();
      } else if(window.ppc && typeof window.ppc.invoke === 'function'){
        res = await window.ppc.invoke('nfc:writeDumpMagic');
      } else {
        throw new Error('IPC not available');
      }

      // If the write call returned an updated remaining quota, use it immediately
      if(res && res.success && (res.remaining != null)){
        const newRemaining = Number(res.remaining);
        localStorage.setItem(KEY, String(newRemaining));
        setRemaining(newRemaining);
        window.dispatchEvent(new CustomEvent('quota-updated', { detail: { remaining: newRemaining } }));
      } else {
        // otherwise try to refresh server-side dashboard if available
        try{
          if(window.api && window.api.stats && typeof window.api.stats.getDashboard === 'function'){
            const dash = await window.api.stats.getDashboard();
            const newRemaining = dash && (dash.remaining ?? dash.quota_remaining ?? (TOTAL - (dash.used ?? 0)));
            if(newRemaining != null){
              localStorage.setItem(KEY, String(newRemaining));
              setRemaining(Number(newRemaining));
              window.dispatchEvent(new CustomEvent('quota-updated', { detail: { remaining: Number(newRemaining) } }));
            }
          }
        }catch(e){ /* ignore refresh errors */ }

        // fallback local decrement if server-side not available and no res.remaining
        if(!(res && res.success && (res.remaining != null))){
          let n = parseInt(localStorage.getItem(KEY) || String(TOTAL-1),10);
          n = Math.max(0, n - 1);
          localStorage.setItem(KEY, String(n));
          setRemaining(n);
          window.dispatchEvent(new CustomEvent('quota-updated', { detail: { remaining: n } }));
        }
      }
    } catch(err){
      console.error('Sync failed', err);
      alert('Erreur lors du transfert : ' + (err && err.message ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 p-8 bg-gray-50 h-screen overflow-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Copier un badge</h1>
      </div>

      <div className="bg-blue-600 text-white rounded-3xl border border-gray-50 shadow-sm p-4 flex items-center justify-between">
        <div>
          <div className="text-sm">Votre quota</div>
        </div>
        <div className="text-4xl font-extrabold">{remaining}</div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="p-4 rounded-3xl bg-orange-50 border-l-4 border-orange-400 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-orange-400 text-white flex items-center justify-center font-bold">1</div>
          <div>
            <div className="font-medium">Branchez votre lecteur</div>
            <div className="text-xs text-gray-500">Connectez le lecteur ACR122U en USB</div>
          </div>
        </div>

        <div className="p-4 rounded-3xl bg-gray-100 flex items-center gap-4 border border-gray-50 shadow-sm">
          <div className="w-10 h-10 rounded-full bg-gray-300 text-gray-700 flex items-center justify-center font-bold">2</div>
          <div>
            <div className="font-medium">Posez votre badge</div>
            <div className="text-xs text-gray-500">Placez le badge vierge sur le lecteur</div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center justify-center">
        <div className="text-7xl">🔖</div>
        <div className="text-gray-500 mt-4">Placez le badge vierge sur le lecteur</div>
        <div className="mt-6 w-full max-w-xs">
          <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-200 rounded-3xl bg-white shadow-inner">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Prêt pour la synchronisation</h2>
            <p className="text-gray-500 text-sm mb-8 text-center max-w-xs">Le support cible est identifié. Cliquez pour lancer le transfert des paramètres de sécurité.</p>

            <button onClick={handleSecuritySync} disabled={loading || remaining<=0} className={`px-10 py-4 ${loading ? 'bg-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'} text-white font-bold rounded-2xl shadow-lg shadow-blue-200 transition-all active:scale-95 transform`}>
              {loading ? 'Transfert en cours...' : 'LANCER LA SYNCHRONISATION'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
