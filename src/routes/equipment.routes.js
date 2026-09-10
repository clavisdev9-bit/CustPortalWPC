const { Router } = require('express');
const controller = require('../controllers/equipmentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

// Literal path segments (/due-replacements, /corrections) MUST be registered before /:id --
// Express would otherwise match them as an :id param and fail parseOdooId.
router.get('/due-replacements', requirePermission('equipment.view'), controller.dueReplacements);
router.get('/corrections', requirePermission('equipment.correct'), controller.listCorrections);
router.get('/', requirePermission('equipment.view'), controller.list);
router.get('/:id', requirePermission('equipment.view'), controller.get);
router.get('/:id/parts', requirePermission('equipment.view'), controller.parts);
router.get('/:id/service-history', requirePermission('equipment.view'), controller.serviceHistory);
router.post('/corrections', requirePermission('equipment.correct'), controller.createCorrection);

module.exports = router;
