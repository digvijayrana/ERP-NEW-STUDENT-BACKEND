const router = require('express').Router();
const controller = require('../controllers/admissionAssistant.controller');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/auth');

// Public landing chatbot + self-serve tools (no auth)
router.get('/public/faq', controller.publicFaq);
router.get('/public/fees/estimate', controller.publicEstimateFees);
router.get('/public/eligibility', controller.publicEligibility);
router.post('/public/eligibility', controller.publicEligibility);
router.post('/public/chat', controller.publicChat);
router.post('/public/leads', controller.publicCreateLead);

// Admin CRM (authenticated)
router.use(authenticate);
router.get('/dashboard', requirePermission('admission_assistant', 'view'), controller.dashboard);
router.get('/analytics', requirePermission('admission_assistant', 'view'), controller.analytics);
router.get('/pipeline', requirePermission('admission_assistant', 'view'), controller.pipeline);
router.get('/leads', requirePermission('admission_assistant', 'view'), controller.listLeads);
router.get('/leads/:id', requirePermission('admission_assistant', 'view'), controller.getLead);
router.patch('/leads/:id', requirePermission('admission_assistant', 'edit'), controller.updateLead);
router.patch('/leads/:id/stage', requirePermission('admission_assistant', 'edit'), controller.updateStage);
router.patch('/leads/:id/documents', requirePermission('admission_assistant', 'edit'), controller.verifyDocument);
router.post('/leads/:id/interview', requirePermission('admission_assistant', 'edit'), controller.bookInterview);
router.post('/leads/:id/scholarship', requirePermission('admission_assistant', 'edit'), controller.suggestScholarship);
router.post('/leads/:id/notify', requirePermission('admission_assistant', 'create'), controller.notifyLead);

module.exports = router;
