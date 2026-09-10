const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = Buffer.from(env.encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte value encoded as hex (64 hex chars)');
  }
  return key;
}

// Odoo credentials and 2FA secrets are encrypted at rest with this -- never stored plaintext (section 9, 22).
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(payload) {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Digit-by-digit via randomInt (not a modulo of randomBytes) so there's no modulo bias and no
// leading-zero loss -- "042917" is exactly as likely as any other 6-digit code.
function randomNumericCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

module.exports = { encrypt, decrypt, sha256, randomToken, randomNumericCode };
