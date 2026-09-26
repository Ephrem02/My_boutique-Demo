/** Heading block for a section inside the Admin area (the area has the page title). */
export default function AdminSection({ title, description, actions, children }) {
  return (
    <section className="admin-section" aria-labelledby="admin-section-title">
      <div className="admin-section-header">
        <div>
          <h2 id="admin-section-title">{title}</h2>
          {description && <p className="page-subtitle">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
