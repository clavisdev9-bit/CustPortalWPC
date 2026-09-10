const ApiError = require('../../utils/ApiError');

const LIST_FIELDS = ['id', 'name', 'mimetype', 'create_date'];

// Callers must have already verified the caller owns res_id on res_model (via the relevant
// sales/invoice/delivery service's ensureOwned-style getter) -- this module has no ownership
// concept of its own, so it must never be exposed as a generic unscoped endpoint.
function listForRecord(session, resModel, resId) {
  return session.searchRead(
    'ir.attachment',
    [
      ['res_model', '=', resModel],
      ['res_id', '=', resId],
    ],
    LIST_FIELDS,
    { order: 'create_date desc' }
  );
}

async function getContent(session, resModel, resId, attachmentId) {
  const [attachment] = await session.searchRead(
    'ir.attachment',
    [
      ['id', '=', attachmentId],
      ['res_model', '=', resModel],
      ['res_id', '=', resId],
    ],
    ['name', 'mimetype']
  );
  if (!attachment) throw new ApiError(404, 'not_found', 'Attachment not found');

  const [full] = await session.read('ir.attachment', [attachmentId], ['name', 'mimetype', 'datas']);
  if (!full?.datas) throw new ApiError(404, 'not_found', 'Attachment has no content');
  return { name: full.name, mimetype: full.mimetype || 'application/octet-stream', buffer: Buffer.from(full.datas, 'base64') };
}

// Staff-shared documents (Option B) are stored as an ir.attachment stamped onto the recipient
// res.partner. res.partner is an Odoo *base* model, so this needs no Documents Enterprise app, and
// stamping res_id with the recipient means the same res_model+res_id ownership check in getContent()
// above applies unchanged when the file is later downloaded. Returns the new attachment's id.
function createOnPartner(session, partnerId, { name, mimetype, base64 }) {
  return session.create('ir.attachment', {
    name,
    mimetype,
    datas: base64,
    res_model: 'res.partner',
    res_id: partnerId,
  });
}

// Best-effort cleanup: if the portal-side share row fails to persist after the attachment was
// created, the caller unlinks it so no orphaned ir.attachment is left dangling on the partner.
function deleteById(session, attachmentId) {
  return session.callMethod('ir.attachment', 'unlink', [attachmentId]);
}

module.exports = { listForRecord, getContent, createOnPartner, deleteById };
