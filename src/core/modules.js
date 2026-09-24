export const MODULES = [
  {
    id: "overview",
    label: "Overview",
    home: "/dashboard",
    pages: [["/dashboard", "Overview"]],
  },
  {
    id: "inventory",
    label: "Inventory",
    home: "/stock",
    pages: [
      ["/stock", "Stock overview"],
      ["/inventory", "Products & receipts"],
      ["/stock-counts", "Physical counts"],
      ["/stock-movements", "Movement ledger"],
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    home: "/procurement",
    pages: [
      ["/procurement", "Purchasing desk"],
      ["/purchasing", "Compare prices"],
      ["/quotes", "Supplier prices"],
      ["/orders", "Purchase orders"],
      ["/suppliers", "Suppliers"],
      ["/supplier-profile", "Supplier profile"],
      ["/categories", "Categories"],
    ],
  },
  {
    id: "payables",
    label: "Accounts payable",
    home: "/payables",
    pages: [
      ["/payables", "Payables desk"],
      ["/invoices", "Invoices"],
      ["/invoice-import", "Import invoice"],
      ["/payments", "Payments"],
      ["/credits", "Credits & returns"],
      ["/planner", "Payment planner"],
      ["/documents", "Documents"],
    ],
  },
  {
    id: "kitchen",
    label: "Kitchen",
    home: "/recipes",
    pages: [
      ["/recipes", "Recipes & costs"],
      ["/kitchen", "Kitchen usage"],
    ],
  },
  {
    id: "reports",
    label: "Reports",
    home: "/reports",
    pages: [
      ["/reports", "Current reports"],
      ["/historical", "Historical reports"],
      ["/activity", "Activity log"],
    ],
  },
  {
    id: "administration",
    label: "Administration",
    home: "/businesses",
    pages: [
      ["/businesses", "Businesses & users"],
      ["/backups", "Backups & account"],
      ["/settings", "Settings"],
    ],
  },
];
export const moduleFor = (path) =>
  MODULES.find((m) => m.pages.some(([url]) => url === path)) || MODULES[0];
