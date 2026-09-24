import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Users,
  CreditCard,
  BarChart3,
  Settings as SettingsIcon,
  RefreshCw,
  LogOut,
  Menu,
  ArrowRight,
  ShieldCheck,
  Database,
  Cloud,
  ChefHat,
} from "lucide-react";
import {
  cloud,
  load,
  execute,
  KEY,
  DEMO_KEY,
  restoreLocal,
  passwordLink,
} from "./core/repository";
import { uid, VERSION, today, dateLabel } from "./core/domain";
import {
  Dashboard,
  Suppliers,
  Invoices,
  Payments,
  Reports,
  Audit,
  Settings,
} from "./ui/pages";
import {
  SupplierDialog,
  InvoiceDialog,
  PaymentDialog,
  ConfirmDialog,
  InvoiceDetail,
} from "./ui/dialogs";
import { Button, Field } from "./ui/common";
import "./App.css";
import { MODULES, moduleFor } from "./core/modules";
import {
  StockDesk,
  StockCounts,
  MovementLedger,
  PayablesDesk,
  PurchasingDesk,
} from "./ui/pro";
import { Recipes, Kitchen } from "./ui/kitchen";
import { InvoiceImport, Inventory } from "./ui/invoice-import";
import {
  Categories,
  BusinessUsers,
  Credits,
  PaymentPlanner,
  HistoricalReports,
  Purchasing,
  Documents,
  SupplierProfile,
  BackupsAccount,
} from "./ui/operations";

const moduleIcons = {
  overview: LayoutDashboard,
  inventory: Database,
  purchasing: Users,
  payables: CreditCard,
  kitchen: ChefHat,
  reports: BarChart3,
  administration: SettingsIcon,
};
const links = MODULES.flatMap((m) => m.pages);

