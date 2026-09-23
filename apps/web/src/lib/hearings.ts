import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "./api.js";

/** Mirrors HEARING_TYPES / HEARING_STATUSES in packages/db. */
export const HEARING_TYPES = [
  "pleading",
  "judgment",
  "appeal",
  "expert",
  "other",
] as const;

export type HearingType = (typeof HEARING_TYPES)[number];

export const HEARING_STATUSES = [
  "scheduled",
  "held",
  "adjourned",
  "cancelled",
] as const;

export type HearingStatus = (typeof HEARING_STATUSES)[number];

/**
 * Everything the status control can set. `adjourned` is absent because
 * adjourning writes two rows — this hearing and its successor — which a
 * dropdown cannot express; it has its own action, as task completion does.
 */
export const SETTABLE_HEARING_STATUSES = HEARING_STATUSES.filter(
  (value): value is Exclude<HearingStatus, "adjourned"> =>
    value !== "adjourned",
);

/**
 * Colour reinforces, never carries. Every row states its status and type in
 * words, so a reader who cannot separate these hues loses nothing.
 */
export const HEARING_STATUS_LABELS: Record<
  HearingStatus,
  { label: string; colour: string; background: string }
> = {
  scheduled: { label: "مجدولة", colour: "#1f3d8f", background: "#e9eefb" },
  held: { label: "انعقدت", colour: "#1f6b3a", background: "#e8f4ec" },
  adjourned: { label: "مؤجلة", colour: "#8a5a06", background: "#fdf3e3" },
  cancelled: { label: "ملغاة", colour: "#7a1f21", background: "#fdf2f2" },
};

export const HEARING_TYPE_LABELS: Record<HearingType, string> = {
  pleading: "مرافعة",
  judgment: "نطق بالحكم",
  appeal: "استئناف",
  expert: "خبرة",
  other: "أخرى",
};

export interface HearingRow {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitleAr: string;
  scheduledAt: string;
  /** Null when the hearing sits in the case's own court. */
  court: string | null;
  caseCourt: string | null;
  /** The API's coalesce of the two — the court to actually show. */
  effectiveCourt: string | null;
  circuit: string | null;
  hearingType: HearingType;
  status: HearingStatus;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface HearingsPage {
  hearings: HearingRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface HearingsQuery {
  caseId?: string | undefined;
  status?: HearingStatus | undefined;
  upcoming?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  offset: number;
}

/**
 * Still ahead: scheduled, not archived, and in the future. A held hearing is
 * not upcoming however recent, and a cancelled one never was.
 */
export function isUpcoming(hearing: HearingRow): boolean {
  return (
    hearing.status === "scheduled" &&
    hearing.archivedAt === null &&
    new Date(hearing.scheduledAt).getTime() >= Date.now()
  );
}

function retryUnlessAnswered(failureCount: number, error: Error): boolean {
  const status = (error as { status?: number }).status;

  if (status === 401 || status === 403 || status === 404) {
    return false;
  }

  return failureCount < 2;
}

export function useHearings(
  query: HearingsQuery,
  enabled = true,
): UseQueryResult<HearingsPage> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });

  if (query.caseId) search.set("caseId", query.caseId);
  if (query.status) search.set("status", query.status);
  if (query.upcoming) search.set("upcoming", "true");
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);

  return useQuery({
    queryKey: ["hearings", "list", search.toString()],
    queryFn: () => apiFetch<HearingsPage>(`/api/hearings?${search.toString()}`),
    enabled,
    retry: retryUnlessAnswered,
    placeholderData: (previous) => previous,
  });
}

/**
 * Every hearing mutation invalidates the whole `["hearings"]` tree, and the
 * dashboard with it — an adjournment moves a date off one list and onto
 * another, which is not worth reproducing in the cache.
 */
function useHearingMutation<TBody, TResult>(
  request: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hearings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface CreateHearingBody {
  caseId: string;
  scheduledAt: string;
  court?: string | null;
  circuit?: string | null;
  hearingType: HearingType;
}

export type UpdateHearingBody = Omit<CreateHearingBody, "caseId"> & {
  notes?: string | null;
};

export function useCreateHearing() {
  return useHearingMutation((body: CreateHearingBody) =>
    apiFetch<{ hearing: HearingRow }>("/api/hearings", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((response) => response.hearing),
  );
}

export function useUpdateHearing(hearingId: string) {
  return useHearingMutation((body: Partial<UpdateHearingBody>) =>
    apiFetch<{ hearing: HearingRow }>(
      `/api/hearings/${encodeURIComponent(hearingId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then((response) => response.hearing),
  );
}

export function useSetHearingStatus(hearingId: string) {
  return useHearingMutation(
    (body: {
      status: Exclude<HearingStatus, "adjourned">;
      notes?: string | null;
    }) =>
      apiFetch<{ hearing: HearingRow }>(
        `/api/hearings/${encodeURIComponent(hearingId)}/status`,
        { method: "POST", body: JSON.stringify(body) },
      ).then((response) => response.hearing),
  );
}

export interface AdjournBody {
  notes?: string | null;
  scheduledAt?: string | undefined;
  court?: string | null;
  circuit?: string | null;
  hearingType?: HearingType | undefined;
}

/**
 * Its own call because it is its own event: the hearing closes and a
 * successor opens, in one transaction. `scheduledAt` may be omitted — a court
 * that adjourned without setting a date is a real outcome, not an incomplete
 * form.
 */
export function useAdjournHearing(hearingId: string) {
  return useHearingMutation((body: AdjournBody) =>
    apiFetch<{ hearing: HearingRow; next: HearingRow | null }>(
      `/api/hearings/${encodeURIComponent(hearingId)}/adjourn`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  );
}
