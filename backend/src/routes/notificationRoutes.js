const express = require('express');
const { authenticate } = require('../middleware/auth');
const notifications = require('../controllers/notificationController');
const { stream } = require('../notifications/realtime');

const router = express.Router();

// Own inbox only - see notificationController for the ownership scoping.
router.use(authenticate);

router.get('/stream', stream);
router.get('/unread-count', notifications.getUnreadCount);
router.get('/preferences', notifications.getPreferences);
router.put('/preferences', notifications.updatePreferences);
router.post('/read-all', notifications.markAllRead);
router.get('/', notifications.list);
router.patch('/:id/read', notifications.markRead);
router.patch('/:id/archive', notifications.archive);

module.exports = router;
