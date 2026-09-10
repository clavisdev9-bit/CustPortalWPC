const { resolveIdentity, resolveOdooContext } = require('./odooContext');
const OdooAttachmentService = require('../integrations/odoo/OdooAttachmentService');
const OdooDocumentsService = require('../integrations/odoo/OdooDocumentsService');
const OdooPartnerService = require('../integrations/odoo/OdooPartnerService');
const documentShareRepository = require('../repositories/documentShareRepository');
const identityMappingRepository = require('../repositories/identityMappingRepository');
const notificationService = require('./notificationService');
const ApiError = require('../utils/ApiError');

// ---------------------------------------------------------------------------
// SENDER (internal staff, permission document.share)
// ---------------------------------------------------------------------------

// Search recipients within the sender's own Odoo connection (the connection resolved from their
// currently selected company). A recipient can only ever be a real partner in that connection --
// which is also the only place the file's bytes and the recipient's portal identity can co-exist.
async function searchRecipients(userId, currentCompanyId, query) {
  const q = (query || '').trim();
  // Require a real search term -- never enumerate the whole partner base on an empty/one-char query.
  if (q.length < 2) return [];
  const { session } = await resolveOdooContext(userId, currentCompanyId);
  return OdooPartnerService.search(session, q);
}

// Upload a file and deliver it to exactly one recipient partner. Odoo is written first (the byte
// store); only if that succeeds do we record the portal-side share row + notify -- so we never end
// up with a "share" pointing at an attachment that doesn't exist.
async function shareDocument(userId, currentCompanyId, { recipientPartnerId, file, category, note, expiresAt }) {
  if (!file) throw new ApiError(400, 'file_required', 'A file is required');

  const { session, connectionId } = await resolveOdooContext(userId, currentCompanyId);

  // Reject a hand-typed recipient id that isn't a real partner in this connection.
  const partner = await OdooPartnerService.findByIdViaSession(session, recipientPartnerId);
  if (!partner) throw new ApiError(404, 'recipient_not_found', 'Recipient partner not found in this connection');

  const attachmentId = await OdooAttachmentService.createOnPartner(session, recipientPartnerId, {
    name: file.originalname,
    mimetype: file.mimetype,
    base64: file.buffer.toString('base64'),
  });

  let share;
  try {
    share = await documentShareRepository.create({
      odooConnectionId: connectionId,
      recipientPartnerId,
      odooAttachmentId: attachmentId,
      filename: file.originalname,
      mimetype: file.mimetype,
      sizeBytes: file.size,
      category,
      note,
      sharedByUserId: userId,
      expiresAt,
    });
  } catch (err) {
    // The attachment already landed in Odoo but the portal-side share row didn't -- unlink it so we
    // don't leave an orphaned file dangling on the partner, then surface the original failure.
    await OdooAttachmentService.deleteById(session, attachmentId).catch(() => {});
    throw err;
  }

  // Best-effort, like every other service's post-action notify (see paymentService/deliveryService):
  // a notification failure must never fail a share that already succeeded in Odoo + the portal DB.
  notifyRecipients(connectionId, recipientPartnerId, share).catch(() => {});

  return {
    id: share.id,
    recipient: { id: partner.id, name: partner.name, email: partner.email || null },
    filename: share.filename,
    created_at: share.created_at,
  };
}

async function notifyRecipients(connectionId, recipientPartnerId, share) {
  const users = await identityMappingRepository.findUsersByPartner(connectionId, recipientPartnerId);
  await Promise.all(
    users.map((u) =>
      notificationService.notify(u.portal_user_id, {
        type: 'document.shared',
        title: `A new document has been shared with you: ${share.filename}`,
        link: '/documents',
      })
    )
  );
}

// Sender's accountability view of what they've shared, enriched with the recipient's display name
// (best-effort). Names are only resolved for rows in the currently selected connection -- partner
// ids aren't unique across Odoo databases, so a row from another connection is left name-less
// rather than risk showing the wrong partner's name.
async function listSent(userId, currentCompanyId) {
  const rows = await documentShareRepository.listBySender(userId);
  if (!rows.length) return [];

  let connectionId = null;
  const nameById = new Map();
  try {
    const ctx = await resolveOdooContext(userId, currentCompanyId);
    connectionId = ctx.connectionId;
    const ids = [...new Set(rows.filter((r) => r.odoo_connection_id === connectionId).map((r) => r.recipient_partner_id))];
    if (ids.length) {
      const partners = await ctx.session.searchRead('res.partner', [['id', 'in', ids]], ['id', 'name']);
      partners.forEach((p) => nameById.set(p.id, p.name));
    }
  } catch {
    /* best-effort: fall back to showing the raw partner id in the UI */
  }

  return rows.map((r) => ({ ...r, recipient_name: nameById.get(r.recipient_partner_id) || null }));
}

