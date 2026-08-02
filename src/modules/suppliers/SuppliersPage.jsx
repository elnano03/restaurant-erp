import Topbar from "../../layouts/Topbar";

function SuppliersPage() {
  return (
    <>
      <Topbar
        title="Suppliers"
        subtitle="Manage restaurant vendors and outstanding balances"
        actionLabel="New Supplier"
        onAction={() => alert("Supplier form coming next")}
      />

      <section className="panel">
        <h3>Suppliers Module</h3>
        <p>The existing supplier CRUD will be migrated here next.</p>
      </section>
    </>
  );
}

export default SuppliersPage;