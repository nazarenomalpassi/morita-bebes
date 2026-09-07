export default function ManagementLoading() {
  return (
    <div className="page-container" aria-live="polite" aria-busy="true">
      <div className="loading-line loading-line-short" />
      <div className="loading-line loading-line-title" />
      <div className="loading-line loading-line-lead" />
      <div className="loading-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="loading-card" key={index} />
        ))}
      </div>
      <span className="sr-only">Cargando información</span>
    </div>
  );
}

