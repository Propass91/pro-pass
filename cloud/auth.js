const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256');
  return `pbkdf2$sha256$120000$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const s = String(stored || '');
    if (!s.startsWith('pbkdf2$sha256$')) return false;
    const parts = s.split('$');
    const iter = Number(parts[2] || 0);
    // Current format produced by hashPassword():
    // pbkdf2$sha256$<iter>$<saltHex>$<hashHex>
    let saltHex = parts[3] || '';
    let hashHex = parts[4] || '';

    // Backward-compat (older format with extra separators):
    // pbkdf2$sha256$<iter>$$<saltHex>$$<hashHex>
    if ((!saltHex || !hashHex) && (parts[4] && parts[6])) {
      saltHex = parts[4] || '';
      hashHex = parts[6] || '';
    }
    if (!iter || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.pbkdf2Sync(String(password), salt, iter, expected.length, 'sha256');
    return crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  newToken
};
