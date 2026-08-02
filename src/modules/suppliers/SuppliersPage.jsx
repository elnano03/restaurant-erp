import { useEffect, useState } from "react";
import Topbar from "../../layouts/Topbar";
import {
  createSupplier,
  deleteSupplier,
  getSuppliers,
  updateSupplier,
} from "../../services/supplierService";
import SupplierModal from "./SupplierModal";
import SupplierTable from "./SupplierTable";

function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    loadSuppliers();
  }, []);

  async function loadSuppliers() {
    try {
      setIsLoading(true);
      setPageError("");

      const supplierList = await getSuppliers();
      setSuppliers(supplierList);
    } catch (error) {
      console.error("Unable to load suppliers:", error);
      setPageError(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function openCreateModal() {
    setSelectedSupplier(null);
    setIsModalOpen(true);
  }

  function openEditModal(supplier) {
    setSelectedSupplier(supplier);
    setIsModalOpen(true);
  }

  function closeModal() {
    setSelectedSupplier(null);
    setIsModalOpen(false);
  }

  async function handleSaveSupplier(supplierData) {
    if (selectedSupplier) {
      await updateSupplier(selectedSupplier.id, supplierData);
    } else {
      await createSupplier(supplierData);
    }

    closeModal();
    await loadSuppliers();
  }

  async function handleDeleteSupplier(supplier) {
    const confirmed = window.confirm(
      `Are you sure you want to delete ${supplier.business_name}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setPageError("");
      await deleteSupplier(supplier.id);
      await loadSuppliers();
    } catch (error) {
      console.error("Unable to delete supplier:", error);
      setPageError(error.message);
    }
  }

  return (
    <>
      <Topbar
        title="Suppliers"
        subtitle="Manage restaurant vendors and outstanding balances"
        actionLabel="New Supplier"
        onAction={openCreateModal}
      />

      {pageError && (
        <div className="page-error">
          <strong>Something went wrong.</strong>
          <span>{pageError}</span>
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Supplier Directory</h3>
            <p>
              {suppliers.length} supplier
              {suppliers.length === 1 ? "" : "s"} registered
            </p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={loadSuppliers}
          >
            Refresh
          </button>
        </div>

        <SupplierTable
          suppliers={suppliers}
          isLoading={isLoading}
          onEdit={openEditModal}
          onDelete={handleDeleteSupplier}
        />
      </section>

      <SupplierModal
        isOpen={isModalOpen}
        supplier={selectedSupplier}
        onClose={closeModal}
        onSave={handleSaveSupplier}
      />
    </>
  );
}

export default SuppliersPage;