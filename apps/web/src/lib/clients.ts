import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "./api.js";

/** Mirrors CLIENT_TYPES in packages/db. The API rejects anything else. */
export const CLIENT_TYPES = ["individual", "company"] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  individual: "فرد",
  company: "شركة",
};

export interface Client {
  id: string;
  clientType: ClientType;
  nameAr: string;
  name: string | null;
  nationalId: string | null;
  commercialRegistration: string | null;
  vatNumber: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface ClientRepresentative {
  id: string;
  clientId: string;
  nameAr: string;
  name: string | null;
  nationalId: string | null;
  role: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface ClientWithRepresentatives extends Client {
  representatives: ClientRepresentative[];
}

export interface ClientsPage {
  clients: Client[];
  total: number;
  limit: number;
  offset: number;
}

export interface ClientsQuery {
  clientType?: ClientType | undefined;
  archived?: boolean | undefined;
  limit: number;
  offset: number;
}

/**
 * The identifier a client is known by, which depends on what kind of client it
 * is: a national ID or iqama for a person, a commercial registration for a
 * company. Exactly one is ever present — the database enforces that — so this
 * never has to choose between two.
 */
export function clientIdentifier(client: Client): string | null {
  return client.nationalId ?? client.commercialRegistration;
}

function retryUnlessAnswered(failureCount: number, error: Error): boolean {
  const status = (error as { status?: number }).status;

  if (status === 401 || status === 403 || status === 404) {
    return false;
  }

  return failureCount < 2;
}

export function useClients(query: ClientsQuery): UseQueryResult<ClientsPage> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });

  if (query.clientType) search.set("clientType", query.clientType);
  if (query.archived !== undefined) {
    search.set("archived", String(query.archived));
  }

  return useQuery({
    queryKey: [
      "clients",
      "list",
      query.clientType ?? null,
      query.archived ?? null,
      query.limit,
      query.offset,
    ],
    queryFn: () => apiFetch<ClientsPage>(`/api/clients?${search.toString()}`),
    retry: retryUnlessAnswered,
    placeholderData: (previous) => previous,
  });
}

export function useClient(
  clientId: string,
): UseQueryResult<ClientWithRepresentatives> {
  return useQuery({
    queryKey: ["clients", "detail", clientId],
    queryFn: async () => {
      const body = await apiFetch<{ client: ClientWithRepresentatives }>(
        `/api/clients/${encodeURIComponent(clientId)}`,
      );
      return body.client;
    },
    retry: retryUnlessAnswered,
  });
}

export interface ClientOption {
  id: string;
  nameAr: string;
}

/**
 * The firm's clients, for choosing one when opening a case.
 *
 * Needs `clients.view`, which `cases.create` does not imply — a firm can
 * legitimately grant one without the other, and the caller then gets a 403 here
 * while the rest of the form works. The form says so rather than showing an
 * empty select, because an empty select is indistinguishable from a firm with
 * no clients yet.
 *
 * Archived clients are filtered out. Opening a new matter for a client the firm
 * has stopped acting for is almost always a mistake, and the ones that are not
 * can be un-archived first — a decision worth making deliberately rather than
 * by picking a name out of a list.
 *
 * One page of 100. That is a real ceiling and this select is the wrong control
 * for a firm past it; a search-backed picker is the answer, and it waits on the
 * Arabic search work.
 */
export function useClientOptions(
  enabled: boolean,
): UseQueryResult<ClientOption[]> {
  return useQuery({
    queryKey: ["clients", "options"],
    queryFn: async () => {
      const body = await apiFetch<ClientsPage>(
        "/api/clients?archived=false&limit=100",
      );
      return body.clients.map((client) => ({
        id: client.id,
        nameAr: client.nameAr,
      }));
    },
    enabled,
    retry: retryUnlessAnswered,
  });
}

/**
 * Every mutation below invalidates the whole `["clients"]` tree rather than
 * patching individual entries.
 *
 * Archiving a client, for instance, changes the list under the "active" filter,
 * the list under "archived", both totals, the client's own detail, and the
 * select used when opening a case. Reproducing the server's filtering in the
 * cache to update each of those is how a cache comes to disagree with the
 * database; one refetch cannot be subtly wrong.
 */
function useClientMutation<TBody, TResult>(
  request: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      // Cases carry the client's name, resolved server-side, so renaming a
      // client changes rows in a list this mutation never touched.
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
      void queryClient.invalidateQueries({ queryKey: ["case"] });
    },
  });
}

export interface CreateClientBody {
  clientType: ClientType;
  nameAr: string;
  name?: string | null;
  nationalId?: string | null;
  commercialRegistration?: string | null;
  vatNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export type UpdateClientBody = Omit<CreateClientBody, "clientType">;

export function useCreateClient() {
  return useClientMutation((body: CreateClientBody) =>
    apiFetch<{ client: Client }>("/api/clients", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((response) => response.client),
  );
}

export function useUpdateClient(clientId: string) {
  return useClientMutation((body: UpdateClientBody) =>
    apiFetch<{ client: Client }>(
      `/api/clients/${encodeURIComponent(clientId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then((response) => response.client),
  );
}

export function useArchiveClient(clientId: string) {
  return useClientMutation(() =>
    apiFetch<{ client: Client }>(
      `/api/clients/${encodeURIComponent(clientId)}/archive`,
      { method: "POST" },
    ).then((response) => response.client),
  );
}

export interface RepresentativeBody {
  nameAr: string;
  name?: string | null;
  nationalId?: string | null;
  role: string;
}

export function useAddRepresentative(clientId: string) {
  return useClientMutation((body: RepresentativeBody) =>
    apiFetch<{ representative: ClientRepresentative }>(
      `/api/clients/${encodeURIComponent(clientId)}/representatives`,
      { method: "POST", body: JSON.stringify(body) },
    ).then((response) => response.representative),
  );
}

export function useUpdateRepresentative(representativeId: string) {
  return useClientMutation((body: RepresentativeBody) =>
    apiFetch<{ representative: ClientRepresentative }>(
      `/api/representatives/${encodeURIComponent(representativeId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then((response) => response.representative),
  );
}

export function useArchiveRepresentative(representativeId: string) {
  return useClientMutation(() =>
    apiFetch<{ representative: ClientRepresentative }>(
      `/api/representatives/${encodeURIComponent(representativeId)}/archive`,
      { method: "POST" },
    ).then((response) => response.representative),
  );
}
