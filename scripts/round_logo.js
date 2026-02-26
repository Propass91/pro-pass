const fs = require('fs');
const path = require('path');

async function main() {
  const sharp = require('sharp');

  const root = path.join(__dirname, '..');
  const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist', 'PROPASS.png');
  const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'build', 'icon.round.png');

  if (!fs.existsSync(input)) {
    console.error('INPUT_NOT_FOUND', input);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });

  const size = 512;

  // Create a circular alpha mask
  const circleSvg = Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
    </svg>`
  );

  const img = sharp(input)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha();

  const rounded = await img
    .composite([{ input: circleSvg, blend: 'dest-in' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  fs.writeFileSync(output, rounded);
  console.log('ROUND_OK', { input, output, bytes: rounded.length });
}

main().catch((err) => {
  console.error('ROUND_ERR', err && (err.stack || err.message) || err);
  process.exit(1);
});
