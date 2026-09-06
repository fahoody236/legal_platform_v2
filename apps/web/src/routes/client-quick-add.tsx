import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../lib/api.js";
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  useCreateClient,
  type Client,
  type ClientType,
} from "../lib/clients.js";

const NATIONAL_ID = /^[12][0-9]{9}$/;
const COMMERCIAL_REGISTRATION = /^[0-9]{10}$/;

interface Values {
  clientType: ClientType;
  nameAr: string;
  nationalId: string;
  commercialRegistration: string;
}

type Errors = Partial<Record<keyof Values, string>>;

/**
 * Opening a client without leaving the case form.
 *
 * The fields are the minimum the database will accept: a type, an Arabic name,
 * and the identifier that type requires. Phone, email, notes and the Latin name
 * are all optional on the full form and are left out here on purpose — this is
 * the moment someone is trying to do something else, and every extra field is
 * an invitation to abandon the case they were opening.
 *
 * A native `<dialog>` rather than a div with a high z-index. It traps focus,
 * closes on Escape, marks everything behind it inert for assistive technology,
 * and renders on the top layer above any stacking context — four behaviours
 * that are individually easy to get wrong and collectively the reason
 * hand-rolled modals are usually broken for keyboard users.
 *
 * **Rendered through a portal, and that is load-bearing.** This component is
 * used from inside the case form, so without a portal its `<form>` would be a
 * form nested inside another form. React will build that in the DOM even though
 * HTML forbids it, and the result is not inert: the inner form's submit event
 * bubbles to the outer form, whose handler runs too. The observed symptom was
 * the case form clearing itself when the modal was saved — everything the
 * person had typed, gone, at the exact moment they were trying not to lose it.
 *
 * The portal moves the dialog to `document.body` in the DOM while leaving it in
 * the React tree, so state and context are unaffected and the nesting simply
 * does not exist.
 */
export function ClientQuickAdd({
  onCreated,
  onCancel,
}: {
  onCreated: (client: Client) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Values>({
    clientType: "individual",
    nameAr: "",
    nationalId: "",
    commercialRegistration: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const create = useCreateClient();

  useEffect(() => {
    // showModal rather than the `open` attribute: only the former gives the
    // top layer, the focus trap and the backdrop.
    dialogRef.current?.showModal();
  }, []);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function validate(): Errors {
    const found: Errors = {};

    if (!values.nameAr.trim()) found.nameAr = "هذا الحقل مطلوب.";
    else if (values.nameAr.trim().length > 300) {
      found.nameAr = "الحد الأقصى 300 حرفاً.";
    }

    if (values.clientType === "individual") {
      if (!values.nationalId.trim()) found.nationalId = "هذا الحقل مطلوب.";
      else if (!NATIONAL_ID.test(values.nationalId.trim())) {
        found.nationalId =
          "رقم الهوية أو الإقامة من 10 أرقام ويبدأ بـ 1 للمواطن أو 2 للمقيم.";
      }
    } else if (!values.commercialRegistration.trim()) {
      found.commercialRegistration = "هذا الحقل مطلوب.";
    } else if (
      !COMMERCIAL_REGISTRATION.test(values.commercialRegistration.trim())
    ) {
      found.commercialRegistration = "السجل التجاري من 10 أرقام.";
    }

    return found;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /**
     * The portal fixes the DOM, not the event path.
     *
     * React propagates events along the *React* tree, not the DOM tree, so a
     * submit inside a portal still reaches handlers on the component that
     * rendered it — here, the case form. Without this the case form validates
     * itself every time the modal is saved and paints "choose a client" and
     * "this field is required" across fields the person has not reached yet.
     *
     * Stopping propagation is the whole fix: this submit concerns this form.
     */
    event.stopPropagation();

    const found = validate();
    setErrors(found);

    if (Object.keys(found).length > 0) return;

    create.mutate(
      {
        clientType: values.clientType,
        nameAr: values.nameAr.trim(),
        ...(values.clientType === "individual"
          ? { nationalId: values.nationalId.trim() }
          : { commercialRegistration: values.commercialRegistration.trim() }),
      },
      { onSuccess: onCreated },
    );
  }

  /**
   * The 409 lands on the identifier, without the API naming it.
   *
   * The type decides which unique index is reachable — an individual carries a
   * national ID and no commercial registration, a company the reverse, and the
   * CHECK constraint makes anything else unstorable — so there is exactly one
   * field that can have collided.
   *
   * Worth reading twice in this context: a duplicate here means the client the
   * person is trying to create already exists, and the search simply did not
   * find it. Today that is a real possibility past the first page of clients,
   * which is the strongest argument for the search parameter.
   */
  const serverErrors: Errors = {};
  let formError: string | null = null;

  if (create.error instanceof ApiError) {
    if (create.error.status === 409) {
      const message =
        "هذا العميل مسجَّل بالفعل. أغلق النافذة وابحث عنه بالرقم.";

      if (values.clientType === "individual") serverErrors.nationalId = message;
      else serverErrors.commercialRegistration = message;
    } else if (create.error.status === 403) {
      formError = "لا تملك صلاحية إضافة العملاء.";
    } else if (create.error.status === 400) {
      formError = "راجع الحقول ثم حاول مرة أخرى.";
    } else {
      formError = "تعذّر حفظ العميل. حاول مرة أخرى.";
    }
  } else if (create.error) {
    formError = "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  const shown: Errors = { ...serverErrors, ...errors };

  const field = (
    key: "nameAr" | "nationalId" | "commercialRegistration",
    label: string,
    ltr = false,
  ) => {
    const id = `quick-${key}`;

    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          dir={ltr ? "ltr" : undefined}
          inputMode={ltr ? "numeric" : undefined}
          value={values[key]}
          aria-describedby={shown[key] ? `${id}-error` : undefined}
          onChange={(event) => set(key, event.target.value)}
        />
        {shown[key] && (
          <p className="field-error" id={`${id}-error`} role="alert">
            {shown[key]}
          </p>
        )}
      </div>
    );
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="quick-add-title"
      // Escape and the backdrop close it. Cancelling never discards the case
      // form behind: that form is a sibling and keeps its own state.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="quick-add-title">عميل جديد</h2>

      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="error" role="alert">
            {formError}
          </p>
        )}

        <div className="field">
          <label htmlFor="quick-clientType">نوع العميل</label>
          <select
            id="quick-clientType"
            value={values.clientType}
            onChange={(event) =>
              // Switching type drops the other identifier rather than keeping
              // it out of sight, so a half-filled company cannot be submitted
              // as an individual carrying a registration the API would reject.
              setValues((current) => ({
                ...current,
                clientType: event.target.value as ClientType,
                nationalId: "",
                commercialRegistration: "",
              }))
            }
          >
            {CLIENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CLIENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {field("nameAr", "الاسم (عربي)")}

        {values.clientType === "individual"
          ? field("nationalId", "رقم الهوية / الإقامة", true)
          : field("commercialRegistration", "السجل التجاري", true)}

        <p className="hint">
          يمكن استكمال بقية بيانات العميل لاحقاً من صفحة العملاء.
        </p>

        <div className="form-actions">
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? "جارٍ الحفظ…" : "حفظ واختيار"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={create.isPending}
            onClick={onCancel}
          >
            إلغاء
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
