import { DatabaseSync } from "node:sqlite";

import type { SqlDatabase, SqlValue } from "./sql.ts";

/** The portal's database in a file, for a server and for the tests. */
export function nodeDatabase(file: string): SqlDatabase {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get: (...params: SqlValue[]) => statement.get(...params),
        all: (...params: SqlValue[]) => statement.all(...params),
        run: (...params: SqlValue[]) => statement.run(...params),
      };
    },
    transaction(body) {
      if (db.isTransaction) return body();
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = body();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
  };
}
