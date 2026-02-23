import React, { useState, useEffect } from 'react';
import { Edit3, CreditCard, Loader } from 'lucide-react';

function CopyBadge({ user }) {
  const [step, setStep] = useState(1);
  const [readerConnected, setReaderConnected] = useState(false);
  const [cardPresent, setCardPresent] = useState(false);
  const [cardUID, setCardUID] = useState(null);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState(null);
  const [quota, setQuota] = useState({ remaining: 14, total: 15 });

  useEffect(() => {
    initNFC();
    loadQuota();
    
    const unsubscribePresent = window.api.nfc.onCardPresent((uid) => {
      setCardPresent(true);
      setCardUID(uid);
      if (readerConnected) setStep(2);
    });
    
    const unsubscribeRemoved = window.api.nfc.onCardRemoved(() => {
      setCardPresent(false);
      setCardUID(null);
      setStep(1);
    });

    return () => {
      unsubscribePresent();
      unsubscribeRemoved();
    };
  }, [readerConnected]);

  const initNFC = async () => {
    try {
      const res = await window.api.nfc.init();
      if (res.success) {
        setReaderConnected(true);
      }
    } catch (e) {
      console.error('NFC init failed', e);
    }
  };

  const loadQuota = async () => {
    const q = await window.api.dumps.getQuota();
    setQuota({
      remaining: q.remaining || 14,
      total: q.monthly_limit || 15
    });
  };

  const handleCopy = async () => {
    if (!cardPresent) return;
    
    setCopying(true);
    setResult(null);

    try {
      const activeDump = await window.api.dumps.getActiveDump();
      
      if (!activeDump) {
        setResult({ success: false, message: 'Aucun dump source configuré' });
        setCopying(false);
        return;
      }

      const writeRes = await window.api.nfc.writeDump(activeDump.data);
      
      if (writeRes.success) {
        await window.api.dumps.writeAdminDump(user.id);
        
        setResult({ 
          success: true, 
          message: `Badge copié! UID: ${writeRes.uidCloned || cardUID}`,
          uid: writeRes.uidCloned
        });
        
        loadQuota();
      } else {
        setResult({ success: false, message: writeRes.message || 'Échec écriture' });
      }
      
    } catch (e) {
      setResult({ success: false, message: `Erreur: ${e.message}` });
    }
    
    setCopying(false);
  };

  return (
    <div className="page copy-page">
      <h1>Copier un badge</h1>

      <div className="quota-bar">
        <div className="quota-info">
          <span className="quota-label">Votre quota</span>
          <span className="quota-desc">{quota.remaining} copies restantes ce mois-ci (sur {quota.total})</span>
        </div>
        <span className="quota-big">{quota.remaining}</span>
      </div>

      <div className="steps">
        <div className={`step ${step >= 1 ? 'active' : ''} ${readerConnected ? 'completed' : ''}`}>
          <div className="step-number">1</div>
          <div className="step-content">
            <div className="step-icon"><Edit3 size={20} /></div>
            <h3>Branchez votre lecteur</h3>
            <p>Connectez le lecteur ACR122U en USB</p>
            <span className="step-status">
              {readerConnected ? '✓ Connecté' : 'En attente...'}
            </span>
          </div>
        </div>

        <div className={`step ${step >= 2 ? 'active' : ''} ${cardPresent ? 'completed' : ''}`}>
          <div className="step-number">2</div>
          <div className="step-content">
            <div className="step-icon"><CreditCard size={20} /></div>
            <h3>Posez votre badge</h3>
            <p>{cardPresent ? `UID: ${cardUID}` : 'Branchez d\'abord le lecteur'}</p>
            <span className="step-status">
              {cardPresent ? '✓ Détecté' : 'Verrouillé'}
            </span>
          </div>
        </div>
      </div>

      <div className="action-zone">
        <div className="card-icon">
          <CreditCard size={48} />
        </div>
        <p className="action-text">
          {cardPresent 
            ? 'Badge prêt pour la copie' 
            : 'Placez le badge vierge sur le lecteur'}
        </p>
        
        <button 
          className="btn-copy"
          onClick={handleCopy}
          disabled={!cardPresent || copying || quota.remaining <= 0}
        >
          {copying ? (
            <>
              <Loader className="spin" size={18} />
              Copie en cours...
            </>
          ) : (
            'Copier sur le badge'
          )}
        </button>

        {quota.remaining <= 0 && (
          <p className="error-msg">Quota mensuel atteint</p>
        )}
      </div>

      {result && (
        <div className={`result ${result.success ? 'success' : 'error'}`}>
          {result.success ? '✓' : '✗'} {result.message}
        </div>
      )}
    </div>
  );
}

export default CopyBadge;
