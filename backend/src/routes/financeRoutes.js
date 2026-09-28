const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { SIDES } = require('../finance/sides');
const finance = require('../controllers/financeController');

// /api/finance - supplier (payables) and customer (receivables) ledgers.
// Every rule is enforced here and in the database; the UI only mirrors it.
const router = express.Router();
router.use(authenticate);

router.get('/overview', requirePermission('reports.financial.view'), finance.overview);
router.get('/reports/payments', requirePermission('reports.financial.view'), finance.paymentsReport);
router.get('/reports/returns', requirePermission('reports.financial.view'), finance.returnsReport);
router.get('/settings', requirePermission('reports.financial.view', 'settings.manage'), finance.getSettings);
router.put('/settings', requirePermission('settings.manage'), finance.updateSettings);

// Resolves :side (supplier | customer) and checks that side's permission.
const onSide = (perm) => (req, res, next) => {
  req.side = SIDES[req.params.side];
  if (!req.side) return res.status(404).json({ error: 'Unknown ledger' });
  const codes = typeof perm === 'function' ? perm(req.side) : perm;
  return requirePermission(...[].concat(codes))(req, res, next);
};
const only = (sideName, perm) => (req, res, next) => {
  if (req.params.side !== sideName) return res.status(404).json({ error: 'Not found' });
  return onSide(perm)(req, res, next);
};
const view = (s) => s.perms.view;
const money = (s) => s.perms.money;
const pay = (s) => s.perms.pay;
const recordReturns = (s) => s.perms.returns;
const partyView = (s) => (s.side === 'supplier' ? 'suppliers.view' : 'institutions.view');
// Follow-up notes: whoever manages the account or takes its payments
const noteWriters = (s) => (s.side === 'supplier' ? ['suppliers.manage', s.perms.pay] : ['institutions.manage', s.perms.pay]);

router.get('/:side/parties', onSide(money), finance.parties);
router.get('/:side/parties/:id/statement', onSide(money), finance.statement);
router.get('/:side/parties/:id/insights', onSide(money), finance.insights);
router.get('/:side/parties/:id/activity', onSide('audit.view'), finance.activity);
router.get('/:side/parties/:id/notes', onSide(partyView), finance.notes);
router.post('/:side/parties/:id/notes', onSide(noteWriters), finance.addNote);
router.get('/:side/invoices', onSide(view), finance.invoices);
router.get('/:side/invoices/:id', onSide(view), finance.invoice);
router.post('/:side/invoices/:id/payments', onSide(pay), finance.pay);
router.post('/:side/parties/:id/payments', onSide(pay), finance.payAccount);
router.post('/:side/invoices/:id/refunds', onSide('ledger.manage'), finance.refund);
router.post('/:side/invoices/:id/credits', onSide('ledger.manage'), finance.credit);
router.post('/:side/invoices/:id/returns', onSide(recordReturns), finance.createReturn);
router.post('/:side/transactions/:id/reverse', onSide('ledger.manage'), finance.reverse);
router.post('/:side/returns/:id/response', only('supplier', 'ledger.manage'), finance.supplierResponse);
router.get('/:side/returns', only('customer', 'customer_returns.approve'), finance.customerReturns);
router.post('/:side/returns/:id/decision', only('customer', 'customer_returns.approve'), finance.decideReturn);

module.exports = router;
