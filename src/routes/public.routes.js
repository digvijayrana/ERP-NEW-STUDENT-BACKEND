const router = require('express').Router();
const controller = require('../controllers/publicBranding.controller');

router.get('/branding', controller.branding);

module.exports = router;
