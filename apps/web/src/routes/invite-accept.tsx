import { Link, useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { isApiError, isNetworkError } from "../lib/api.js";
import { formatDateTime } from "../lib/dates.js";
import { useAcceptInvitation, useInvitationPreview } from "../lib/users.js";

/** The same floor as the API and the set-password script. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Where an invitation link lands: outside the shell, because the person has
 * no session yet, and on the firm's own subdomain, because the token is only
 * visible in that tenant's context.
 *
 * The token is read from the path — that is what a link is — and sent to the
 * API in a request body so it stays out of API access logs. It is looked up
 * before a password is asked for, so a dead link is one sentence rather than
 * a form that fails on submit.
 */
export function InviteAcceptPage() {
  const { token } = useParams({ from: "/invite/$token" });
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation(token);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirm) {
      setMismatch(true);
      return;
    }

    setMismatch(false);
    accept.mutate(password, { onSuccess: () => setPassword("") });
  }

  return (
    <div className="standalone">
      <main className="narrow">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ق
          </span>
          <span>
            <span className="brand-name">المنصة القانونية</span>
            <span className="brand-sub">إدارة المكتب</span>
          </span>
        </div>

        {preview.isPending && (
          <p className="state" role="status" aria-live="polite">
            جارٍ التحقق من الدعوة…
          </p>
        )}

        {preview.error && (
          <div className="card">
            <h1>الدعوة غير صالحة</h1>
            <p
              className={
                isNetworkError(preview.error) ? "state error" : "state denied"
              }
              role="alert"
            >
              {isNetworkError(preview.error)
                ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
                : "هذا الرابط غير صالح أو انتهت صلاحيته أو سبق استخدامه. اطلب من مدير المكتب إصدار دعوة جديدة."}
            </p>
          </div>
        )}

        {preview.isSuccess && accept.isSuccess && (
          <div className="card">
            <h1>تم تعيين كلمة المرور</h1>
            <p>يمكنك الآن تسجيل الدخول بحسابك.</p>
            <div className="form-actions">
              <Link to="/login" className="button-link">
                تسجيل الدخول
              </Link>
            </div>
          </div>
        )}

        {preview.isSuccess && !accept.isSuccess && (
          <form onSubmit={handleSubmit} className="card" noValidate>
            <h1>مرحباً {preview.data.fullNameAr ?? preview.data.fullName}</h1>
            <p className="hint">
              أُنشئ لك حساب بالبريد <span dir="ltr">{preview.data.email}</span>.
              عيّن كلمة مرور لتسجيل الدخول. تنتهي هذه الدعوة في{" "}
              {formatDateTime(preview.data.expiresAt)}.
            </p>

            {accept.error && (
              <p className="error" role="alert">
                {isApiError(accept.error, 404)
                  ? "لم تعد هذه الدعوة صالحة. اطلب من مدير المكتب إصدار دعوة جديدة."
                  : isApiError(accept.error, 400)
                    ? `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} حرفاً.`
                    : isNetworkError(accept.error)
                      ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
                      : "تعذّر تعيين كلمة المرور. حاول مرة أخرى."}
              </p>
            )}

            <div className="field">
              <label htmlFor="password">كلمة المرور</label>
              <input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                disabled={accept.isPending}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="hint">{MIN_PASSWORD_LENGTH} حرفاً على الأقل.</p>
            </div>

            <div className="field">
              <label htmlFor="confirm">تأكيد كلمة المرور</label>
              <input
                id="confirm"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                required
                value={confirm}
                disabled={accept.isPending}
                aria-invalid={mismatch || undefined}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && (
                <p className="field-error" role="alert">
                  كلمتا المرور غير متطابقتين.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={
                accept.isPending || password.length < MIN_PASSWORD_LENGTH
              }
            >
              {accept.isPending ? "جارٍ الحفظ…" : "تعيين كلمة المرور"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