function Welcome({ choose }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await cloud.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      choose("cloud");
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    try {
      if (!email) throw new Error("Enter your email first.");
      const { error } = await cloud.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      setMessage(
        "If this account exists, a password reset email will arrive shortly.",
      );
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={cloud ? "welcome cloud-first" : "welcome"}>
      <section className="welcome-story">
        <div className="logo">
          <span className="logo-mark">
            <ChefHat size={23} />
          </span>
          <strong>
            SINTECH<span>RESTAURANT ERP</span>
          </strong>
        </div>
        <div>
          <p className="eyebrow">LESS ADMIN. MORE RESTAURANT.</p>
          <h1>
            Your finances,
            <br />
            in good order.
          </h1>
          <p>
            From your first supplier to your last payment of the month. One
            clear place to manage it all.
          </p>
          <div className="welcome-features">
            <span>
              <ShieldCheck size={20} />A complete payment history
            </span>
            <span>
              <FileText size={20} />
              Invoices, approvals and reports
            </span>
            <span>
              <Database size={20} />
              Your data, ready to export
            </span>
          </div>
        </div>
        <small>ACCOUNTS PAYABLE · VERSION {VERSION}</small>
      </section>
      <section className="welcome-options">
        <div>
          <p className="eyebrow">WELCOME TO YOUR WORKSPACE</p>
          <h2>Let's get to work.</h2>
          <p>Choose how you want to use SINTECH.</p>
          <button className="mode-card" onClick={() => choose("local")}>
            <Database />
            <div>
              <strong>Open local workspace</strong>
              <span>
                Use on this computer. Saved in this browser.
                <br />
                No account needed; export backups regularly.
              </span>
            </div>
            <ArrowRight size={18} />
          </button>
          <button className="mode-card" onClick={() => choose("demo")}>
            <BarChart3 />
            <div>
              <strong>Explore with sample data</strong>
              <span>A separate space to try every workflow.</span>
            </div>
            <ArrowRight size={18} />
          </button>
          <div className="divider">
            <span>SHARED WORKSPACE</span>
          </div>
          {cloud ? (
            <form onSubmit={login}>
              <Field label="Email">
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Button disabled={busy}>
                <Cloud size={17} />
                {busy ? "Signing in…" : "Sign in to Supabase"}
              </Button>
              <Button
                type="button"
                kind="ghost"
                onClick={reset}
                disabled={busy}
              >
                Forgot password?
              </Button>
            </form>
          ) : (
            <p className="cloud-note">
              <Cloud size={20} />
              Shared access is ready to configure. Add the Supabase project
              settings to enable secure sign-in.
            </p>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {message && <div className="alert success">{message}</div>}
        </div>
      </section>
    </div>
  );
}
function PasswordRecovery({ done }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await cloud.auth.updateUser({ password });
      if (error) throw error;
      done();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="center-screen">
      <section className="panel">
        <h1>Set your password</h1>
        <form onSubmit={submit}>
          <Field label="New password (at least 12 characters)">
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button disabled={busy}>{busy ? "Saving…" : "Save password"}</Button>
        </form>
      </section>
    </div>
  );
}
function App() {
  const [mode, setMode] = useState(
      () => sessionStorage.getItem("sintech-mode") || "",
    ),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [navOpen, setNavOpen] = useState(false),
    [recovery, setRecovery] = useState(passwordLink),
    [online, setOnline] = useState(navigator.onLine),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const nav = useNavigate(),
    location = useLocation(),
    loadSequence = useRef(0),
    pending = useRef(
      JSON.parse(sessionStorage.getItem("sintech-pending") || "null"),
    );
  const path = location.pathname,
    canWrite =
      mode !== "cloud" || ["admin", "accountant"].includes(state?.role),
    isAdmin = mode !== "cloud" || state?.role === "admin";
  const refresh = useCallback(async () => {
    if (!mode) return;
    const seq = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      if (mode === "cloud" && !cloud)
        throw new Error("Supabase is not configured.");
      const data = await load(mode);
      if (seq === loadSequence.current) setState(data);
    } catch (e) {
      if (seq === loadSequence.current) setError(e.message);
    } finally {
      if (seq === loadSequence.current) setLoading(false);
    }
  }, [mode]);
  // Load from an external repository whenever the workspace changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!cloud) return;
    const { data } = cloud.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        setMode("");
        setState(null);
        sessionStorage.removeItem("sintech-mode");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    function changed(e) {
      if (e.key === KEY || e.key === DEMO_KEY) refresh();
    }
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  function choose(value) {
    setState(null);
    if (pending.current?.mode !== value) pending.current = null;
    setMode(value);
    sessionStorage.setItem("sintech-mode", value);
    nav("/dashboard");
  }
  async function leave() {
    if (saving) return;
    ++loadSequence.current;
    if (mode === "cloud") await cloud.auth.signOut();
    sessionStorage.removeItem("sintech-mode");
    setMode("");
    setState(null);
    setModal(null);
    setError("");
  }
  function navigate(url) {
    setNavOpen(false);
    nav(url);
  }
  async function submit(type, payload) {
    const business_id =
      mode === "cloud" ? sessionStorage.getItem("sintech-business") : undefined;
    const signature = JSON.stringify([mode, business_id, type, payload]);
    // Keep the request ID after a failed response to make retries safe.
    const command =
      pending.current?.signature === signature
        ? pending.current.command
        : { id: uid(), type, payload, business_id };
    pending.current = { signature, command, mode };
    sessionStorage.setItem("sintech-pending", JSON.stringify(pending.current));
    ++loadSequence.current;
    setSaving(true);
    try {
      const data = await execute(mode, command);
      setState(data);
      setError("");
      setLoading(false);
      pending.current = null;
      sessionStorage.removeItem("sintech-pending");
      setToast("Saved successfully.");
      return data;
    } finally {
      setSaving(false);
    }
  }
  const close = () => setModal(null),
    open = (value) => setModal(value);
  if (recovery)
    return (
      <PasswordRecovery
        done={() => {
          setRecovery(false);
          choose("cloud");
        }}
      />
    );
  if (!mode) return <Welcome choose={choose} />;
  const props = {
    initialDocumentId:
      new URLSearchParams(location.search).get("document") || "",
    state,
    open,
    canWrite,
    isAdmin,
    navigate,
    onSubmit: submit,
    reload: refresh,
  };
  let content = null;
  if (state) {
    const extras = {
      "/categories": Categories,
      "/stock": StockDesk,
      "/stock-counts": StockCounts,
      "/stock-movements": MovementLedger,
      "/payables": PayablesDesk,
      "/procurement": PurchasingDesk,
      "/quotes": Purchasing,
      "/orders": Purchasing,
      "/inventory": Inventory,
      "/recipes": Recipes,
      "/kitchen": Kitchen,
      "/invoice-import": InvoiceImport,
      "/businesses": BusinessUsers,
      "/credits": Credits,
      "/planner": PaymentPlanner,
      "/purchasing": Purchasing,
      "/historical": HistoricalReports,
      "/supplier-profile": SupplierProfile,
      "/backups": BackupsAccount,
    };
    const Extra = extras[path];
    if (Extra)
      content =
        mode === "cloud" ? (
          <Extra
            key={state.business_id + path}
            {...props}
            initialTab={
              path === "/orders"
                ? "Orders"
                : path === "/quotes"
                  ? "Prices"
                  : "Compare"
            }
            hideTabs
          />
        ) : (
          <section className="panel">
            <h2>Shared workspace feature</h2>
            <p>
              Sign in to your shared workspace to use business categories,
              purchasing and the new controls. Your local records remain
              available in the original modules.
            </p>
            <Button onClick={leave}>Go to sign in</Button>
          </section>
        );
    else if (path === "/documents")
      content =
        mode === "cloud" ? (
          <Documents
            key={state.business_id + location.search}
            {...props}
            initialType={
              ["supplier", "invoice", "payment", "order", "credit"].includes(
                new URLSearchParams(location.search).get("type"),
              )
                ? new URLSearchParams(location.search).get("type")
                : "invoice"
            }
            initialId={new URLSearchParams(location.search).get("id") || ""}
          />
        ) : (
          <p>Documents require a shared workspace.</p>
        );
    else if (path === "/suppliers") content = <Suppliers {...props} />;
    else if (path === "/invoices") content = <Invoices {...props} />;
    else if (path === "/payments") content = <Payments {...props} />;
    else if (path === "/reports")
      content = (
        <Reports
          key={location.search}
          state={state}
          initialSupplier={
            new URLSearchParams(location.search).get("supplier") || ""
          }
        />
      );
    else if (path === "/activity") content = <Audit state={state} />;
    else if (path === "/settings")
      content = (
        <Settings {...props} mode={mode} onSubmit={submit} reload={refresh} />
      );
    else content = <Dashboard {...props} />;
  }
  const inv = state?.invoices.find((i) => i.id === modal?.id),
    pay = state?.payments.find((p) => p.id === modal?.id);
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (navOpen ? "open" : "")}>
        <a href="#/dashboard" className="logo">
          <span className="logo-mark">
            <ChefHat size={23} />
          </span>
          <strong>
            SINTECH<span>RESTAURANT ERP</span>
          </strong>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-business">
          {state?.settings.business_name || "Accounts payable"}
        </div>
        {mode === "cloud" && state?.businesses && (
          <select
            className="business-select"
            disabled={saving || loading}
            aria-label="Current business"
            value={state.business_id}
            onChange={async (e) => {
              sessionStorage.setItem("sintech-business", e.target.value);
              pending.current = null;
              sessionStorage.removeItem("sintech-pending");
              setState(null);
              setModal(null);
              await refresh();
            }}
          >
            {state.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <nav aria-label="Main navigation">
          {MODULES.map((m) => {
            const Icon = moduleIcons[m.id];
            return (
              <button
                key={m.id}
                className={
                  "nav-item " + (moduleFor(path).id === m.id ? "selected" : "")
                }
                aria-current={moduleFor(path).id === m.id ? "page" : undefined}
                onClick={() => navigate(m.home)}
              >
                <Icon size={19} />
                {m.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="version">
            RESTAURANT ERP <span>v{VERSION}</span>
          </div>
          <Button kind="ghost" disabled={saving} onClick={leave}>
            <LogOut size={17} />
            {mode === "cloud" ? "Sign out" : "Switch workspace"}
          </Button>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="main-area">
        <header className="topbar">
          <div>
            <Button
              kind="icon ghost mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setNavOpen(!navOpen)}
            >
              <Menu size={21} />
            </Button>
            <span className="breadcrumb">
              Workspace <span>/</span>{" "}
              {links.find((l) => l[0] === path)?.[1] || "Overview"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="today">{dateLabel(today())}</span>
            <Button
              kind="icon ghost"
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh records"
            >
              <RefreshCw size={17} className={loading ? "spinning" : ""} />
            </Button>
            <span className="user-avatar">{mode === "cloud" ? "U" : "JO"}</span>
          </div>
        </header>
        <div className={"mode-banner " + mode}>
          {mode === "demo"
            ? "DEMO WORKSPACE · Sample records only. Your local and cloud records are separate."
            : mode === "local"
              ? "LOCAL WORKSPACE · Saved in this browser. Download backups in Settings."
              : "SHARED WORKSPACE · Supabase · " +
                (state?.role || "Verifying access")}
        </div>
        {!online && mode === "cloud" && (
          <div className="connection-note" role="alert">
            Offline: displayed records may be outdated. Changes are not saved
            until the server confirms them.
          </div>
        )}
        <nav
          className="module-tabs"
          aria-label={moduleFor(path).label + " sections"}
        >
          {moduleFor(path).pages.map(([url, label]) => (
            <button
              key={url}
              aria-current={path === url ? "page" : undefined}
              className={path === url ? "active" : ""}
              onClick={() => navigate(url)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main>
          {error && (
            <div className="alert error" role="alert">
              <strong>Unable to load records.</strong> {error}
              <Button kind="ghost" onClick={refresh}>
                Retry
              </Button>
              <Button kind="ghost" disabled={saving} onClick={leave}>
                Switch workspace
              </Button>
            </div>
          )}
          {!state && !error ? (
            <div className="center-screen">Loading your workspace…</div>
          ) : (
            content
          )}
        </main>
        <footer className="app-footer">
          SINTECH ERP <span>Operations · USD · Eastern Time</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {toast}
        </div>
      )}
      {state && modal?.kind === "supplier" && (
        <SupplierDialog
          supplier={state.suppliers.find((s) => s.id === modal.id)}
          state={state}
          onClose={close}
          onSubmit={submit}
        />
      )}
      {state && modal?.kind === "invoice" && (
        <InvoiceDialog
          invoice={inv}
          state={state}
          onClose={close}
          onSubmit={submit}
        />
      )}
      {inv && modal?.kind === "payment" && (
        <PaymentDialog
          invoice={inv}
          state={state}
          onClose={close}
          onSubmit={submit}
        />
      )}
      {inv && modal?.kind === "detail" && (
        <InvoiceDetail
          invoice={inv}
          state={state}
          onClose={close}
          canWrite={canWrite}
          isAdmin={isAdmin}
          onEdit={() => open({ kind: "invoice", id: inv.id })}
          onPay={() => open({ kind: "payment", id: inv.id })}
          onApprove={() => open({ kind: "approve", id: inv.id })}
          onVoid={() => open({ kind: "void", id: inv.id })}
        />
      )}
      {inv && modal?.kind === "approve" && (
        <ConfirmDialog
          title="Approve invoice"
          message={`Approve ${inv.number}? The amount will become payable and its financial fields will be locked. You can void it later if it has no active payments.`}
          onClose={close}
          onConfirm={() =>
            submit("invoice.approve", { id: inv.id, version: inv.version })
          }
        />
      )}
      {inv && modal?.kind === "void" && (
        <ConfirmDialog
          title="Void invoice"
          message="The invoice will stay in the history but will no longer affect outstanding balances."
          reason
          onClose={close}
          onConfirm={(reason) =>
            submit("invoice.void", { id: inv.id, version: inv.version, reason })
          }
        />
      )}
      {pay && modal?.kind === "reverse" && (
        <ConfirmDialog
          title="Reverse payment record"
          message="This restores the invoice's outstanding balance. It does not reverse an actual bank transaction."
          reason
          onClose={close}
          onConfirm={(reason) =>
            submit("payment.reverse", { id: pay.id, reason })
          }
        />
      )}
      {modal?.kind === "restore" && (
        <ConfirmDialog
          title="Restore local backup"
          message="Replace this workspace's records with the backup? Download your current backup first. A recovery copy will also be retained in this browser."
          onClose={close}
          onConfirm={async () => {
            await restoreLocal(modal.data, mode);
            await refresh();
            setToast("Backup restored.");
          }}
        />
      )}
    </div>
  );
}
export default App;
