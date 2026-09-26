const { handleServiceError } = require('../utils/handleServiceError');
const ledger = require('../finance/ledger');
const returns = require('../finance/returns');
const { overview } = require('../finance/overview');
const reports = require('../finance/reports');

/** Sends JSON, or a CSV download when ?format=csv. */
function sendReport(req, res, result, columns, name) {
  if (req.query.format !== 'csv') return res.json(result);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
  return res.send(`﻿${reports.toCsv(result.rows, columns)}`); // BOM so Excel reads UTF-8
}

// Wraps a handler so AppErrors become their status + message and anything
// else is reported and hidden behind a generic 500.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    handleServiceError(err, res);
  }
};

const id = (req) => Number(req.params.id) || 0;
const moneyBody = (b = {}) => ({ amount: b.amount, method: b.method, referenceNo: b.reference_no, txnDate: b.txn_date, note: b.note, returnId: b.return_id });

module.exports = {
  // GET /api/finance/overview?from=&to=
  overview: handle(async (req, res) => res.json(await overview({ from: req.query.from, to: req.query.to }))),

  // GET /api/finance/reports/payments?side=&party_id=&method=&type=&from=&to=&format=csv
  paymentsReport: handle(async (req, res) => {
    const { side, party_id: partyId, method, type, from, to } = req.query;
    sendReport(req, res, await reports.payments({ side, partyId, method, type, from, to }), reports.PAYMENT_COLUMNS, 'payments');
  }),

  // GET /api/finance/reports/returns?side=&reason=&from=&to=&format=csv
  returnsReport: handle(async (req, res) => {
    const { side, reason, from, to } = req.query;
    sendReport(req, res, await reports.returnLines({ side, reason, from, to }), reports.RETURN_COLUMNS, 'returns');
  }),

  // GET|PUT /api/finance/settings
  getSettings: handle(async (req, res) => res.json(await returns.getFinanceSettings())),
  updateSettings: handle(async (req, res) => res.json(await returns.updateFinanceSettings({ req, input: req.body }))),

  // GET /api/finance/:side/parties - balances per supplier/customer
  parties: handle(async (req, res) => res.json(await ledger.balancesByParty({ s: req.side }))),

  // GET /api/finance/:side/parties/:id/statement
  statement: handle(async (req, res) => {
    const result = await ledger.statement({ s: req.side, partyId: id(req) });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  }),

  // GET /api/finance/:side/invoices?party_id=&status=&overdue=1
  invoices: handle(async (req, res) => {
    res.json(await ledger.listInvoices({ s: req.side, partyId: req.query.party_id, status: req.query.status, overdue: ['1', 'true'].includes(req.query.overdue) }));
  }),

  // GET /api/finance/:side/invoices/:id
  invoice: handle(async (req, res) => {
    const detail = await ledger.invoiceDetail({ s: req.side, invoiceId: id(req) });
    if (!detail) return res.status(404).json({ error: 'Invoice not found' });
    res.json(detail);
  }),

  // POST /api/finance/:side/invoices/:id/payments { amount, method, reference_no, txn_date, note }
  pay: handle(async (req, res) => res.status(201).json(await ledger.recordPayment({ req, s: req.side, invoiceId: id(req), ...moneyBody(req.body) }))),

  // POST /api/finance/:side/invoices/:id/refunds { amount, method, reference_no, txn_date, note }
  refund: handle(async (req, res) => res.status(201).json(await ledger.recordRefund({ req, s: req.side, invoiceId: id(req), ...moneyBody(req.body) }))),

  // POST /api/finance/:side/invoices/:id/credits { source_invoice_id, amount, note }
  credit: handle(async (req, res) => res.status(201).json(await ledger.applyCredit({
    req, s: req.side, invoiceId: id(req), sourceInvoiceId: req.body?.source_invoice_id, amount: req.body?.amount, note: req.body?.note, returnId: req.body?.return_id,
  }))),

  // POST /api/finance/:side/transactions/:id/reverse { reason }
  reverse: handle(async (req, res) => res.status(201).json(await ledger.reverseTransaction({ req, s: req.side, txnId: id(req), reason: req.body?.reason }))),

  // POST /api/finance/:side/invoices/:id/returns
  createReturn: handle(async (req, res) => {
    const b = req.body || {};
    const args = { req, s: req.side, invoiceId: id(req), items: b.items, reason: b.reason, notes: b.notes, returnDate: b.return_date };
    const result = req.side.side === 'supplier'
      ? await returns.createSupplierReturn(args)
      : await returns.createCustomerReturn({ ...args, refund: b.refund });
    res.status(201).json(result);
  }),

  // POST /api/finance/supplier/returns/:id/response { response, note }
  supplierResponse: handle(async (req, res) => res.json(await returns.recordSupplierResponse({ req, returnId: id(req), response: req.body?.response, note: req.body?.note }))),

  // GET /api/finance/customer/returns?status=
  customerReturns: handle(async (req, res) => res.json(await returns.listCustomerReturns({ status: req.query.status }))),

  // POST /api/finance/customer/returns/:id/decision { decision, note }
  decideReturn: handle(async (req, res) => res.json(await returns.decideCustomerReturn({
    req, s: req.side, returnId: id(req), decision: req.body?.decision, note: req.body?.note,
  }))),
};
