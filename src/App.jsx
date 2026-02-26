import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import CopyBadge from './pages/CopyBadge';

function App() {
  const [user, setUser] = useState({ username: 'client1', role: 'client', email: 'client@rfid.local' });
  const [readerConnected, setReaderConnected] = useState(false);

  useEffect(() => {
    checkAuth();
    checkNFC();
  }, []);

  const checkAuth = async () => {
    try {
      const currentUser = await window.api.auth.getCurrentUser();
      if (currentUser) setUser(currentUser);
    } catch (e) {}
  };

  const checkNFC = async () => {
    try {
      const connected = await window.api.nfc.isConnected();
      setReaderConnected(connected);
    } catch (e) {}
  };

  const handleLogout = async () => {
    await window.api.auth.logout();
    window.location.reload();
  };

  return (
    <div className="app">
      <Sidebar user={user} onLogout={handleLogout} readerConnected={readerConnected} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/copy" element={<CopyBadge user={user} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
