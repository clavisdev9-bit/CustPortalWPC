const { Router } = require('express');
const odooWebhookController = require('../controllers/odooWebhookController');

// No authenticate() here -- Odoo has no portal session/JWT to present. The per-connection secret
// embedded in the URL path (see odooWebhookController.authenticateConnection) is this route's
// only authentication.
const router = Router();

router.post('/:connectionId/:secret', odooWebhookController.userProvisioned);

module.exports = router;
