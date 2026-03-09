const fs = require('fs');
const file = 'C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\cloud\\cloudClient.js';
let c = fs.readFileSync(file, 'utf8');

if (c.includes('adminDeleteClient')) {
  console.log('Deja present - rien a faire');
  process.exit(0);
}

// Regex tolerante CRLF/LF
const regex = /(    if \(!r \|\| !r\.ok\) throw new Error\('admin_logs_failed'\);\r?\n    return r;\r?\n  \}\r?\n)(\})/;

if (!regex.test(c)) {
  console.log('ERREUR: pattern non trouve');
  console.log(JSON.stringify(c.slice(-400)));
  process.exit(1);
}

const method = [
  '',
  '  async adminDeleteClient(id) {',
  "    const headers = this._adminHeaders();",
  "    if (!headers) throw new Error('admin_auth_missing');",
  "    return fetchJson(this.baseUrl + '/admin/clients/' + id, { method: 'DELETE', headers });",
  '  }',
  ''
].join('\r\n');

c = c.replace(regex, '$1' + method + '$2');
fs.writeFileSync(file, c, 'utf8');
console.log('adminDeleteClient insere dans la classe OK');
