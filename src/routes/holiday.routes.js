const router = require('express').Router();
const controller = require('../controllers/holiday.controller');
const { roles } = require('../middleware');

router.get('/', roles.schoolUsers, controller.list);
router.post('/', roles.admin, controller.create);
router.delete('/:id', roles.admin, controller.remove);

module.exports = router;
