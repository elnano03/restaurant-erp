function Topbar({ title, subtitle, actionLabel, onAction }) {
  return (
    <header className="topbar">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {actionLabel && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </header>
  );
}

export default Topbar;