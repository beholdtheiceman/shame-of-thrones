import type { FiefControl, RankInfo } from "./selectors";
import type { Amenities, HouseId, LedgerEntry, Rating, ThroneCategory } from "./types";

export interface ThroneDTO {
  id: string; name: string; lat: number; lng: number;
  category: ThroneCategory; status: "rumored" | "verified";
  amenities: Amenities; addedBy: string; addedAt: number; lastConfirmedAt: number;
  fiefId: string; score: number | null; ratingCount: number;
}

export interface RealmDTO {
  thrones: ThroneDTO[];
  ratings: Rating[];
  fiefs: FiefControl[];
  ledger: LedgerEntry[];
}

export interface MeDTO {
  profile: {
    name: string; houseId: HouseId; joinedAt: number;
    badges: string[]; lastHouseSwitchAt: number | null;
  } | null;
  rank?: RankInfo;
  ageGate?: { confirmed: boolean; locked: boolean };
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  }
  return res.json();
}

export const api = {
  realm: () => request<RealmDTO>("/api/realm"),
  me: () => request<MeDTO>("/api/me"),
  createProfile: (name: string, houseId: HouseId) =>
    request<{ ok: true }>("/api/profile", { method: "POST", body: JSON.stringify({ name, houseId }) }),
  switchHouse: (houseId: HouseId) =>
    request<{ ok: true }>("/api/profile", { method: "POST", body: JSON.stringify({ houseId }) }),
  ageGate: (birthDate: string) =>
    request<{ confirmed: boolean; locked: boolean }>("/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate }),
    }),
  submitRating: (input: { throneId: string; verdict: number; tags: string[]; verified: boolean }) =>
    request<{ updated: boolean; influence: number; flipped: boolean }>("/api/ratings", {
      method: "POST", body: JSON.stringify(input),
    }),
  addThrone: (input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities; publicAccessAttested: boolean }) =>
    request<{ ok: true; throneId: string }>("/api/thrones", { method: "POST", body: JSON.stringify(input) }),
  confirmThrone: (throneId: string) =>
    request<{ ok: true }>(`/api/thrones/${throneId}/confirm`, { method: "POST" }),
};
