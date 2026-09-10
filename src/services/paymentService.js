const fs = require('fs/promises');
const { resolveOdooContext } = require('./odooContext');
const OdooInvoiceService = require('../integrations/odoo/OdooInvoiceService');
const OdooPaymentService = require('../integrations/odoo/OdooPaymentService');
const paymentProofRepository = require('../repositories/paymentProofRepository');
const notificationService = require('./notificationService');
const { uploader, relativePathFor, absolutePath } = require('../utils/fileStorage');

const PROOF_SUBDIR = 'payment-proofs';
const proofUpload = uploader(PROOF_SUBDIR);

async function createPaymentLink(userId, currentCompanyId, invoiceId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const invoice = await OdooInvoiceService.getInvoice(session, odooPartnerId, odooCompanyId, invoiceId);
  const url = await OdooPaymentService.createPaymentLink(session, invoiceId, invoice.amount_residual);
  return { url };
}

// multer has already written the file to disk by the time this runs. Only delete it on a
// failure that happens BEFORE the DB row is created -- once payment_proofs references the file,
// a later failure (e.g. the notification insert) must not delete something a record points to.
async function uploadProof(userId, currentCompanyId, invoiceId, file, amount) {
  let context;
  try {
    context = await resolveOdooContext(userId, currentCompanyId);
    await OdooInvoiceService.getInvoice(context.session, context.odooPartnerId, context.odooCompanyId, invoiceId);
  } catch (err) {
    await fs.unlink(absolutePath(relativePathFor(PROOF_SUBDIR, file))).catch(() => {});
    throw err;
  }

  const proof = await paymentProofRepository.create({
    portalUserId: userId,
    odooConnectionId: context.connectionId,
    odooInvoiceId: invoiceId,
    filePath: relativePathFor(PROOF_SUBDIR, file),
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    amount,
  });

  await notificationService
    .notify(userId, {
      type: 'payment.proof_uploaded',
      title: 'Payment proof submitted',
      body: 'Your payment proof was submitted and is pending review.',
      link: `/invoices/${invoiceId}`,
    })
    .catch((err) => console.error('Failed to record payment-proof notification:', err.message));

  return proof;
}

async function listProofs(userId, currentCompanyId, invoiceId) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId);
  await OdooInvoiceService.getInvoice(session, odooPartnerId, odooCompanyId, invoiceId);
  return paymentProofRepository.listForInvoice(connectionId, invoiceId);
}

module.exports = { proofUpload, createPaymentLink, uploadProof, listProofs };
