import Sidebar from "./Sidebar";

function AppLayout({ children }) {
  return (
    <div className="erp-container">
      <Sidebar />

      <main className="main">
        {children}
      </main>
    </div>
  );
}

export default AppLayout;