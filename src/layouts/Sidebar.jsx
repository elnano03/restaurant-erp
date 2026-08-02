import { NavLink } from "react-router-dom";
import {
  BarChart3,
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";

const menuItems = [
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Suppliers",
    path: "/suppliers",
    icon: Users,
  },
  {
    label: "Invoices",
    path: "/invoices",
    icon: FileText,
  },
  {
    label: "Payments",
    path: "/payments",
    icon: CreditCard,
  },
  {
    label: "Reports",
    path: "/reports",
    icon: BarChart3,
  },
  {
    label: "Settings",
    path: "/settings",
    icon: Settings,
  },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>SINTECH ERP</h1>
        <p>Restaurant Enterprise</p>
      </div>

      <nav className="menu">
        {menuItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={20} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <p>Version 0.1</p>
        <span>Foundation</span>
      </div>
    </aside>
  );
}

export default Sidebar;