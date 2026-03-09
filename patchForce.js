const fs = require('fs');
const file = 'C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\cloud\\cloudClient.js';
let c = fs.readFileSync(file, 'utf8');

// Supprimer TOUTE occurrence de adminDeleteClient (dedans ou dehors la classe)
c = c.replace(/\r?\n\s*async adminDeleteClient[\s\S]*?\r?\n  \}\r?\n/g, '\r\n');

// Verifier que c'est bien supprime
if (c.includes('adminDeleteClient')) {
  console.log('ERREUR: suppression incomplete');
  process.exit(1);
}

// Regex tolerante CRLF/LF pour inserer dans la classe
const regex = /(    if \(!r \|\| !r\.ok\) throw new Error\('admin_logs_failed'\);\r?\n    return r;\r?\n  \}\r?\n)(\})/;

if (!regex.test(c)) {
  console.log('ERREUR: ancre adminGetLogs non trouvee');
  console.log(JSON.stringify(c.slice(-400)));
  process.exit(1);
}

const method = '\r\n  async adminDeleteClient(id) {\r\n    const headers = this._adminHeaders();\r\n    if (!headers) throw new Error(\'admin_auth_missing\');\r\n    return fetchJson(this.baseUrl + \'/admin/clients/\' + id, { method: \'DELETE\', headers });\r\n  }\r\n';

c = c.replace(regex, '$1' + method + '$2');
fs.writeFileSync(file, c, 'utf8');
console.log('adminDeleteClient insere dans la classe OK');
