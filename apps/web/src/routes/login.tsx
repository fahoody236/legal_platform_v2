import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api.js";
import { SESSION_QUERY_KEY, type SessionUser } from "../lib/session.js";

/**
 * One message for every failure — wrong password, unknown address, locked
 * account, throttled, server unreachable.
 *
 * The API already collapses those into a single 401 so that response codes
 * cannot be used to discover who has an account here. Restating the distinction
 * in the interface would give back exactly what the server withholds, and the
 * person signing in cannot act differently on any of them anyway.
 */
const GENERIC_ERROR =
  "تعذّر تسجيل الدخول. تحقّق من البريد الإلكتروني وكلمة المرور.";

type Status = "idle" | "submitting" | "error";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    try {
      const body = await apiFetch<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setPassword("");

      // Seeded rather than invalidated: the sign-in response already carries the
      // user, so refetching /auth/me would be a second round trip for an answer
      // just received. The cookie is set by then, so a later refetch still works.
      queryClient.setQueryData(SESSION_QUERY_KEY, body.user);

      await navigate({ to: "/cases" });
    } catch {
      // A network failure is reported the same way as a rejected credential.
      setStatus("error");
    }
  }

  return (
    <main className="narrow">
      <h1>تسجيل الدخول</h1>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">البريد الإلكتروني</label>
          <input
            id="email"
            name="email"
            type="email"
            // Latin text in an Arabic page: the field runs left-to-right so the
            // caret and any punctuation behave as the person typing expects,
            // while its label stays right-to-left.
            dir="ltr"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="password">كلمة المرور</label>
          <input
            id="password"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {status === "error" && (
          // aria-live so a screen reader announces the failure without the
          // focus having to move to it.
          <p className="error" role="alert" aria-live="polite">
            {GENERIC_ERROR}
          </p>
        )}

        <button type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
        </button>
      </form>
    </main>
  );
}
