const fs = require('fs');
const path = require('path');

async function main() {
  const pngToIco = require('png-to-ico');

  const root = path.join(__dirname, '..');
  const defaultInput = (() => {
    const rounded = path.join(root, 'build', 'icon.round.png');
    if (fs.existsSync(rounded)) return rounded;
    return path.join(root, 'dist', 'PROPASS.png');
  })();
  const input = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;
  const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'build', 'icon.ico');

  if (!fs.existsSync(input)) {
    console.error('INPUT_NOT_FOUND', input);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });

  const buf = fs.readFileSync(input);
  const icoBuf = await pngToIco(buf);
  fs.writeFileSync(output, icoBuf);

  console.log('ICON_OK', { input, output, bytes: icoBuf.length });
}

main().catch((err) => {
  console.error('ICON_ERR', err && (err.stack || err.message) || err);
  process.exit(1);
});