// Revoke one of my own shares -- the recipient stops seeing it immediately (listForRecipient
// filters revoked_at). 404 if it isn't mine, is already revoked, or doesn't exist.
async function revoke(userId, shareId) {
  const row = await documentShareRepository.revoke(shareId, userId);
  if (!row) throw new ApiError(404, 'not_found', 'Document share not found');
  return { id: row.id, revoked: true };
}

// ---------------------------------------------------------------------------
// RECIPIENT (customer, permission document.receive)
// ---------------------------------------------------------------------------

// List documents shared with me -- scoped to my exact partner in my current connection. Merges two
// independent sources per spec section 18 ("Dokumen dapat berasal dari Odoo Documents atau storage
// portal"): portal-native shares (Option B, Postgres `document_shares`) and Odoo-native shares
// (Option A, `documents.access` grants made from inside Odoo's own Documents app -- see
// OdooDocumentsService.js). The portal-side read uses resolveIdentity (no Odoo network call); the
// Odoo-side read additionally needs a live session (resolveOdooContext) and is treated as
// best-effort so a down/unreachable Odoo degrades to "portal shares only" instead of failing the
// whole inbox. The two are independent I/O calls to different systems, so they run concurrently
// (Promise.allSettled, not sequential awaits) -- the portal query never has to wait out however long
// an Odoo XML-RPC session takes to open, and vice versa.
async function listInbox(userId, currentCompanyId) {
  const { connection, odooPartnerId } = await resolveIdentity(userId, currentCompanyId);

  const [portalResult, odooResult] = await Promise.allSettled([
    documentShareRepository.listForRecipient(connection.id, odooPartnerId),
    resolveOdooContext(userId, currentCompanyId).then(({ session }) =>
      OdooDocumentsService.listSharedWithPartner(session, odooPartnerId)
    ),
  ]);

  // portalResult must never reject here in practice -- resolveIdentity() above already succeeded, so
  // the only remaining failure mode is the query itself, which we still don't want to hide behind an
  // empty inbox. Odoo failures, in contrast, are expected/tolerated (see comment above).
  if (portalResult.status === 'rejected') throw portalResult.reason;

  const portalDocs = portalResult.value.map((r) => ({ ...r, source: 'portal' }));
  const odooDocs = odooResult.status === 'fulfilled' ? odooResult.value : [];

  return [...portalDocs, ...odooDocs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Download one shared document. Anything outside the caller's exact (connection, partner) scope --
// or revoked/expired -- returns a generic 404, never revealing that the row exists (section 32).
// Odoo-native shares (Option A) are addressed by a synthetic `odoo:<documents.document id>` id
// (see OdooDocumentsService.listSharedWithPartner) so the recipient inbox can stay a single list
// backed by either source without the frontend needing to know which one a given row came from.
async function download(userId, currentCompanyId, shareId) {
  if (typeof shareId === 'string' && shareId.startsWith('odoo:')) {
    const documentId = Number(shareId.slice('odoo:'.length));
    const { session, odooPartnerId } = await resolveOdooContext(userId, currentCompanyId);
    const file = documentId && (await OdooDocumentsService.getContentIfShared(session, documentId, odooPartnerId));
    if (!file) throw new ApiError(404, 'not_found', 'Document not found');
    return file;
  }

  const { session, connectionId, odooPartnerId } = await resolveOdooContext(userId, currentCompanyId);
  const row = await documentShareRepository.findById(shareId);
  const outOfScope =
    !row ||
    row.odoo_connection_id !== connectionId ||
    row.recipient_partner_id !== odooPartnerId ||
    row.revoked_at ||
    (row.expires_at && new Date(row.expires_at) <= new Date());
  if (outOfScope) throw new ApiError(404, 'not_found', 'Document not found');

  // Reuse the existing ownership-checked reader: the attachment is stamped on this res.partner, so
  // getContent's own res_model+res_id filter double-checks ownership at the Odoo layer too.
  return OdooAttachmentService.getContent(session, 'res.partner', row.recipient_partner_id, row.odoo_attachment_id);
}

module.exports = { searchRecipients, shareDocument, listSent, revoke, listInbox, download };
