const ApiError = require('../../utils/ApiError');

// Uses Odoo's own Payment Link wizard (payment.link.wizard) instead of building a payment
// engine (section 28) -- Odoo already knows which providers are enabled for the company and
// handles the actual checkout; the portal only asks it for a link to redirect the customer to.
async function createPaymentLink(session, invoiceId, amount) {
  const wizardId = await session.create('payment.link.wizard', {
    res_model: 'account.move',
    res_id: invoiceId,
    amount,
  });
  const [wizard] = await session.read('payment.link.wizard', [wizardId], ['link']);
  if (!wizard?.link) throw new ApiError(502, 'payment_link_unavailable', 'Odoo did not return a payment link');
  return wizard.link;
}

module.exports = { createPaymentLink };
