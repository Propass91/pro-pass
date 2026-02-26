import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, CreditCard, LogOut } from 'lucide-react';

function Sidebar({ user, onLogout, readerConnected }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="logo">PPC</h1>
      </div>

      <div className="user-info">
        <div className="user-name">{user?.username || 'client1'}</div>
        <div className="user-role">{user?.role === 'client' ? 'Client' : 'Admin'}</div>
        <div className="user-email">{user?.email || 'client@rfid.local'}</div>
      </div>

      <div className={`reader-status ${readerConnected ? 'connected' : ''}`}>
        <div className="status-indicator">
          <span className="status-dot"></span>
          <span className="status-text">
            {readerConnected ? 'Lecteur connecté' : 'Lecteur déconnecté'}
          </span>
        </div>
        <div className="reader-model">ACR122U</div>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <LayoutGrid size={18} />
          <span>Accueil</span>
        </NavLink>
        <NavLink to="/copy" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <CreditCard size={18} />
          <span>Copier un badge</span>
        </NavLink>
      </nav>

      <button className="logout-btn" onClick={onLogout}>
        <LogOut size={18} />
        <span>Déconnexion</span>
      </button>
    </aside>
  );
}

export default Sidebar;
