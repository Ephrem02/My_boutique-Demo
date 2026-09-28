// PDF rendering for printable documents (pdfmake, server-side, no browser).
//
// Every document is built from a data model the backend computed from
// authoritative records; this file only lays it out: business header,
// title, period/filters, tables with repeating header rows, and a footer
// with "Page x of y", the generation time and who generated it.
const PdfPrinter = require('pdfmake');
const vfs = require('pdfmake/build/vfs_fonts');

const font = (name) => Buffer.from(vfs[name], 'base64');
const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
});

const MUTED = '#5f6672';
const RULE = '#d5d9e0';

const rwf = (v) => (v === null || v === undefined || v === '' ? '—' : `RWF ${Math.round(Number(v)).toLocaleString('en-US')}`);
const signedRwf = (v) => (Number(v) > 0 ? `+${rwf(v)}` : Number(v) < 0 ? `-${rwf(Math.abs(v))}` : rwf(0));
const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'));
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 1000) / 10}%`);

/** Date/time in the shop's timezone, e.g. "28 Sep 2026, 14:05". */
function when(value, timezone, { time = true } = {}) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric', ...(time && { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  }).format(d);
}

/** A table whose header row repeats on every page. cols: [{ text, align?, width? }] */
function table(cols, rows, { total } = {}) {
  const head = cols.map((c) => ({ text: c.text, style: 'th', alignment: c.align || 'left' }));
  const body = rows.map((r) => r.map((cell, i) => (typeof cell === 'object' && cell !== null && !Array.isArray(cell)
    ? { alignment: cols[i].align || 'left', ...cell }
    : { text: cell === null || cell === undefined ? '—' : String(cell), alignment: cols[i].align || 'left' })));
  if (total) body.push(total.map((cell, i) => ({ text: cell ?? '', bold: true, alignment: cols[i].align || 'left' })));
  if (!body.length) body.push([{ text: 'Nothing recorded.', colSpan: cols.length, color: MUTED, italics: true }, ...cols.slice(1).map(() => '')]);
  return {
    table: { headerRows: 1, dontBreakRows: true, widths: cols.map((c) => c.width || '*'), body: [head, ...body] },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => RULE,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 10],
  };
}

/** Label/value pairs in two columns. */
function pairs(items) {
  const list = items.filter(Boolean);
  return {
    table: { widths: ['*', 'auto'], body: list.map(([label, value, opts = {}]) => [{ text: label, color: MUTED }, { text: String(value ?? '—'), alignment: 'right', bold: !!opts.bold }]) },
    layout: { hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.3), vLineWidth: () => 0, hLineColor: () => RULE, paddingTop: () => 2, paddingBottom: () => 2 },
    margin: [0, 0, 0, 10],
  };
}

const heading = (text) => ({ text, style: 'h2' });
const note = (text) => ({ text, style: 'note' });
const columns = (...cols) => ({ columns: cols.map((c) => ({ width: '*', stack: [].concat(c) })), columnGap: 18 });

/**
 * docDefinition for a document: business header, title block, content, and
 * a footer on every page. meta: [['Period', '...'], ...] shown under the title.
 */
function layout({ business, title, subtitle, meta = [], content, generatedBy, timezone, pageOrientation = 'portrait', footerNote }) {
  const identity = [business.address, [business.phone, business.email].filter(Boolean).join(' · '), business.tin ? `TIN ${business.tin}` : null].filter(Boolean);
  const generatedAt = when(new Date(), timezone);
  return {
    pageSize: 'A4',
    pageOrientation,
    pageMargins: [36, 36, 36, 48],
    info: { title, creator: business.name, producer: business.name },
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.15, color: '#1a1d23' },
    styles: {
      brand: { fontSize: 14, bold: true },
      title: { fontSize: 16, bold: true, margin: [0, 10, 0, 2] },
      subtitle: { fontSize: 10, color: MUTED, margin: [0, 0, 0, 6] },
      h2: { fontSize: 11, bold: true, margin: [0, 8, 0, 4] },
      th: { bold: true, fontSize: 8, color: MUTED },
      note: { fontSize: 8, color: MUTED, italics: true, margin: [0, 0, 0, 8] },
      small: { fontSize: 8, color: MUTED },
    },
    content: [
      {
        columns: [
          { width: '*', stack: [{ text: business.name, style: 'brand' }, ...identity.map((line) => ({ text: line, style: 'small' }))] },
          { width: 'auto', stack: meta.map(([k, v]) => ({ text: [{ text: `${k}: `, color: MUTED }, { text: String(v ?? '—'), bold: true }], alignment: 'right', fontSize: 8.5 })) },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: pageOrientation === 'landscape' ? 770 : 523, y2: 6, lineWidth: 1, lineColor: '#1a1d23' }] },
      { text: title, style: 'title' },
      subtitle ? { text: subtitle, style: 'subtitle' } : null,
      ...content,
    ].filter(Boolean),
    footer: (page, pages) => ({
      margin: [36, 12, 36, 0],
      columns: [
        { text: [footerNote || business.document_footer, `Generated ${generatedAt}${generatedBy ? ` by ${generatedBy}` : ''}`].filter(Boolean).join(' · '), style: 'small' },
        { text: `Page ${page} of ${pages}`, style: 'small', alignment: 'right', width: 'auto' },
      ],
    }),
  };
}

/** Renders a docDefinition to a Buffer. */
function render(docDefinition) {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { render, layout, table, pairs, heading, note, columns, rwf, signedRwf, num, pct, when, MUTED };
