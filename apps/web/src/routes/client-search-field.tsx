import { useId, useState } from "react";
import { isApiError } from "../lib/api.js";
import {
  CLIENT_TYPE_LABELS,
  MIN_SEARCH_LENGTH,
  useClientSearch,
  type Client,
  type ClientOption,
} from "../lib/clients.js";
import { useDebounced } from "../lib/use-debounced.js";
import { ClientQuickAdd } from "./client-quick-add.js";

const DEBOUNCE_MS = 300;

export interface SelectedClient {
  id: string;
  nameAr: string;
}

/**
 * Choosing a client by typing, rather than from a list of everyone.
 *
 * The selected client is held by the caller, not here, so opening the quick-add
 * modal — or anything else that re-renders the form — cannot lose it.
 *
 * `selected` may name a client the search would never return, and that is the
 * point: a case already filed against an archived client must still display it.
 * Search decides what can be *chosen*; it does not decide what can be shown.
 */
export function ClientSearchField({
  selected,
  onSelect,
  error,
  canCreateClients,
}: {
  selected: SelectedClient | null;
  onSelect: (client: SelectedClient | null) => void;
  error?: string | undefined;
  canCreateClients: boolean;
}) {
  const [term, setTerm] = useState("");
  const [quickAdd, setQuickAdd] = useState(false);
  const debounced = useDebounced(term, DEBOUNCE_MS);
  const results = useClientSearch(debounced);

  const inputId = useId();
  const listId = `${inputId}-results`;

  if (selected) {
    return (
      <div className="field">
        <span className="label-like">العميل</span>

        <div className="chosen">
          <strong>{selected.nameAr}</strong>
          <button
            type="button"
            className="link"
            onClick={() => {
              onSelect(null);
              setTerm("");
            }}
          >
            تغيير
          </button>
        </div>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // The term the results describe, not the one being typed. Announcing "no
  // matches" against a half-typed word is both wrong and distracting.
  const settled = debounced.trim();
  const searching = settled.length >= MIN_SEARCH_LENGTH;
  const noMatches =
    searching && results.isSuccess && (results.data?.length ?? 0) === 0;

  return (
    <div className="field">
      <label htmlFor={inputId}>العميل</label>

      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={searching}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="ابحث بالاسم أو رقم الهوية أو السجل التجاري"
        value={term}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(event) => setTerm(event.target.value)}
      />

      {error && (
        <p className="field-error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      )}

      {term.trim().length > 0 && term.trim().length < MIN_SEARCH_LENGTH && (
        <p className="hint">اكتب حرفين على الأقل للبحث.</p>
      )}

      {/*
        403 is its own message. Someone can hold cases.create without
        clients.view — a firm may grant one and not the other — and telling them
        the search failed would send them looking for a fault that does not
        exist.
      */}
      {isApiError(results.error, 403) && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض العملاء، وهي لازمة لاختيار عميل للقضية. راجع مدير
          المكتب لمنحك صلاحية «عرض العملاء».
        </p>
      )}

      {results.error && !isApiError(results.error, 403) && (
        <p className="field-error" role="alert">
          تعذّر البحث عن العملاء. حاول مرة أخرى.
        </p>
      )}

      {searching && results.isFetching && (
        <p className="hint" role="status">
          جارٍ البحث…
        </p>
      )}

      <ul className="search-results" id={listId} role="listbox">
        {(results.data ?? []).map((option) => (
          <Result key={option.id} option={option} onSelect={onSelect} />
        ))}
      </ul>

      {noMatches && (
        <div className="no-matches">
          <p>لا يوجد عميل مطابق.</p>

          {/*
            Offered only with clients.manage. Without it the button would open a
            form whose save is refused, which is a worse answer than not being
            offered the shortcut at all.
          */}
          {canCreateClients && (
            <button type="button" onClick={() => setQuickAdd(true)}>
              إضافة عميل جديد
            </button>
          )}
        </div>
      )}

      {quickAdd && (
        <ClientQuickAdd
          onCancel={() => setQuickAdd(false)}
          onCreated={(client: Client) => {
            setQuickAdd(false);
            onSelect({ id: client.id, nameAr: client.nameAr });
            setTerm("");
          }}
        />
      )}
    </div>
  );
}

function Result({
  option,
  onSelect,
}: {
  option: ClientOption;
  onSelect: (client: SelectedClient) => void;
}) {
  return (
    <li role="option" aria-selected={false}>
      {/*
        A real button, so the option is reachable by Tab and activated by Enter
        or Space without any key handling of our own. Full combobox semantics —
        arrow keys moving an aria-activedescendant — would be better still and
        are not built; this is at least operable rather than mouse-only.
      */}
      <button type="button" onClick={() => onSelect(option)}>
        <span className="result-name">{option.nameAr}</span>
        <span className="muted"> · {CLIENT_TYPE_LABELS[option.clientType]}</span>
        {option.identifier && (
          <>
            <span className="muted"> · </span>
            <span dir="ltr" className="case-number">
              {option.identifier}
            </span>
          </>
        )}
      </button>
    </li>
  );
}
