import { useState, type FormEvent } from "react";

interface User {
  userId: string;
  email: string;
  fullName: string;
}

/**
 * One message for every failure — wrong password, unknown address, locked
 * account, throttled, server unreachable.
 *
 * The API already collapses those into a single 401 so that response codes
 * cannot be used to discover who has an account here. Restating the distinction
 * in the interface would give back exactly what the server withholds, and the
 * person signing in cannot act differently on any of them anyway.
 */
const GENERIC_ERROR = "تعذّر تسجيل الدخول. تحقّق من البريد الإلكتروني وكلمة المرور.";

type Status = "idle" | "submitting" | "error";

export function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [user, setUser] = useState<User | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The session token never appears in this exchange's body. It arrives
        // as an HttpOnly cookie the browser stores and replays on its own, and
        // this option is what lets it be set and returned.
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        setStatus("error");
        return;
      }

      const body = (await response.json()) as { user: User };
      setUser(body.user);
      setPassword("");
      setStatus("idle");
    } catch {
      // A network failure is reported the same way as a rejected credential.
      setStatus("error");
    }
  }

  if (user) {
    return (
      <main>
        <h1>مرحباً</h1>
        <p className="signed-in">
          تم تسجيل الدخول باسم <strong>{user.fullName}</strong>
        </p>
      </main>
    );
  }

  return (
    <main>
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
