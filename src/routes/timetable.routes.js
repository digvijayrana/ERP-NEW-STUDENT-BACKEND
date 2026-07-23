const router = require('express').Router();
const controller = require('../controllers/timetable.controller');
const { roles } = require('../middleware');

router.get('/', roles.schoolUsers, controller.list);
router.post('/', roles.admin, controller.upsert);
router.delete('/:id/periods/:periodId', roles.admin, controller.deletePeriod);

module.exports = router;
