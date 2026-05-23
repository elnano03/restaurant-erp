import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import {
  LayoutDashboard,
  FileText,
  Users,
  CreditCard,
  BarChart3,
  Settings,
} from "lucide-react";
import "./App.css";

function App() {
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    getSuppliers();
  }, []);

  async function getSuppliers() {
    const { data, error } = await supabase
      .from("Suppliers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading suppliers:", error);
      return;
    }

    setSuppliers(data || []);
  }

  return (
    <div className="erp-container">
      <aside className="sidebar">
        <div className="brand">
          <h1>Restaurant ERP</h1>
          <p>Cuentas por Pagar</p>
        </div>

        <nav className="menu">
          <a className="active"><LayoutDashboard size={20} /> Dashboard</a>
          <a><Users size={20} /> Suplidores</a>
          <a><FileText size={20} /> Facturas</a>
          <a><CreditCard size={20} /> Pagos</a>
          <a><BarChart3 size={20} /> Reportes</a>
          <a><Settings size={20} /> Configuración</a>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h2>Dashboard</h2>
            <p>Resumen general de cuentas por pagar</p>
          </div>
          <button>Nueva Factura</button>
        </header>

        <section className="cards">
          <div className="card">
            <p>Total por pagar</p>
            <h3>$12,450.00</h3>
          </div>
          <div className="card danger">
            <p>Facturas vencidas</p>
            <h3>$2,180.00</h3>
          </div>
          <div className="card warning">
            <p>Vencen esta semana</p>
            <h3>8</h3>
          </div>
          <div className="card success">
            <p>Pagado este mes</p>
            <h3>$6,740.00</h3>
          </div>
        </section>

        <section className="panel">
          <h3>Suplidores desde Supabase</h3>

          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Balance</th>
                <th>Estado</th>
              </tr>
            </thead>

            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>{supplier.business_name}</td>
                  <td>{supplier.category}</td>
                  <td>{supplier.phone}</td>
                  <td>{supplier.email}</td>
                  <td>${supplier.balance}</td>
                  <td>{supplier.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

export default App;