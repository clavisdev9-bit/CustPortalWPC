const ApiError = require('../utils/ApiError');

module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.name === 'ZodError') {
    return res.status(400).json({ error: { code: 'validation_error', message: 'Invalid request body', details: err.issues } });
  }
  // Postgres 22P02 (invalid_text_representation) -- most commonly a malformed UUID in a route
  // param (e.g. GET /warranty/not-a-uuid) reaching a raw `WHERE id = $1` query. Route params
  // aren't run through a Zod schema the way bodies/queries are, so without this it surfaces as an
  // opaque 500 instead of a clean 400 for what is really a client input error.
  if (err.code === '22P02') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid id format', details: null } });
  }
  // multer rejects an over-limit or malformed multipart upload with a MulterError -- surface the
  // common "file too large" case as a clean 413 instead of an opaque 500. One central place covers
  // every upload route (ticket attachments, delivery proof, shared documents).
  if (err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      error: {
        code: tooBig ? 'file_too_large' : 'upload_error',
        message: tooBig ? 'File exceeds the 10MB limit' : `Upload error: ${err.message}`,
        details: null,
      },
    });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected server error' } });
};
