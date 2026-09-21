import { useEffect, useRef } from "react";
import { X, Search, FileText } from "lucide-react";
export function Button({ children, kind = "", className = "", ...props }) {
  return (
    <button className={`button ${kind} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Badge({ children }) {
  return (
    <span className={"badge " + String(children).toLowerCase()}>
      {children}
    </span>
  );
}
export function Empty({ title = "Nothing here yet", children, action }) {
  return (
    <div className="empty">
      <FileText size={34} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({ label, children, wide = false, hint }) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SearchBox({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  busy = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement,
      d = ref.current;
    d.showModal();
    const el = d.querySelector("input,select,textarea,button");
    el?.focus();
    return () => {
      d.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal large" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <Button
          kind="icon ghost"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Pagination({ page, setPage, total, size = 15 }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {total} records · Page {Math.min(page, pages)} of {pages}
      </span>
      <div>
        <Button
          kind="ghost"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          kind="ghost"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function Stat({ label, value, hint, icon: Icon, tone = "" }) {
  return (
    <div className={"stat " + tone}>
      <div className="stat-top">
        <span>{label}</span>
        {Icon && <Icon size={19} />}
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
