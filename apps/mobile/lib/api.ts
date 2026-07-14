import type {
  MeDTO, RealmDTO, StandingsDTO, NotificationsDTO, NotifyPrefsDTO, ThroneDTO,
  HouseId, Amenities, ThroneCategory, WindowKey,
} from "@sot/core";
import { API_BASE_URL } from "./config";
import { getToken, signOut } from "./auth";
export type { MeDTO, RealmDTO, StandingsDTO, NotificationsDTO, NotifyPrefsDTO, ThroneDTO } from "@sot/core";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Absolute URL + bearer header. Mirrors apps/web/src/lib/api.ts's `request`,
 * but every path is prefixed with API_BASE_URL and the token is attached. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
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
  updateNotifyPrefs: (notifyPrefs: NotifyPrefsDTO) =>
    request<{ ok: true; notifyPrefs: NotifyPrefsDTO }>("/api/profile", {
      method: "POST", body: JSON.stringify({ notifyPrefs }),
    }),
  notifications: () => request<NotificationsDTO>("/api/notifications"),
  markNotificationsRead: (ids?: string[]) =>
    request<{ ok: true }>("/api/notifications/read", {
      method: "POST", body: JSON.stringify(ids ? { ids } : {}),
    }),
  ageGate: (birthDate: string) =>
    request<{ confirmed: boolean; locked: boolean }>("/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate }),
    }),
  submitRating: (input: { throneId: string; verdict: number; tags: string[]; verified: boolean; testimony?: string }) =>
    request<{ updated: boolean; influence: number; flipped: boolean; testimonyBlocked?: boolean; blessed?: boolean }>("/api/ratings", {
      method: "POST", body: JSON.stringify(input),
    }),
  report: (input: { subjectKind: "throne" | "rating" | "photo"; subjectId: string; reason: string; note?: string }) =>
    request<{ ok: true }>("/api/report", { method: "POST", body: JSON.stringify(input) }),
  listPhotos: (throneId: string) =>
    request<{ photos: { id: string; status: "pending" | "approved" | "rejected"; mine: boolean; rejectedReason: string | null; createdAt: number }[] }>(
      `/api/thrones/${throneId}/photos`
    ),
  uploadPhoto: async (throneId: string, file: PhotoUpload) => {
    const token = await getToken();
    const form = new FormData();
    // React Native FormData accepts { uri, name, type } file parts; the DOM lib
    // types this param as Blob/string only, so cast through unknown.
    form.append("file", file as unknown as Blob);
    form.append("throneId", throneId);
    const res = await fetch(`${API_BASE_URL}/api/photos`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
    }
    return res.json() as Promise<{ photoId: string; status: "pending" | "rejected" }>;
  },
  addThrone: (input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities; publicAccessAttested: boolean }) =>
    request<{ ok: true; throneId: string }>("/api/thrones", { method: "POST", body: JSON.stringify(input) }),
  confirmThrone: (throneId: string) =>
    request<{ ok: true }>(`/api/thrones/${throneId}/confirm`, { method: "POST" }),
  standings: (window: WindowKey, house: HouseId | "all") =>
    request<StandingsDTO>(`/api/standings?window=${window}&house=${house}`),
  registerPush: (token: string, platform: string) =>
    request<{ ok: true }>("/api/push/register", {
      method: "POST", body: JSON.stringify({ token, platform }),
    }),
};

/** React Native multipart file descriptor (from expo-image-picker / camera). */
export interface PhotoUpload {
  uri: string;
  name: string;
  type: string;
}

/**
 * Back-compat shim for the Foundation App.tsx which imports `fetchMe`.
 * Folds into `api.me()`; on 401 it clears the stored token (as the original did).
 */
export async function fetchMe(): Promise<MeDTO> {
  try {
    return await api.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await signOut();
      throw new Error("unauthorized");
    }
    throw e;
  }
}
