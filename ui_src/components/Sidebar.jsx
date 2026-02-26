import React from 'react';
import { Building2, Database, Users, Clock, ChevronRight } from 'lucide-react';

function Sidebar({ user, activePage, onNavigate, onLogout }) {
  const isAdmin = user?.role === 'admin';
  const menuItems = isAdmin
    ? [
        { id: 'unites', label: 'Tableau de bord', icon: Building2 },
        { id: 'dump', label: 'Copier Dump', icon: Database },
        { id: 'clients', label: 'Clients', icon: Users },
        { id: 'history', label: 'Logs', icon: Clock }
      ]
    : [
        { id: 'copy', label: 'Copie', icon: Database }
      ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="badge-admin">{isAdmin ? 'ADMIN' : (String(user?.role || '').toUpperCase() || 'USER')}</span>
        <div className="user-name">{isAdmin ? (user?.username || 'admin') : (user?.username || 'utilisateur')}</div>
        <div className="user-status">● En ligne</div>
      </div>

      <nav className="sidebar-nav">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <div
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={18} />
              <span className="nav-label">{item.label}</span>
              <ChevronRight size={16} className="nav-arrow" />
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
