const { Router } = require('express');
const roleController = require('../controllers/roleController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requirePlatformAdmin = require('../middleware/requirePlatformAdmin');

const router = Router();
router.use(authenticate);

// portal_roles/portal_role_permissions are a single shared catalog reused by every customer
// (section 19/20 -- "Viewer"/"Finance"/etc mean the same thing for everyone), not a per-customer
// resource. `user.create` is granted to every Customer Admin so they can pick roles when
// onboarding their own teammates -- it must not also let them redefine what those roles grant
// platform-wide. Listing stays available to any user.view holder (needed to populate the
// create-user role picker); only catalog mutation is restricted to the platform admin.
router.get('/', requirePermission('user.view'), roleController.list);
router.post('/', requirePlatformAdmin, roleController.create);
router.get('/:id', requirePermission('user.view'), roleController.get);
router.patch('/:id', requirePlatformAdmin, roleController.update);
router.delete('/:id', requirePlatformAdmin, roleController.remove);

module.exports = router;
