// Shared by the supplier/customer ledger screens and the finance overview.
// The API validates all of these; the lists only drive the UI.

// Supplier and customer account payments (the till itself uses the 4 POS methods)
export const ACCOUNT_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card', 'bank_transfer'];

export const SUPPLIER_RETURN_REASONS = ['damaged', 'wrong_item', 'wrong_quantity', 'expired', 'defective', 'poor_quality', 'duplicate_delivery', 'other'];
export const CUSTOMER_RETURN_REASONS = ['defective', 'damaged', 'wrong_item', 'expired', 'poor_quality', 'changed_mind', 'other'];

// Invoice status (derived from the ledger) -> badge tone
export const INVOICE_TONE = { unpaid: 'danger', partial: 'warning', paid: 'success', credit: 'info' };

export const RETURN_STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'neutral' };
export const SUPPLIER_RESPONSE_TONE = { pending: 'warning', accepted: 'success', disputed: 'danger' };

export const todayIso = () => new Date().toISOString().slice(0, 10);
