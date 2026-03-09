const fs = require('fs');
const file = 'C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\cloud\\cloudClient.js';
let c = fs.readFileSync(file, 'utf8');

// Etape 1 : supprimer le bloc mal place hors de la classe
c = c.replace(/\}\s*\n+\s*async adminDeleteClient[\s\S]*?\}\s*\nmodule\.exports/, '}\nmodule.exports');

// Etape 2 : inserer la methode DANS la classe, avant le } final de adminGetLogs
const anchor = "    if (!r || !r.ok) throw new Error('admin_logs_failed');\n    return r;\n  }\n}";
if (!c.includes(anchor)) {
  console.log('ERREUR: ancre adminGetLogs non trouvee');
  console.log(JSON.stringify(c.slice(-400)));
  process.exit(1);
}

const method = `    if (!r || !r.ok) throw new Error('admin_logs_failed');
    return r;
  }

  async adminDeleteClient(id) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    return fetchJson(this.baseUrl + '/admin/clients/' + id, { method: 'DELETE', headers });
  }
}`;

c = c.replace(anchor, method);
fs.writeFileSync(file, c, 'utf8');
console.log('adminDeleteClient insere dans la classe OK');
