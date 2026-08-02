import { Pencil, Trash2 } from "lucide-react";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

function SupplierTable({
  suppliers,
  isLoading,
  onEdit,
  onDelete,
}) {
  if (isLoading) {
    return (
      <div className="table-message">
        Loading suppliers...
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="table-message">
        No suppliers found. Add your first supplier.
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Business Name</th>
            <th>Category</th>
            <th>Phone Number</th>
            <th>Email Address</th>
            <th>Balance</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {suppliers.map((supplier) => (
            <tr key={supplier.id}>
              <td>
                <strong>{supplier.business_name}</strong>
              </td>

              <td>{supplier.category || "Uncategorized"}</td>
              <td>{supplier.phone || "—"}</td>
              <td>{supplier.email || "—"}</td>
              <td>{formatCurrency(supplier.balance)}</td>

              <td>
                <span
                  className={`status-badge status-${String(
                    supplier.status || "active"
                  ).toLowerCase()}`}
                >
                  {supplier.status || "Active"}
                </span>
              </td>

              <td>
                <div className="table-actions">
                  <button
                    type="button"
                    className="edit-button"
                    onClick={() => onEdit(supplier)}
                  >
                    <Pencil size={15} />
                    Edit
                  </button>

                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => onDelete(supplier)}
                  >
                    <Trash2 size={15} />
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default SupplierTable;