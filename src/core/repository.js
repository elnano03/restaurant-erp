import { createClient } from "@supabase/supabase-js";
import { applyCommand, emptyState, demoState, validateBackup } from "./domain";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Preserve the intent before the Auth SDK consumes the URL fragment.
export const passwordLink = /(?:[&#?])type=(recovery|invite)(?:&|$)/.test(
  window.location.hash,
);
export const cloud = url && key ? createClient(url, key) : null;
export const KEY = "sintech-ap-v1-local";
export const DEMO_KEY = "sintech-ap-v1-demo";
export function readLocal(mode) {
  const key = mode === "demo" ? DEMO_KEY : KEY,
    raw = localStorage.getItem(key);
  if (raw) return validateBackup(JSON.parse(raw));
  const initial = mode === "demo" ? demoState() : emptyState();
  localStorage.setItem(key, JSON.stringify(initial));
  return initial;
}
export async function load(mode) {
  if (mode !== "cloud") return readLocal(mode);
  const { data, error } = await cloud.rpc("ap_snapshot");
  if (error) throw error;
  return data;
}
export async function execute(mode, command) {
  if (mode === "cloud") {
    const { data, error } = await cloud.rpc("ap_command", {
      request_id: command.id,
      action: command.type,
      payload: command.payload,
    });
    if (error) throw error;
    return data;
  }
  if (!navigator.locks)
    throw new Error(
      "Use localhost or HTTPS in a current Chrome or Edge browser to safely save local records.",
    );
  return navigator.locks.request("sintech-ap-" + mode, async () => {
    const result = applyCommand(readLocal(mode), command);
    localStorage.setItem(
      mode === "demo" ? DEMO_KEY : KEY,
      JSON.stringify(result),
    );
    return result;
  });
}
export async function restoreLocal(state, mode) {
  validateBackup(state);
  if (!navigator.locks)
    throw new Error("Local restore requires localhost or HTTPS.");
  return navigator.locks.request("sintech-ap-" + mode, async () => {
    const key = mode === "demo" ? DEMO_KEY : KEY;
    localStorage.setItem(
      key + "-before-restore",
      localStorage.getItem(key) || JSON.stringify(emptyState()),
    );
    localStorage.setItem(key, JSON.stringify(state));
  });
}
