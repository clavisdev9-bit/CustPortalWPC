const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const odooConnectionRepository = require('../repositories/odooConnectionRepository');
const userService = require('../services/userService');
const auditService = require('../services/auditService');
const ApiError = require('../utils/ApiError');
const { userProvisionedWebhookSchema } = require('../validators/odooWebhookValidators');

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

// Odoo's built-in "Send a Webhook Notification" action has no field for custom auth headers, so
// the per-connection secret travels in the URL path itself (see routes/odooWebhooks.routes.js and
// odooConnectionService.rotateWebhookSecret) -- this check IS this route's authentication, which
// is why the route deliberately sits outside the authenticate() JWT middleware (Odoo has no
// portal session to present a bearer token for).
async function authenticateConnection(req) {
  const connection = await odooConnectionRepository.findById(req.params.connectionId);
  if (!connection || !secretsMatch(req.params.secret, connection.webhook_secret)) {
    // Generic 404 either way -- doesn't confirm whether the connection id or the secret was wrong.
    throw new ApiError(404, 'not_found', 'Not found');
  }
  return connection;
}

// Odoo automation-rule webhooks retry on any non-2xx response, so every predictably-permanent
// outcome here (already provisioned, conflicting email) resolves as 2xx -- never a 5xx for
// something that will never succeed no matter how many times Odoo retries it.
const userProvisioned = asyncHandler(async (req, res) => {
  const connection = await authenticateConnection(req);
  const body = userProvisionedWebhookSchema.parse(req.body);

  // Migrasi 0015: koneksi yang sengaja dimatikan admin tidak boleh terus menambah user portal
  // darinya -- akun yang lahir di sini hanya akan menjawab 503 di setiap halaman sampai koneksinya
  // dinyalakan lagi.
  //
  // Dijawab 2xx, bukan 5xx, dengan alasan yang sama seperti `skipped_conflict`: Odoo mengulang
  // webhook pada respons non-2xx, dan mengulang tidak pernah menolong -- yang menyelesaikannya
  // adalah admin, bukan percobaan berikutnya. Peristiwa yang terlewat selama koneksi mati bukan
  // hilang permanen: "Sync Users from Odoo" menyapu SEMUA kontak Portal yang ada, jadi menyalakan
  // koneksi lalu menjalankannya sekali akan menyusulkan semuanya. Tetap dicatat di audit log,
  // supaya "kenapa user ini tidak pernah masuk" punya jejak yang bisa dibaca.
  if (connection.is_enabled === false) {
    await auditService.record(req, {
      action: 'odoo_webhook.skipped_connection_disabled',
      targetType: 'odoo_connection',
      targetId: connection.id,
      metadata: { odoo_partner_id: body.odooPartnerId, email: body.email },
    });
    res.status(200).json({ status: 'skipped_connection_disabled', user_id: null });
    return;
  }

  const result = await userService.provisionFromOdoo({
    odooConnectionId: connection.id,
    odooPartnerId: body.odooPartnerId,
    email: body.email,
    name: body.name,
    odooCompanyId: body.odooCompanyId,
  });

  await auditService.record(req, {
    action: result.status === 'provisioned' ? 'odoo_webhook.user_provisioned' : `odoo_webhook.${result.status}`,
    targetType: 'portal_user',
    targetId: result.user.id,
    metadata: { odoo_connection_id: connection.id, odoo_partner_id: body.odooPartnerId },
  });

  res.status(result.status === 'provisioned' ? 201 : 200).json({ status: result.status, user_id: result.user.id });
});

module.exports = { userProvisioned };
