const fs = require('fs');
const cFile = 'C:\\Users\\Wack\\Desktop\\pro-pass\\ui_src\\pages\\Clients.jsx';
let c = fs.readFileSync(cFile, 'utf8');
if (c.includes('title="Supprimer ce client"')) {
  console.log('Bouton JSX deja present');
} else {
  const rx = /(\{active \? <Lock size=\{18\} \/>.*?<\/button>)(\s*<\/div>)/s;
  if (rx.test(c)) {
    c = c.replace(rx, '$1\n                      <button className="icon-btn danger" title="Supprimer ce client" onClick={() => deleteClient(r.id, r.company_name || r.username)}>\n                        <Trash2 size={18} />\n                      </button>$2');
    fs.writeFileSync(cFile, c, 'utf8');
    console.log('Bouton Supprimer ajoute OK');
  } else {
    const i = c.indexOf('Unlock size={18}');
    console.log('Regex non trouvee, contexte:', JSON.stringify(c.substring(i, i+120)));
  }
}
