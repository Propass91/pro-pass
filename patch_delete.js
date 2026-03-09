const fs = require('fs');

// --- 1. Clients.jsx ---
const cFile = 'C:\\Users\\Wack\\Desktop\\pro-pass\\ui_src\\pages\\Clients.jsx';
let c = fs.readFileSync(cFile, 'utf8');

if (!c.includes('Trash2')) {
  c = c.replace(
    "import { Mail, Pencil, Lock, Unlock, Plus } from 'lucide-react';",
    "import { Mail, Pencil, Lock, Unlock, Plus, Trash2 } from 'lucide-react';"
  );
  console.log('Import Trash2 ajoute');
}

if (!c.includes('deleteClient')) {
  const fn = `\n  const deleteClient = async (id, name) => {\n    if (!window.confirm('Supprimer ce client ? Action irreversible.')) return;\n    try {\n      const r = await window.api.admin.deleteClient(id);\n      if (r?.success) { await load(); }\n      else { window.alert('Erreur : ' + (r?.error || 'Suppression impossible')); }\n    } catch (_) { window.alert('Erreur lors de la suppression.'); }\n  };\n\n`;
  c = c.replace('  return (', fn + '  return (');
  console.log('Fonction deleteClient ajoutee');
}

const lockBtn = `                      <button
                        className={active ? 'icon-btn danger' : 'icon-btn'}
                        title={active ? 'Bloquer' : 'Débloquer'}
                        onClick={() => toggleStatus(r.id)}
                      >
                        {active ? <Lock size={18} /> : <Unlock size={18} />}
                      </button>`;

if (!c.includes('Supprimer ce client') && c.includes(lockBtn)) {
  c = c.replace(lockBtn, lockBtn + `\n                      <button className="icon-btn danger" title="Supprimer ce client" onClick={() => deleteClient(r.id, r.company_name || r.username)}>\n                        <Trash2 size={18} />\n                      </button>`);
  console.log('Bouton Supprimer ajoute');
} else if (!c.includes(lockBtn)) {
  console.log('ATTENTION: ancre bouton Lock non trouvee');
}

fs.writeFileSync(cFile, c, 'utf8');
console.log('Clients.jsx OK');

// --- 2. preload.js ---
const pFile = 'C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\preload.js';
let p = fs.readFileSync(pFile, 'utf8');
if (!p.includes('admin:deleteClient')) {
  p = p.replace(
    "getAdminLogs: (t) => ipcRenderer.invoke('admin:getAdminLogs', t),",
    "getAdminLogs: (t) => ipcRenderer.invoke('admin:getAdminLogs', t),\n    deleteClient: (id) => ipcRenderer.invoke('admin:deleteClient', id),"
  );
  fs.writeFileSync(pFile, p, 'utf8');
  console.log('preload.js OK (deleteClient ajoute)');
} else {
  console.log('preload.js deja OK');
}

// --- 3. Verif handlers.js ---
const h = fs.readFileSync('C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\ipc\\handlers.js', 'utf8');
console.log('handlers.js admin:deleteClient:', h.includes("'admin:deleteClient'") ? 'OK' : 'MANQUANT');
