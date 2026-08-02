import Topbar from "../../layouts/Topbar";

function DashboardPage() {
  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle="Accounts Payable Overview"
        actionLabel="New Invoice"
        onAction={() => alert("Coming Soon")}
      />

      <section className="cards">
        <div className="card">
          <p>Total Payables</p>
          <h3>$12,450.00</h3>
        </div>

        <div className="card danger">
          <p>Overdue Invoices</p>
          <h3>$2,180.00</h3>
        </div>

        <div className="card warning">
          <p>Due This Week</p>
          <h3>8</h3>
        </div>

        <div className="card success">
          <p>Paid This Month</p>
          <h3>$6,740.00</h3>
        </div>
      </section>

      <section className="panel">
        <h3>Welcome to SINTECH ERP</h3>

        <p>
          Version 0.1 Foundation
        </p>

        <p>
          This dashboard will become the executive control center of the
          entire ERP.
        </p>
      </section>
    </>
  );
}

export default DashboardPage;