const path = require('path');
const sharp = require('sharp');

const root = process.cwd();
const src = path.join(root, 'src', 'assets', 'logo.png');
const base = path.join(root, 'mobile-native', 'android', 'app', 'src', 'main', 'res');

const targets = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 }
];

(async () => {
  for (const t of targets) {
    const out1 = path.join(base, t.dir, 'ic_launcher.png');
    const out2 = path.join(base, t.dir, 'ic_launcher_round.png');
    const out3 = path.join(base, t.dir, 'ic_launcher_foreground.png');

    await sharp(src).resize(t.size, t.size, { fit: 'cover' }).png().toFile(out1);
    await sharp(src).resize(t.size, t.size, { fit: 'cover' }).png().toFile(out2);
    await sharp(src).resize(t.size, t.size, { fit: 'cover' }).png().toFile(out3);
  }
  console.log('ICONS_UPDATED');
})();
