const { Router } = require('express');
const capabilityController = require('../controllers/capabilityController');
const { authenticate } = require('../middleware/authenticate');

// Tanpa requirePermission: ini bukan data pelanggan, melainkan "modul Odoo apa yang terpasang di
// koneksi perusahaan yang sedang aktif" -- jawaban yang sama untuk semua user di company itu,
// dan sudah dibatasi ke koneksi milik user oleh resolveOdooContext. Permission per-fitur tetap
// ditegakkan di endpoint fiturnya masing-masing; ini hanya menentukan apa yang layak ditampilkan.
const router = Router();
router.use(authenticate);

router.get('/', capabilityController.list);

module.exports = router;
