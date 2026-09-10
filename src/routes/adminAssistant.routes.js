const { Router } = require('express');
const adminAssistantController = require('../controllers/adminAssistantController');
const { authenticate } = require('../middleware/authenticate');
const requirePlatformAdmin = require('../middleware/requirePlatformAdmin');

// Mengikuti pola admin/odoo-connections: gerbang requirePlatformAdmin, bukan permission RBAC
// per-customer. Prompt dan settings berlaku lintas pelanggan di satu connection, jadi ini
// urusan operator platform -- bukan sesuatu yang boleh dijangkau role Customer Admin.
const router = Router();
router.use(authenticate);
router.use(requirePlatformAdmin);

router.get('/settings', adminAssistantController.listSettings);
router.put('/settings', adminAssistantController.saveSettings);

// Konfigurasi Provider AI (My Account > Setting) -- satu baris per provider, lihat cr.md.
router.get('/provider-configs', adminAssistantController.listProviderConfigs);
router.put('/provider-configs', adminAssistantController.saveProviderConfig);
// CR-048. Daftar model yang ditawarkan dropdown di halaman itu, ditanyakan ke provider-nya
// sendiri. Punya burst limiter sendiri karena ia menelepon keluar -- dan untuk Ollama, ke alamat
// yang diisi admin.
router.get('/provider-configs/:provider/models', adminAssistantController.listProviderModels);
// CR-049. Test Connection per provider. Berbagi burst limiter dengan endpoint models di atas --
// keduanya menelepon tujuan yang sama.
router.post('/provider-configs/:provider/test-connection', adminAssistantController.testProviderConnection);

router.get('/prompts', adminAssistantController.listPrompts);
router.post('/prompts', adminAssistantController.createPrompt);
router.post('/prompts/:id/activate', adminAssistantController.activatePrompt);

router.get('/tools', adminAssistantController.listTools);
router.put('/tools', adminAssistantController.saveTool);

module.exports = router;
