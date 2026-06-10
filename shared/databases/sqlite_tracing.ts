import type {Database, PreparedStatement} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

/**
 * Monkey-patches a {@link Database} so every executed SQL statement is logged
 * together with its wall-clock duration. Replaces the built-in `t` open flag which
 * only logged the SQL text.
 *
 * Both execution paths are covered:
 *
 * - `db.exec()` (the write path) is timed end-to-end.
 * - `db.prepare()` statements (the read path) are timed from their first `step()`
 *   — where SQLite begins doing work — until the statement is finalized or rewound
 *   via `reset()`/`stepReset()`, which is when the line is logged. A statement
 *   reused across several `reset()`s logs once per run.
 *
 * Patching only `db.exec()` (as a previous version did) missed every `SELECT`,
 * since those run through `prepare()`/`step()` and never touch `exec()`.
 */
export function installTracing(db: Database): void {
    // The `oo1` `exec()` implementation prepares and steps statements internally
    // through this same patched `prepare()`. While an `exec()` is in flight we
    // suppress per-step logging so those internal steps don't log on top of the single
    // `exec` line.
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

        // A prepared statement runs lazily across a "run": timing starts at the first
        // `step()` (where SQLite begins doing work) and the line is logged when the run
        // ends — on `finalize()` or a `reset()`/`stepReset()` rewind. `startedAt` is null
        // while no run is in progress.
        let startedAt: number | null = null;
        function endRun(): void {
            if (startedAt === null) return;
            logStatement(sqlText, now() - startedAt);
            startedAt = null;
        }

        const originalStep = stmt.step.bind(stmt);
        stmt.step = () => {
            if (!inExec && startedAt === null) startedAt = now();
            return originalStep();
        };

        const originalReset = stmt.reset.bind(stmt);
        stmt.reset = (alsoClearBinds?: boolean) => {
            endRun();
            return originalReset(alsoClearBinds);
        };

        const originalFinalize = stmt.finalize.bind(stmt);
        stmt.finalize = () => {
            endRun();
            return originalFinalize();
        };

        // `stepReset()` steps once and then rewinds: it both starts a run (its step) and
        // ends it (its reset), so log around it.
        const originalStepReset = stmt.stepReset.bind(stmt);
        stmt.stepReset = () => {
            if (!inExec && startedAt === null) startedAt = now();
            try {
                return originalStepReset();
            } finally {
                endRun();
            }
        };

        // `stepFinalize()` steps once and finalizes — same shape as `stepReset()`: start
        // on its step, log on its finalize.
        const originalStepFinalize = stmt.stepFinalize.bind(stmt);
        stmt.stepFinalize = () => {
            if (!inExec && startedAt === null) startedAt = now();
            try {
                return originalStepFinalize();
            } finally {
                endRun();
            }
        };

        return stmt;
    };
}

/** Log a single traced statement with its wall-clock duration. */
function logStatement(sqlText: string | undefined, durationMs: number): void {
    // Collapse the multi-line, indented SQL our tagged template produces onto a single
    // line so each statement is one log line.
    const oneLine = sqlText?.trim().replace(/\s+/g, " ");
    // eslint-disable-next-line no-console
    console.log(`[sqlite] ${durationMs.toFixed(2)}ms ${oneLine || "(unknown)"}`);
}

/**
 * Extract SQL text from the argument accepted by `prepare()`/`exec()`: a plain
 * string, an `exec()` options object (`{sql}`), or an array of string fragments
 * (concatenated as SQLite itself would). Anything else (a WASM pointer or
 * typed-array SQL) yields `undefined`.
 */
function sqlTextOf(sql: unknown): string | undefined {
    if (typeof sql === "string") return sql;
    if (Array.isArray(sql)) return sql.join("");
    if (sql !== null && typeof sql === "object" && "sql" in sql) {
        return sqlTextOf((sql as {sql?: unknown}).sql);
    }
    return undefined;
}
