import { supabase } from "../lib/supabase";

const TABLE_NAME = "Suppliers";

export async function getSuppliers() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function createSupplier(supplierData) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert([supplierData])
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateSupplier(id, supplierData) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(supplierData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteSupplier(id) {
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}