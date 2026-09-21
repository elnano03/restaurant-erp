import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <main className="center-screen">
          <section className="panel">
            <h1>We couldn't open the workspace</h1>
            <p>{this.state.error.message}</p>
            <p>
              Your stored records have not been cleared. Please keep a copy
              before troubleshooting.
            </p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
