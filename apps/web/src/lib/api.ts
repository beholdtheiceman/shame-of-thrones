import type {
  MeDTO, RealmDTO, StandingsDTO, NotificationsDTO, NotifyPrefsDTO, ThroneDTO,
  HouseId, Amenities, ThroneCategory, WindowKey,
} from "@sot/core";
export type { MeDTO, RealmDTO, StandingsDTO, NotificationsDTO, NotifyPrefsDTO, ThroneDTO } from "@sot/core";

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
  createProfile: (name: string, houseId: HouseId, inviteCode?: string) =>
    request<{ ok: true }>("/api/profile", {
      method: "POST",
      body: JSON.stringify({ name, houseId, ...(inviteCode ? { inviteCode } : {}) }),
    }),
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
  uploadPhoto: async (throneId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("throneId", throneId);
    const res = await fetch("/api/photos", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
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
};

/** Fire-and-forget instrumentation. Never throws — must never break the UX. */
export async function recordMetric(
  name: "time_to_rate" | "nwt_outcome",
  meta: Record<string, unknown>
): Promise<void> {
  try {
    await fetch("/api/metrics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, meta }),
    });
  } catch {
    // swallow — instrumentation is best-effort
  }
}
