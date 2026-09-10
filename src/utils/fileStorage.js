const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

// Local disk for now, per subdir. Swap for S3-compatible object storage before production --
// the spec's own tech table (section 1) calls for Odoo Documents / Object Storage, not a local
// filesystem, but that's a real infra decision (which provider, which bucket layout) this
// skeleton shouldn't guess at.
function uploader(subdir) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  });
  return multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
}

function relativePathFor(subdir, file) {
  return path.posix.join(subdir, file.filename);
}

function absolutePath(relPath) {
  return path.join(UPLOAD_ROOT, relPath);
}

// For files pushed straight into Odoo as an ir.attachment (e.g. helpdesk ticket attachments) --
// no local copy is kept, so this hands the controller a Buffer via file.buffer instead of a path.
function memoryUploader() {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
}

module.exports = { uploader, relativePathFor, absolutePath, memoryUploader };
