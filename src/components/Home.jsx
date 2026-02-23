import React, { useEffect, useState } from 'react';

function Donut({ used = 1, total = 15, size = 140, stroke = 14 }){
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, used / total));
  const dash = `${pct * circ} ${circ}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs />
      <g transform={`translate(${size/2},${size/2})`}>
        <circle r={radius} fill="none" stroke="#E6EEF8" strokeWidth={stroke} />
        <circle r={radius} fill="none" stroke="#2563EB" strokeWidth={stroke} strokeDasharray={dash} strokeLinecap="round" transform="rotate(-90)" />
        <text x="0" y="6" textAnchor="middle" fontSize="18" fontWeight="700" fill="#111827">{used} / {total}</text>
      </g>
    </svg>
  );
}

export default function Home(){
  const TOTAL = 15;
  const [used, setUsed] = useState(1);
  const [remaining, setRemaining] = useState(() => {
    const v = localStorage.getItem('remaining_syncs');
    return v !== null ? parseInt(v,10) : (TOTAL - 1);
  });

  useEffect(() => {
    async function loadDashboard(){
      try{
        let res = null;
        if(window.api && window.api.stats && typeof window.api.stats.getDashboard === 'function'){
          res = await window.api.stats.getDashboard();
        } else if(window.ppc && typeof window.ppc.invoke === 'function'){
          res = await window.ppc.invoke('stats:getDashboard');
        }
        if(res){
          // try several possible shapes
          const total = res.total || res.quota_total || res.quota || TOTAL;
          const usedVal = res.used || res.quota_used || (total - (res.remaining != null ? res.remaining : (TOTAL - 1)));
          const remainingVal = res.remaining != null ? res.remaining : (res.quota_remaining != null ? res.quota_remaining : (total - usedVal));
          setUsed(Number(usedVal));
          setRemaining(Number(remainingVal));
        }
      }catch(e){
        // ignore
      }
    }

    function onQuota(e){
      try{
        const r = (e && e.detail && e.detail.remaining) != null ? e.detail.remaining : parseInt(localStorage.getItem('remaining_syncs')|| (TOTAL-1),10);
        setRemaining(r);
      }catch(err){/* ignore */}
    }

    loadDashboard();
    window.addEventListener('quota-updated', onQuota);
    return () => window.removeEventListener('quota-updated', onQuota);
  }, []);

  async function refreshDashboard(){
    try{
      if(window.api && window.api.stats && typeof window.api.stats.getDashboard === 'function'){
        const res = await window.api.stats.getDashboard();
        if(res){
          const total = res.total || res.quota_total || res.quota || TOTAL;
          const usedVal = res.used || res.quota_used || (total - (res.remaining != null ? res.remaining : (TOTAL - 1)));
          const remainingVal = res.remaining != null ? res.remaining : (res.quota_remaining != null ? res.quota_remaining : (total - usedVal));
          setUsed(Number(usedVal));
          setRemaining(Number(remainingVal));
        }
      }
    }catch(e){ /* ignore */ }
  }

  return (
    <div className="flex-1 p-8 bg-gray-50 h-screen overflow-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bienvenue</h1>
          <p className="text-sm text-gray-500">Entreprise Démo</p>
        </div>
        <div className="bg-green-100 text-green-800 text-sm px-3 py-1 rounded-full">{remaining} restantes sur {TOTAL}</div>
      </div>

      <div className="mt-6 bg-white rounded-3xl border border-gray-50 shadow-sm p-6 flex gap-6 items-center">
        <div className="flex items-center justify-center">
          <Donut used={used} total={TOTAL} />
        </div>
        <div className="flex-1">
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex justify-between"><span>Copies utilisées :</span><span className="font-medium">{used}</span></li>
            <li className="flex justify-between"><span>Quota total :</span><span className="font-medium">{TOTAL}</span></li>
            <li className="flex justify-between"><span>Restantes :</span><span className="font-medium">{remaining}</span></li>
          </ul>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-50 flex items-center gap-3">
          <div className="bg-blue-50 text-blue-600 rounded-md p-2">📄</div>
          <div>
            <div className="text-sm font-medium">Copies ce mois</div>
            <div className="text-xs text-gray-500">{used}</div>
          </div>
        </div>
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-50 flex items-center gap-3">
          <div className="bg-blue-50 text-blue-600 rounded-md p-2">📚</div>
          <div>
            <div className="text-sm font-medium">Total copies</div>
            <div className="text-xs text-gray-500">{used}</div>
          </div>
        </div>
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-50 flex items-center gap-3">
          <div className="bg-blue-50 text-blue-600 rounded-md p-2">🔒</div>
          <div>
            <div className="text-sm font-medium">Limite mensuelle</div>
            <div className="text-xs text-gray-500">{quota}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
