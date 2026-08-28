import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { assertRlsAppliesToConnection, createClient } from "@legal/db";

/** The `{ db, pool }` pair — named without importing `pg`. */
type Connection = ReturnType<typeof createClient>;

/** Internal: holds the pool so the module can close it on shutdown. */
const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");

/** Inject this to get the Drizzle client. */
export const DATABASE = Symbol("DATABASE");

/**
 * One pool for the process, created at startup.
 *
 * Two things must be true before this application is allowed to serve a single
 * request, and both are checked here rather than trusted:
 *
 *   1. DATABASE_URL is set. No default — a fallback connection string is how a
 *      service ends up pointed at the wrong database while reporting healthy.
 *   2. The connected role does not bypass row-level security. See
 *      assertRlsAppliesToConnection for why this cannot be left to review.
 */
async function connect(): Promise<Connection> {
  const url = process.env["DATABASE_URL"];

  if (!url) {
    throw new Error(
      "DATABASE_URL environment variable is required but was not provided.",
    );
  }

  const connection = createClient(url);

  try {
    const role = await assertRlsAppliesToConnection(connection.db);
    Logger.log(
      `Connected as "${role.name}"; row-level security applies to this connection.`,
      "DatabaseModule",
    );
  } catch (error) {
    // The pool is already open. Without this the process would keep the event
    // loop alive and hang instead of failing fast, which defeats the check.
    await connection.pool.end();
    throw error;
  }

  return connection;
}

@Global()
@Module({
  providers: [
    { provide: DATABASE_CONNECTION, useFactory: connect },
    {
      provide: DATABASE,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: Connection) => connection.db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: Connection,
  ) {}

  /** Requires `app.enableShutdownHooks()` in main.ts to fire on a signal. */
  async onApplicationShutdown(): Promise<void> {
    await this.connection.pool.end();
    Logger.log("Database pool closed.", "DatabaseModule");
  }
}
