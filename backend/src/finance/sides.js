// The two ledgers are mirror images: purchase invoices we owe suppliers
// (payables) and sales invoices customers owe us (receivables). Everything
// that differs between them lives here, so the ledger code is written once.
//
// `drawer` is the effect of a CASH transaction on the till: a customer
// payment puts cash in, a supplier payment takes it out, refunds the reverse.

const ACCOUNT_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card', 'bank_transfer'];

const SIDES = {
  supplier: {
    side: 'supplier',
    label: 'supplier',
    partyTable: 'suppliers',
    party: 'supplier_id',
    invoiceTable: 'supplier_deliveries',
    invoice: 'delivery_id',
    source: 'source_delivery_id',
    itemsTable: 'supplier_delivery_items',
    itemInvoice: 'delivery_id',
    price: 'unit_cost',
    txns: 'supplier_transactions',
    view: 'supplier_invoice_balances',
    returns: 'supplier_returns',
    returnItems: 'supplier_return_items',
    returnItemRef: 'delivery_item_id',
    invoiceDate: 'delivery_date',
    dueDate: 'payment_due_date',
    entityType: 'supplier_delivery',
    reasons: ['damaged', 'wrong_item', 'wrong_quantity', 'expired', 'defective', 'poor_quality', 'duplicate_delivery', 'other'],
    drawer: { payment: -1, refund: 1 },
    perms: {
      view: 'supplier_deliveries.view',
      money: 'supplier_payments.view',
      pay: 'supplier_payments.manage',
      returns: 'supplier_returns.manage',
    },
  },
  customer: {
    side: 'customer',
    label: 'customer',
    partyTable: 'institutions',
    party: 'institution_id',
    invoiceTable: 'institution_orders',
    invoice: 'order_id',
    source: 'source_order_id',
    itemsTable: 'institution_order_items',
    itemInvoice: 'order_id',
    price: 'unit_price',
    txns: 'customer_transactions',
    view: 'customer_invoice_balances',
    returns: 'customer_returns',
    returnItems: 'customer_return_items',
    returnItemRef: 'order_item_id',
    invoiceDate: 'order_date',
    dueDate: 'due_date',
    entityType: 'institution_order',
    reasons: ['defective', 'damaged', 'wrong_item', 'expired', 'poor_quality', 'changed_mind', 'other'],
    drawer: { payment: 1, refund: -1 },
    perms: {
      view: 'institution_orders.view',
      money: 'institution_payments.view',
      pay: 'institution_payments.manage',
      returns: 'customer_returns.manage',
    },
  },
};

function sideOf(name) {
  return SIDES[name] || null;
}

module.exports = { SIDES, sideOf, ACCOUNT_METHODS };
