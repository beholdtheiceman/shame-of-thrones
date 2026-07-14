import type { MeDTO } from "@sot/core";
import { API_BASE_URL } from "./config";
import { getToken, signOut } from "./auth";

export async function fetchMe(): Promise<MeDTO> {
  const token = await getToken();
  const res = await fetch(`${API_BASE_URL}/api/me`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) { await signOut(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}
