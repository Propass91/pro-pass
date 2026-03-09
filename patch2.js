const fs = require('fs');

// Clients.jsx - bouton Supprimer
const cFile = 'C:\\Users\\Wack\\Desktop\\pro-pass\\ui_src\\pages\\Clients.jsx';
let c = fs.readFileSync(cFile, 'utf8');

const anchor = '{active ? <Lock size={18} /> : <Unlock size={18} />}\n                      </button>\n                    </div>';
const replacement = '{active ? <Lock size={18} /> : <Unlock size={18} />}\n                      </button>\n                      <button className="icon-btn danger" title="Supprimer ce client" onClick={() => deleteClient(r.id, r.company_name || r.username)}>\n                        <Trash2 size={18} />\n                      </button>\n                    </div>';

if (!c.includes('Supprimer ce client')) {
  if (c.includes('{active ? <Lock size={18} /> : <Unlock size={18} />}')) {
    c = c.replace(anchor, replacement);
    console.log('Bouton Supprimer ajoute');
  } else { console.log('ATTENTION: ancre Lock introuvable'); }
} else { console.log('Bouton deja present'); }

fs.writeFileSync(cFile, c, 'utf8');

// handlers.js - handler admin:deleteClient
const hFile = 'C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\ipc\\handlers.js';
let h = fs.readFileSync(hFile, 'utf8');
if (!h.includes('admin:deleteClient')) {
  const anchor2 = "ipcMain.handle('dashboard:getStats'";
  const newHandler = "ipcMain.handle('admin:deleteClient', async (_event, id) => {\n    if (!(authSessionUser && authSessionUser.role === 'admin')) return { success: false, error: 'admin_required' };\n    try {\n      const result = await cloud.adminDeleteClient(id);\n      return { success: true, ...result };\n    } catch (e) { return { success: false, error: String(e && e.message || e) }; }\n  });\n\n  " + anchor2;
  h = h.replace(anchor2, newHandler);
  fs.writeFileSync(hFile, h, 'utf8');
  console.log('handlers.js: admin:deleteClient ajoute');
} else { console.log('handlers.js deja OK'); }

console.log('Termine');
