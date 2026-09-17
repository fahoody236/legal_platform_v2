import { useRouter } from "@tanstack/react-router";
import { isNetworkError } from "../lib/api.js";

/**
 * What a route shows when its `beforeLoad` throws.
 *
 * Without this, a failure before the component mounts renders nothing at all —
 * the router catches the error and the page is blank. That is the worst
 * available outcome: the reader cannot tell a broken connection from a broken
 * application, and there is nothing on screen to act on. A signed-out redirect
 * still works, because `redirect` is thrown deliberately and handled by the
 * router rather than arriving here.
 *
 * The in-component error states are still needed and are not redundant with
 * this. They cover a request that fails *after* the route loaded — the
 * connection dropping while the table is on screen — where blanking the whole
 * page would be a heavier response than the situation deserves.
 */
export function RouteError({ error }: { error: Error }) {
  const router = useRouter();

  return (
    // Rendered both in place of the shell (the session check itself failed)
    // and inside it (one screen failed), so it is a card either way rather
    // than a full-page layout of its own.
    <main className="narrow">
      <div className="card">
        <h1>تعذّر تحميل الصفحة</h1>

        <p className="state error" role="alert">
          {isNetworkError(error)
            ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
            : "حدث خطأ غير متوقع. حاول مرة أخرى."}
        </p>

        <div className="form-actions">
          <button type="button" onClick={() => void router.invalidate()}>
            إعادة المحاولة
          </button>
        </div>
      </div>
    </main>
  );
}
