const router = require('express').Router();
const controller = require('../controllers/classRoom.controller');
const { classes } = require('../middleware');

router.post('/', classes.create, controller.create);
router.get('/', classes.view, controller.list);
router.patch('/:id', classes.edit, controller.update);
router.post('/:id/toggle-status', classes.deactivate, controller.toggleStatus);
router.delete('/:id', classes.deactivate, controller.remove);

module.exports = router;
