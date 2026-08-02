import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import DashboardPage from "./modules/dashboard/DashboardPage";
import SuppliersPage from "./modules/suppliers/SuppliersPage";
import "./App.css";

function PlaceholderPage({ title }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p>This module is under development.</p>
    </section>
  );
}

function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/invoices" element={<PlaceholderPage title="Invoices" />} />
        <Route path="/payments" element={<PlaceholderPage title="Payments" />} />
        <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
        <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default App;