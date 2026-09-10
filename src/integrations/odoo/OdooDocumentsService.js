const LIST_FIELDS = ['id', 'name', 'mimetype', 'create_date'];

// Odoo naive datetime strings ("YYYY-MM-DD HH:mm:ss") are UTC with no offset marker -- parsing them
// with the bare Date constructor silently reinterprets them in the Node process's local timezone
// (verified live: a doc shared at 22:54:42 UTC on this staging instance came back as 15:54:42 if
// parsed naively on a UTC+7 host). Every timestamp read from documents.access/documents.document
// must go through this before being compared or returned to the client.
function parseOdooDatetime(value) {
  if (!value) return null;
  return new Date(`${value.replace(' ', 'T')}Z`);
}

// Odoo Documents app (Enterprise), read side of "Option A" (spec section 18: "Dokumen dapat berasal
// dari Odoo Documents atau storage portal"). Sharing a file to a contact from inside Odoo's own
// Documents app does not touch res.partner's ir.attachment (that's the portal-native "Option B" path
// in OdooAttachmentService.createOnPartner) -- it creates a documents.access row instead. Verified
// live against Odoo staging (fields_get on both models, plus a real access row -- id 7, partner_id 8,
// role 'view' -- produced by actually using the "Share" action in Odoo's Documents app), not assumed
// from documentation, per the lesson of resolution.md BUG-17 (guessed mail.message.res_model field).
//
// This module runs ALONGSIDE Option B, not instead of it -- both are valid sources per spec section 18
// and documentShareService.listInbox() merges rows from both.

// One row per (document, partner) grant. Filtered to type='binary' -- documents.document also
// represents folders and URL shortcuts (type 'folder'/'url'), neither of which has downloadable
// `datas` content, so those are silently excluded rather than surfaced as broken download links.
async function listSharedWithPartner(session, partnerId) {
  const access = await session.searchRead(
    'documents.access',
    [['partner_id', '=', partnerId]],
    ['id', 'document_id', 'expiration_date']
  );
  if (!access.length) return [];

  const docIds = [...new Set(access.map((a) => a.document_id[0]))];
  const docs = await session.searchRead(
    'documents.document',
    [
      ['id', 'in', docIds],
      ['type', '=', 'binary'],
      ['active', '=', true],
    ],
    LIST_FIELDS
  );
  const docById = new Map(docs.map((d) => [d.id, d]));

  return access
    .map((a) => {
      const doc = docById.get(a.document_id[0]);
      if (!doc) return null;
      return {
        id: `odoo:${doc.id}`,
        filename: doc.name,
        mimetype: doc.mimetype || null,
        category: null,
        note: null,
        created_at: parseOdooDatetime(doc.create_date),
        expires_at: parseOdooDatetime(a.expiration_date),
        source: 'odoo',
      };
    })
    .filter((row) => row && (!row.expires_at || row.expires_at > new Date()));
}

// Re-verifies the caller's partner actually holds a live (non-expired) documents.access grant on
// this document before releasing bytes. This is our own authority check, not Odoo's portal ACL --
// XML-RPC here runs under a single connection-level service credential (see OdooAttachmentService.js
// and the "Option B" design note in database/migrations/0009_document_shares.sql), so Odoo's own
// record rules for a real portal login never come into play and can't be relied on for scoping.
// Returns null (caller turns this into a generic 404) for anything out of scope, expired, or not a
// downloadable binary document -- never a distinguishable error, per section 32's no-leak policy.
//
// Fetches every access grant for this (document, partner) pair rather than just one -- Odoo's Share
// action adds a new documents.access row on each re-share rather than updating an existing one, so a
// document that's visibly live in listSharedWithPartner() (because at least one grant is current)
// must not 404 here just because an unrelated *expired* grant happened to be read first.
async function getContentIfShared(session, documentId, partnerId) {
  const [access, doc] = await Promise.all([
    session.searchRead(
      'documents.access',
      [
        ['document_id', '=', documentId],
        ['partner_id', '=', partnerId],
      ],
      ['id', 'expiration_date']
    ),
    session.read('documents.document', [documentId], ['name', 'mimetype', 'datas', 'type', 'active']),
  ]);

  const now = new Date();
  const hasLiveGrant = access.some((a) => {
    const expiresAt = parseOdooDatetime(a.expiration_date);
    return !expiresAt || expiresAt > now;
  });
  if (!hasLiveGrant) return null;

  const [record] = doc;
  if (!record || !record.active || record.type !== 'binary' || !record.datas) return null;
  return { name: record.name, mimetype: record.mimetype || 'application/octet-stream', buffer: Buffer.from(record.datas, 'base64') };
}

module.exports = { listSharedWithPartner, getContentIfShared };
