/** The SQLite the portal uses: node:sqlite on a server, a Durable Object's storage on Cloudflare. Statements run synchronously. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { changes: number | bigint };
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** Runs `body` atomically: every write lands, or none does when it throws. Inside another transaction it joins that one. */
  transaction<T>(body: () => T): T;
  close(): void;
}

/** A Durable Object's `ctx.storage`, as far as the portal needs it. */
export interface DurableSqlStorage {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[]; readonly rowsWritten: number } };
  transactionSync<T>(body: () => T): T;
}

/** Durable Object SQLite: one statement per call, and transactions only through `transactionSync`. */
export function durableObjectDatabase(storage: DurableSqlStorage): SqlDatabase {
  const run = (query: string, params: SqlValue[]) => storage.sql.exec(query, ...params.map((value) => typeof value === "bigint" ? Number(value) : value));
  let depth = 0;
  return {
    exec(sql) {
      for (const statement of splitStatements(sql)) storage.sql.exec(statement);
    },
    prepare(sql) {
      return {
        get: (...params) => run(sql, params).toArray()[0],
        all: (...params) => run(sql, params).toArray(),
        // Cloudflare's rowsWritten also counts index entries, so an UPDATE of one indexed row reports 2: the changed rows come from SQLite.
        run: (...params) => {
          run(sql, params);
          return { changes: Number(storage.sql.exec("SELECT changes() AS n").toArray()[0]?.n ?? 0) };
        },
      };
    },
    transaction(body) {
      if (depth > 0) return body();
      depth += 1;
      try { return storage.transactionSync(body); } finally { depth -= 1; }
    },
    close() {},
  };
}

/** Splits a schema script on the semicolons that end statements; the portal's schema has none inside strings or triggers. */
export function splitStatements(sql: string): string[] {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}
