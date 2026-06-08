import type {Database, PreparedStatement} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

/**
 * Monkey-patches a {@link Database} so every executed SQL statement
 * is logged together with its wall-clock duration. Replaces the
 * built-in `t` open flag which only logged the SQL text.
 *
 * Both execution paths are covered:
 *
 * - `db.exec()` (the write path) is timed end-to-end.
 * - `db.prepare()` statements (the read path) are timed on their
 *   first `step()` — where SQLite actually does the work — and again
 *   on the first `step()` after a `reset()`/`stepReset()` rewinds the
 *   statement. Subsequent steps that just drain rows aren't logged.
 *
 * Patching only `db.exec()` (as a previous version did) missed every
 * `SELECT`, since those run through `prepare()`/`step()` and never
 * touch `exec()`.
 */
export function installTracing(db: Database): void {
    // The `oo1` `exec()` implementation prepares and steps statements
    // internally through this same patched `prepare()`. While an
    // `exec()` is in flight we suppress per-step logging so those
    // internal steps don't log on top of the single `exec` line.
    let inExec = false;

    const originalExec = db.exec.bind(db);
    (db as any).exec = (sql: any, ...args: Array<any>) => {
        const sqlText = sqlTextOf(sql);
        const wasInExec = inExec;
        inExec = true;
        const start = now();
        try {
            return originalExec(sql as string, ...args);
        } finally {
            inExec = wasInExec;
            logStatement(sqlText, now() - start);
        }
    };

    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: any): PreparedStatement => {
        const stmt = originalPrepare(sql as string);
        const sqlText = sqlTextOf(sql);

        // A prepared statement runs lazily: the first `step()` does the
        // real work. We log that first step's duration, then stay quiet
        // until the statement is rewound, at which point the next
        // `step()` logs again. `armed` means "the next step should be
        // logged".
        let armed = true;

        const originalStep = stmt.step.bind(stmt);
        stmt.step = () => {
            if (inExec || !armed) return originalStep();
            const start = now();
            try {
                return originalStep();
            } finally {
                armed = false;
                logStatement(sqlText, now() - start);
            }
        };

        const originalReset = stmt.reset.bind(stmt);
        stmt.reset = (alsoClearBinds?: boolean) => {
            const result = originalReset(alsoClearBinds);
            armed = true;
            return result;
        };

        // `stepReset()` steps once and then rewinds. Trace the step it
        // performs (when armed), then re-arm: it leaves the statement
        // reset to the beginning, so the next `step()` should log too.
        const originalStepReset = stmt.stepReset.bind(stmt);
        stmt.stepReset = () => {
            if (inExec || !armed) {
                const result = originalStepReset();
                armed = true;
                return result;
            }
            const start = now();
            try {
                return originalStepReset();
            } finally {
                armed = true;
                logStatement(sqlText, now() - start);
            }
        };

        // `stepFinalize()` steps once and finalizes. Trace that step
        // (when armed); the statement is dead afterwards so there is no
        // run to re-arm.
        const originalStepFinalize = stmt.stepFinalize.bind(stmt);
        stmt.stepFinalize = () => {
            if (inExec || !armed) return originalStepFinalize();
            const start = now();
            try {
                return originalStepFinalize();
            } finally {
                armed = false;
                logStatement(sqlText, now() - start);
            }
        };

        return stmt;
    };
}

/** Log a single traced statement with its wall-clock duration. */
function logStatement(sqlText: string | undefined, durationMs: number): void {
    // eslint-disable-next-line no-console
    console.log(`[sqlite] ${durationMs.toFixed(2)}ms ${sqlText ?? "(unknown)"}`);
}

/**
 * Extract SQL text from the argument accepted by `prepare()`/`exec()`:
 * a plain string, an `exec()` options object (`{sql}`), or an array of
 * string fragments (concatenated as SQLite itself would). Anything else
 * (a WASM pointer or typed-array SQL) yields `undefined`.
 */
function sqlTextOf(sql: unknown): string | undefined {
    if (typeof sql === "string") return sql;
    if (Array.isArray(sql)) return sql.join("");
    if (sql !== null && typeof sql === "object" && "sql" in sql) {
        return sqlTextOf((sql as {sql?: unknown}).sql);
    }
    return undefined;
}
