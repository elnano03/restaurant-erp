import { useEffect, useState } from "react";
import { X } from "lucide-react";

const emptyForm = {
  business_name: "",
  phone: "",
  email: "",
  category: "",
  status: "Active",
  balance: 0,
};

function SupplierModal({
  isOpen,
  supplier,
  onClose,
  onSave,
}) {
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (supplier) {
      setFormData({
        business_name: supplier.business_name || "",
        phone: supplier.phone || "",
        email: supplier.email || "",
        category: supplier.category || "",
        status: supplier.status || "Active",
        balance: supplier.balance || 0,
      });
    } else {
      setFormData(emptyForm);
    }

    setFormError("");
  }, [supplier, isOpen]);

  if (!isOpen) {
    return null;
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");

    if (!formData.business_name.trim()) {
      setFormError("Business Name is required.");
      return;
    }

    const normalizedData = {
      ...formData,
      business_name: formData.business_name.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      category: formData.category.trim(),
      balance: Number(formData.balance) || 0,
    };

    try {
      setIsSaving(true);
      await onSave(normalizedData);
    } catch (error) {
      setFormError(error.message || "Unable to save supplier.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h2>{supplier ? "Edit Supplier" : "New Supplier"}</h2>
            <p>
              {supplier
                ? "Update the supplier information."
                : "Add a new restaurant supplier."}
            </p>
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-field full-width">
              <label htmlFor="business_name">
                Business Name
              </label>

              <input
                id="business_name"
                name="business_name"
                type="text"
                value={formData.business_name}
                onChange={handleChange}
                placeholder="Example: Restaurant Depot"
                autoFocus
              />
            </div>

            <div className="form-field">
              <label htmlFor="phone">Phone Number</label>

              <input
                id="phone"
                name="phone"
                type="text"
                value={formData.phone}
                onChange={handleChange}
                placeholder="610-555-0000"
              />
            </div>

            <div className="form-field">
              <label htmlFor="email">Email Address</label>

              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="supplier@example.com"
              />
            </div>

            <div className="form-field">
              <label htmlFor="category">Category</label>

              <input
                id="category"
                name="category"
                type="text"
                value={formData.category}
                onChange={handleChange}
                placeholder="Food, Maintenance, Utilities..."
              />
            </div>

            <div className="form-field">
              <label htmlFor="status">Status</label>

              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Blocked">Blocked</option>
              </select>
            </div>

            <div className="form-field full-width">
              <label htmlFor="balance">
                Opening Balance
              </label>

              <input
                id="balance"
                name="balance"
                type="number"
                min="0"
                step="0.01"
                value={formData.balance}
                onChange={handleChange}
              />
            </div>
          </div>

          {formError && (
            <div className="form-error">
              {formError}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>

            <button type="submit" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : supplier
                  ? "Update Supplier"
                  : "Save Supplier"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SupplierModal;