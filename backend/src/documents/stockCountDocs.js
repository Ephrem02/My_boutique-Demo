// Stock count PDFs: the count sheet (blind: without system quantities, for
// counting on paper) and the difference report once the count is submitted.
const { getCount } = require('../models/stockCountService');
const { getClosingSettings } = require('../businessDay/settings');
const { getBusiness } = require('./business');
const pdf = require('./pdf');

const STATUS = { counting: 'Being counted', submitted: 'Waiting for a manager', approved: 'Approved - stock corrected', rejected: 'Rejected', cancelled: 'Cancelled' };
const LOCATION = { front_shelf: 'Front shelf', store_room: 'Store room' };

async function stockCountDocument({ req, id, kind, generatedBy }) {
  const count = await getCount({ req, id });
  const business = await getBusiness();
  const tz = (await getClosingSettings()).timezone;
  const { rwf, num, when, table, pairs, heading, note, signedRwf } = pdf;
  // Before submission (or for a counter on a blind count) only the sheet makes sense
  const sheet = kind === 'sheet' || count.status === 'counting';
  const showSystem = !count.blind && !count.system_hidden;
  const loc = (l) => LOCATION[l.location] || l.location;

  const content = [pairs([
    ['Status', STATUS[count.status]],
    ['Started', `${when(count.started_at, tz)} by ${count.started_by_name || '—'}`],
    count.submitted_at && ['Submitted', `${when(count.submitted_at, tz)} by ${count.submitted_by_name || '—'}`],
    count.decided_at && ['Decided', `${when(count.decided_at, tz)} by ${count.decided_by_name || '—'}${count.decision_note ? ` - ${count.decision_note}` : ''}`],
    !sheet && count.lines_with_difference !== null && ['Lines with a difference', num(count.lines_with_difference)],
    !sheet && count.shortage_value !== null && ['Shortage / overage at cost', `${rwf(count.shortage_value)} / ${rwf(count.overage_value)}`],
  ])];

  if (sheet) {
    content.push(heading('Count sheet'), table(
      [{ text: 'Product' }, { text: 'SKU', width: 80 }, { text: 'Location', width: 70 },
        ...(showSystem ? [{ text: 'System', align: 'right', width: 45 }] : []), { text: 'Counted', align: 'right', width: 60 }, { text: 'Note', width: 110 }],
      count.lines.map((l) => [l.product_name, l.sku, loc(l), ...(showSystem ? [num(l.expected_qty)] : []), l.counted_qty === null ? ' ' : num(l.counted_qty), ' ']),
    ), note(count.blind ? 'Blind count: write what you physically see. System quantities are not shown on purpose.' : 'System quantities as expected now (stock at the start plus movements since).'));
  } else {
    const diff = count.lines.filter((l) => l.variance);
    content.push(heading('Differences'), table(
      [{ text: 'Product' }, { text: 'Location', width: 65 }, { text: 'Expected', align: 'right', width: 50 }, { text: 'Counted', align: 'right', width: 48 },
        { text: 'Difference', align: 'right', width: 55 }, { text: 'Value at cost', align: 'right', width: 70 }, { text: 'Reason', width: 60 }],
      diff.map((l) => [`${l.product_name}\n${l.sku}`, loc(l), num(l.expected_qty), num(l.counted_qty), l.variance > 0 ? `+${l.variance}` : String(l.variance),
        signedRwf(l.variance_value), `${l.reason || '—'}${l.note ? `: ${l.note}` : ''}`]),
    ), note(`${count.lines.length - diff.length} other line(s) matched exactly. Expected = stock at the start of the count plus every movement since, so sales made during the count are not differences.`));
  }
  const doc = pdf.layout({
    business, title: sheet ? 'Stock count sheet' : 'Stock count - differences', subtitle: count.number,
    meta: [['Count', count.number], ['Blind', count.blind ? 'Yes' : 'No']], content: content.filter(Boolean), generatedBy, timezone: tz,
  });
  return { model: count, pdf: await pdf.render(doc), filename: `${count.number}-${sheet ? 'sheet' : 'differences'}.pdf` };
}

module.exports = { stockCountDocument };
