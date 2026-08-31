import { createInterface } from "node:readline/promises";
import {
  createClient,
  findUserByEmail,
  resolveFirmBySubdomain,
  upsertCredential,
  withTenant,
} from "@legal/db";
import { hashPassword } from "../auth/password.js";

/**
 * Sets a user's password from the command line.
 *
 * There is no endpoint that creates a credential, so without this there is no
 * way to sign in for the first time — a firm's first administrator has to get a
 * password from somewhere outside the application.
 *
 * It connects as whatever DATABASE_URL points at, which should be the ordinary
 * unprivileged role. Nothing here needs more: `resolve_firm_by_subdomain` is
 * granted to legal_app, and the write happens inside `withTenant`, under the
 * same policies as any request. A maintenance script that needed elevated
 * privileges to do routine work would be a sign the model was wrong.
 *
 * Usage:
 *   pnpm --filter @legal/api run set-password <subdomain> <email> [password]
 *
 * The password is read from stdin when omitted, which is the better habit:
 * an argument is visible in `ps` output and lands in shell history.
 */

const MIN_PASSWORD_LENGTH = 12;

function usage(): never {
  console.error(
    "Usage: set-password <subdomain> <email> [password]\n" +
      "\n" +
      "  Omit the password to be prompted. Passing it as an argument exposes it\n" +
      "  in the process list and your shell history.",
  );
  process.exit(1);
}

async function readPasswordFromStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question("New password: ")).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [subdomain, email, passwordArgument] = process.argv.slice(2);

  if (!subdomain || !email) {
    usage();
  }

  const url = process.env["DATABASE_URL"];

  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  if (passwordArgument) {
    console.error(
      "Warning: the password was passed as an argument and is now in your shell " +
        "history and the process list. Omit it to be prompted instead.",
    );
  }

  const password = passwordArgument ?? (await readPasswordFromStdin());

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
    process.exit(1);
  }

  const { db, pool } = createClient(url);

  try {
    const firmId = await resolveFirmBySubdomain(db, subdomain);

    if (!firmId) {
      console.error(`No active firm with subdomain "${subdomain}".`);
      process.exitCode = 1;
      return;
    }

    // Hashed outside the transaction: Argon2 takes tens of milliseconds and
    // there is no reason to hold a database transaction open across it.
    const passwordHash = await hashPassword(password);

    const user = await withTenant(db, firmId, async (tx) => {
      const found = await findUserByEmail(tx, email);

      if (!found) {
        return null;
      }

      await upsertCredential(tx, { userId: found.id, passwordHash });
      return found;
    });

    if (!user) {
      console.error(`No user with email "${email}" at "${subdomain}".`);
      process.exitCode = 1;
      return;
    }

    console.log(`Password set for ${user.email} (${user.fullName}).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
