const fs = require('fs');
const f = 'C:\\Users\\Wack\\Desktop\\pro-pass\\electron\\cloud\\cloudClient.js';
let c = fs.readFileSync(f, 'utf8');
if (c.includes('adminDeleteClient')) { console.log('deja OK'); process.exit(0); }
const anchor = 'module.exports';
if (!c.includes(anchor)) { console.log('module.exports non trouve'); process.exit(1); }
const method = `\n  async adminDeleteClient(id) {\n    const headers = this._adminHeaders();\n    if (!headers) throw new Error('admin_auth_missing');\n    return fetchJson(this.baseUrl + '/admin/clients/' + id, { method: 'DELETE', headers });\n  }\n`;
c = c.replace(/(\n\}\s*\n)(module\.exports)/, '$1' + method + '$2');
fs.writeFileSync(f, c, 'utf8');
console.log('adminDeleteClient ajoute OK');
