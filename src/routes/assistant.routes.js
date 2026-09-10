const { Router } = require('express');
const assistantController = require('../controllers/assistantController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

// 'assistant.use' hanya membuka pintu widget. Data apa yang boleh dijangkau di baliknya tetap
// ditentukan permission per-tool, yang disaring toolRegistry sebelum daftar tool sampai ke model
// (section 7.2 poin 3) -- jadi dua user dengan 'assistant.use' yang sama tetap punya asisten
// dengan kemampuan berbeda.
const router = Router();
router.use(authenticate);

router.get('/config', requirePermission('assistant.use'), assistantController.getConfig);
router.post('/chat', requirePermission('assistant.use'), assistantController.chat);

router.get('/conversations', requirePermission('assistant.use'), assistantController.listConversations);
router.get('/conversations/:id', requirePermission('assistant.use'), assistantController.getConversation);
router.delete('/conversations/:id', requirePermission('assistant.use'), assistantController.deleteConversation);

router.post('/messages/:id/feedback', requirePermission('assistant.use'), assistantController.submitFeedback);

// Aksi tulis (Fase 2, I-5). Gerbang di router hanya 'assistant.use' karena SATU route melayani
// tiga aksi dengan tiga permission berbeda (ticket.create / rma.create / warranty.create) --
// permission aksinya diperiksa di dalam controller, terhadap draf yang bersangkutan.
//
// Route ini adalah satu-satunya jalur eksekusi: tool `draft_*` tidak pernah memanggil service
// tulis. Kalau route ini dihapus, asisten kembali jadi baca-saja -- itu properti yang disengaja.
router.patch('/drafts/:id', requirePermission('assistant.use'), assistantController.updateDraft);
router.post('/drafts/:id/confirm', requirePermission('assistant.use'), assistantController.confirmDraft);
router.post('/drafts/:id/cancel', requirePermission('assistant.use'), assistantController.cancelDraft);

module.exports = router;
