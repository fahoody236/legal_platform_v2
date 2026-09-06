import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "./api.js";
import { normaliseArabic } from "./arabic.js";

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
  clientType: ClientType;
  identifier: string | null;
}

/**
 * How many rows the search reads.
 *
 * A ceiling, and a real one: past this the search stops seeing part of the
 * firm's client list and silently reports no match for a client that exists.
 * It is the direct consequence of the interim below, and it disappears with it.
 */
const SEARCH_PAGE = 100;

/**
 * The minimum before searching. One character matches most of a client list,
 * which is a slower way of showing everything.
 */
export const MIN_SEARCH_LENGTH = 2;

/**
 * Clients matching what the person typed.
 *
 * ── The interim, and exactly what changes ────────────────────────────────────
 *
 * The clients API has no search parameter yet, so `buildSearchUrl` currently
 * ignores the term and this filters the first page in the browser. Two things
 * follow, and both are the reason the parameter is worth adding rather than
 * living with this:
 *
 *   * A firm with more than SEARCH_PAGE clients gets wrong answers — not slow
 *     ones, wrong ones. A client past the first page reads as "no match", and
 *     the offer to create a new one appears for a client that already exists,
 *     which is how the same client ends up in the list twice.
 *   * Matching is done on strings already in the browser, so the Arabic folding
 *     in arabic.ts has to happen here. That folding must eventually match what
 *     the index does, and two implementations of it will not stay in step.
 *
 * When the parameter lands, `buildSearchUrl` gains `&q=` and `matches` is
 * deleted. Nothing else in this file or the components above it changes: the
 * term is already in the query key, so each debounced term is already its own
 * request.
 */
function buildSearchUrl(term: string): string {
  // The term is deliberately unused for now. See the note above.
  void term;
  return `/api/clients?archived=false&limit=${SEARCH_PAGE}`;
}

function matches(clients: Client[], term: string): ClientOption[] {
  const needle = normaliseArabic(term);

  return clients
    .filter((client) => {
      const identifier = clientIdentifier(client) ?? "";

      return (
        normaliseArabic(client.nameAr).includes(needle) ||
        normaliseArabic(client.name ?? "").includes(needle) ||
        identifier.includes(needle)
      );
    })
    .map((client) => ({
      id: client.id,
      nameAr: client.nameAr,
      clientType: client.clientType,
      identifier: clientIdentifier(client),
    }));
}

/**
 * `archived=false` is not a default anyone should change here. A new case must
 * not be opened against a client the firm has stopped acting for, and the way
 * to do it anyway is to un-archive the client first — a deliberate act, rather
 * than picking a name out of a list that does not say it is closed.
 *
 * A case that already references an archived client still shows it: the name
 * comes from the case record, resolved by the API's join, which has no archived
 * filter. Search decides what can be chosen, not what can be displayed.
 */
export function useClientSearch(term: string): UseQueryResult<ClientOption[]> {
  const trimmed = term.trim();

  return useQuery({
    queryKey: ["clients", "search", trimmed],
    queryFn: async () => {
      const body = await apiFetch<ClientsPage>(buildSearchUrl(trimmed));
      return matches(body.clients, trimmed);
    },
    enabled: trimmed.length >= MIN_SEARCH_LENGTH,
    retry: retryUnlessAnswered,
    // The same page answers every term today, so re-reading it per keystroke
    // would be pure waste. Once the term is sent this becomes an ordinary
    // per-query cache.
    staleTime: 30_000,
    placeholderData: (previous) => previous,
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
