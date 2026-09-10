const { Router } = require('express');
const companyController = require('../controllers/companyController');
const { authenticate } = require('../middleware/authenticate');

const router = Router();
router.use(authenticate);

router.get('/', companyController.list);
router.get('/current', companyController.current);
router.post('/switch', companyController.switchCompany);

module.exports = router;
