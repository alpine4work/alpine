import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

/**
 * Monkey-patches `db.exec` to log every SQL statement
 * together with its wall-clock duration. Replaces the
 * built-in `t` open flag which only logged the SQL text.
 */
export function installTracing(db: Database): void {
    const originalExec = db.exec.bind(db);
    (db as any).exec = (sql: any, ...args: Array<any>) => {
        const sqlText = typeof sql === "string" ? sql : (sql as {sql?: string} | undefined)?.sql;
        const start = now();
        try {
            return originalExec(sql as string, ...args);
        } finally {
            const ms = now() - start;
            // eslint-disable-next-line no-console
            console.log(`[sqlite] ${ms.toFixed(2)}ms ${sqlText ?? "(unknown)"}`);
        }
    };
}
