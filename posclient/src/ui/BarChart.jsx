/**
 * Minimal accessible bar chart (no chart library). Visual bars are hidden
 * from assistive tech; the same data is exposed as a visually hidden table.
 * data: [{ label, value, tone? }]
 */
export default function BarChart({ data, format = String, caption, height = 160 }) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  return (
    <figure className="bar-chart">
      <div className="bar-chart-plot" style={{ height }} aria-hidden="true">
        {data.map((d) => (
          <div key={d.label} className="bar-chart-col" title={`${d.label}: ${format(d.value)}`}>
            <div className={`bar-chart-bar${d.tone ? ` tone-${d.tone}` : ''}`} style={{ height: `${Math.max(2, ((Number(d.value) || 0) / max) * 100)}%` }} />
            <span className="bar-chart-label">{d.shortLabel || d.label}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>
          ))}
        </tbody>
      </table>
      {caption && <figcaption className="bar-chart-caption">{caption}</figcaption>}
    </figure>
  );
}
