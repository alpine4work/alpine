import {allowAllTableAccess} from "~/shared/databases/allow_all_table_access.js";
import {Database, type ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {runMainMigrations, runTableMigrations} from "~/shared/databases/sqlite_migrations.js";
import {DatabaseTableNotAttachedError} from "~/shared/databases/table_not_attached_error.js";
import {InMemoryDatabaseServerTableStore} from "~/shared/databases/test_helpers/in_memory_database_server_table_store.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

// ---------------------------------------------------------------------------
// Test storage backend
// ---
//
// ---

interface InMemoryTable {
    pages: Map<number, {data: Uint8Array; version: number}>;
    fileSize: number;
}

/**
 * In-memory implementation of `ReadonlyDatabaseStorage` used by the tests below.
 * The {@link Database} only ever reads from this; tests drain the buffer via
 * {@link Database.getBufferedWrites} and apply it back here through {@link
 * applyBufferedWrites} when they want the writes to be durable.
 */
class InMemoryStorage implements ReadonlyDatabaseStorage {
    private nextVersion = 0;
    private readonly tables = new Map<DatabaseTableId, InMemoryTable>();

    private getTable(tableId: DatabaseTableId): InMemoryTable {
        let table = this.tables.get(tableId);
        if (table === undefined) {
            table = {pages: new Map(), fileSize: 0};
            this.tables.set(tableId, table);
        }
        return table;
    }

    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null {
        return this.tables.get(tableId)?.pages.get(index) ?? null;
    }

    getFileSize(tableId: DatabaseTableId): number {
        return this.tables.get(tableId)?.fileSize ?? 0;
    }

    /** Apply a `DatabaseBufferedWrites` snapshot to storage. */
    apply(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): void {
        const version = ++this.nextVersion;
        // Truncates apply before page writes: a truncate shrinks the file, then any pages
        // buffered past that boundary re-extend it.
        for (const [tableId, size] of truncates) {
            const table = this.getTable(tableId);
            table.fileSize = size;
            for (const [pageIndex] of table.pages) {
                if ((pageIndex + 1) * sqlitePageSize > size) {
                    table.pages.delete(pageIndex);
                }
            }
        }
        for (const [tableId, tablePages] of pages) {
            const table = this.getTable(tableId);
            for (const [pageIndex, data] of tablePages) {
                table.pages.set(pageIndex, {data: new Uint8Array(data), version});
                const end = (pageIndex + 1) * sqlitePageSize;
                if (end > table.fileSize) table.fileSize = end;
            }
        }
    }
}

/**
 * Drain the buffer, apply it to storage, and acknowledge. This is the test
 * analogue of "the caller persisted the buffered writes" in production.
 */
function commit(database: Database, storage: InMemoryStorage): void {
    const buffered = database.getBufferedWrites();
    if (buffered !== null) {
        storage.apply(buffered.pages, buffered.truncates);
    }
    database.markCommitted();
}

const openDatabases: Array<Database> = [];

function testServerOptions(): {tables: InMemoryDatabaseServerTableStore} {
    return {tables: new InMemoryDatabaseServerTableStore()};
}

afterEach(() => {
    while (openDatabases.length > 0) {
        try {
            openDatabases.pop()!.close();
        } catch {
            // ignore
        }
    }
});

async function createDatabase(
    storage: InMemoryStorage = new InMemoryStorage(),
): Promise<{database: Database; storage: InMemoryStorage}> {
    const database = await Database.create(storage);
    openDatabases.push(database);
    return {database, storage};
}

async function createDatabaseWithSchema(
    ...statements: Array<SqlQuery>
): Promise<{database: Database; storage: InMemoryStorage}> {
    const {database, storage} = await createDatabase();
    for (const stmt of statements) {
        database.executeSql(stmt, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
    }
    commit(database, storage);
    return {database, storage};
}

// ---------------------------------------------------------------------------
// Tests
// ---
//
// ---

describe("Database — execute", () => {
    test("SELECT 1 + 1 returns the computed value", async () => {
        const {database} = await createDatabase();

        const result = database.executeSql(
            sql`
                SELECT
                    1 + 1 AS result
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );

        expect(result.rows).toEqual([{result: 2}]);
    });

    test("SELECT returns rows from a populated table", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
            sql`
                INSERT INTO
                    items (name)
                VALUES
                    ('alpha'),
                    ('beta')
            `,
        );

        const result = database.executeSql(
            sql`
                SELECT
                    id,
                    name
                FROM
                    items
                ORDER BY
                    id
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );

        expect(result.rows).toEqual([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("INSERT returns no rows", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);

        const result = database.executeSql(
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );

        expect(result.rows).toEqual([]);
    });

    test("INSERT ... RETURNING returns the inserted row", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)
        `);

        const result = database.executeSql(
            sql`
                INSERT INTO
                    items
                VALUES
                    (1, 'hi')
                RETURNING
                    id,
                    name
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );

        expect(result.rows).toEqual([{id: 1, name: "hi"}]);
    });
});

describe("Database — createTrackedExecution", () => {
    test("does not run the function until snapshot is read", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);
        let runCount = 0;

        const execution = database.createTrackedExecution(
            () => {
                runCount++;
                return database.executeSql(
                    sql`
                        SELECT
                            COUNT(*) AS count
                        FROM
                            items
                    `,
                    {
                        allowWrites: "none",
                        getTableAccessLevel: allowAllTableAccess,
                    },
                ).rows[0]!.count;
            },
            {getTableAccessLevel: allowAllTableAccess},
        );

        expect(runCount).toBe(0);
        expect(execution.getSnapshot()).toBe(0);
        expect(runCount).toBe(1);
        execution.destroy();
    });

    test("invalidates eagerly but recomputes lazily", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1, 'before')
            `,
        );
        let runCount = 0;

        const execution = database.createTrackedExecution(
            () => {
                runCount++;
                return database.executeSql(
                    sql`
                        SELECT
                            name
                        FROM
                            items
                        WHERE
                            id = 1
                    `,
                    {
                        allowWrites: "none",
                        getTableAccessLevel: allowAllTableAccess,
                    },
                ).rows[0]!.name;
            },
            {getTableAccessLevel: allowAllTableAccess},
        );

        expect(execution.getSnapshot()).toBe("before");
        expect(runCount).toBe(1);

        const invalidatedPages = database.executeSql(
            sql`
                SELECT
                    name
                FROM
                    items
                WHERE
                    id = 1
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        ).readPages;

        database.executeSql(
            sql`
                UPDATE items
                SET
                    name = 'after'
                WHERE
                    id = 1
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(execution.invalidateForPages(invalidatedPages)).toBe(true);

        expect(runCount).toBe(1);
        expect(execution.getSnapshot()).toBe("after");
        expect(runCount).toBe(2);
        execution.destroy();
    });

    test("supports actions inside tracked executions", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        const execution = database.createTrackedExecution(
            () =>
                database.executeAction<"readonlyRawSql">(
                    {
                        name: "readonlyRawSql",
                        input: {sql: "SELECT COUNT(*) AS count FROM items"},
                    },
                    {getTableAccessLevel: allowAllTableAccess},
                ).result.rows[0] as {count: number},
            {getTableAccessLevel: allowAllTableAccess},
        );

        expect(execution.getSnapshot()).toEqual({count: 1});
        execution.destroy();
    });

    test("supports tracked executions inside write executions", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE source (id INTEGER PRIMARY KEY)`,
            sql`CREATE TABLE destination (value INTEGER NOT NULL)`,
            sql`
                INSERT INTO
                    source
                VALUES
                    (1)
            `,
        );
        const execution = database.createTrackedExecution(
            () =>
                database.executeSql(
                    sql`
                        SELECT
                            COUNT(*) AS count
                        FROM
                            source
                    `,
                    {
                        allowWrites: "none",
                        getTableAccessLevel: allowAllTableAccess,
                    },
                ).rows[0]!.count as number,
            {getTableAccessLevel: allowAllTableAccess},
        );

        database.execute(
            db => {
                const count = execution.getSnapshot();
                sql`
                    INSERT INTO
                        destination
                    VALUES
                        (${count})
                `.exec(db);
            },
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(database, storage);

        expect(
            database.executeSql(
                sql`
                    SELECT
                        value
                    FROM
                        destination
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ).rows,
        ).toEqual([{value: 1}]);
        execution.destroy();
    });

    test("rejects writes from tracked executions", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);
        const execution = database.createTrackedExecution(
            () => {
                database.executeSql(
                    sql`
                        INSERT INTO
                            items
                        VALUES
                            (1)
                    `,
                    {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
                );
            },
            {getTableAccessLevel: allowAllTableAccess},
        );

        expect(() => execution.getSnapshot()).toThrow(
            "nested execute cannot use broader write permissions than its parent",
        );
        execution.destroy();
    });
});

describe("Database — authorizer", () => {
    test("rejects DDL when allowWrites=data", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.executeSql(sql`CREATE TABLE t (id INTEGER)`, {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            }),
        ).toThrow();
    });

    test("rejects DML when allowWrites=none", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);

        expect(() =>
            database.executeSql(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
    });

    test("allows SELECT under any writeLevel", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        for (const level of ["none", "data", "schema+data"] as const) {
            const result = database.executeSql(
                sql`
                    SELECT
                        id
                    FROM
                        items
                `,
                {
                    allowWrites: level,
                    getTableAccessLevel: allowAllTableAccess,
                },
            );
            expect(result.rows).toEqual([{id: 1}]);
        }
    });

    test("rejects ATTACH at every public writeLevel", async () => {
        const {database} = await createDatabase();

        for (const level of ["none", "data", "schema+data"] as const) {
            expect(() =>
                database.executeSql(sql`ATTACH DATABASE '/foo' AS foo`, {
                    allowWrites: level,
                    getTableAccessLevel: allowAllTableAccess,
                }),
            ).toThrow();
        }
    });

    test("rejects ATTACH issued through the raw SQLite handle", async () => {
        const {database} = await createDatabase();
        const db = database.unsafeGetDbForTests();

        // writeLevel is null (no execute in flight); the authorizer must still ban attach.
        expect(() => sql`ATTACH DATABASE '/foo' AS foo`.exec(db)).toThrow();
    });
});

describe("Database — per-table access", () => {
    /** Attach a fresh table with a seeded `things` table and return its id. */
    async function createDatabaseWithAttachedTable(): Promise<{
        database: Database;
        otherTableId: DatabaseTableId;
    }> {
        const {database} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();
        database.attach(otherTableId);
        database.executeSql(
            sql`CREATE TABLE ${sql.tableRef(otherTableId, "things")} (id INTEGER PRIMARY KEY)`,
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );
        database.executeSql(
            sql`
                INSERT INTO
                    ${sql.tableRef(otherTableId, "things")}
                VALUES
                    (1)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        return {database, otherTableId};
    }

    test("a denied read surfaces as a typed permission error naming the table", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();
        const denyAll = () => null;

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        id
                    FROM
                        ${sql.tableRef(otherTableId, "things")}
                `,
                {allowWrites: "none", getTableAccessLevel: denyAll},
            ),
        ).toThrow(`Permission denied for read on database table ${otherTableId}`);
    });

    test("a read the resolver grants passes", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();
        const readOnly = () => "View" as const;

        const result = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(otherTableId, "things")}
            `,
            {allowWrites: "none", getTableAccessLevel: readOnly},
        );

        expect(result.rows).toEqual([{id: 1}]);
    });

    test("a write is denied when the resolver grants read only", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();
        const readOnly = () => "Comment" as const;

        expect(() =>
            database.executeSql(
                sql`
                    UPDATE ${sql.tableRef(otherTableId, "things")}
                    SET
                        id = 2
                    WHERE
                        id = 1
                `,
                {allowWrites: "data", getTableAccessLevel: readOnly},
            ),
        ).toThrow(`Permission denied for update on database table ${otherTableId}`);
    });

    test("main stays readable under a deny-all resolver", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );
        const denyAll = () => null;

        const result = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: denyAll},
        );

        expect(result.rows).toEqual([{id: 1}]);
    });

    test("VACUUM can use its transient schema under a deny-all resolver", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);

        expect(() =>
            database.executeSql(sql`VACUUM`, {
                allowWrites: "schema+data",
                getTableAccessLevel: () => null,
            }),
        ).not.toThrow();
    });

    test("getTableAccessLevel reflects the installed lookup", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();

        const {result} = database.execute(() => database.getTableAccessLevel(otherTableId), {
            allowWrites: "none",
            getTableAccessLevel: () => null,
        });

        expect(result).toBeNull();
    });

    test("getTableAccessLevel uses an explicit unrestricted lookup", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();

        const unrestricted = () => allowAllTableAccess();
        const {result} = database.execute(() => database.getTableAccessLevel(otherTableId), {
            allowWrites: "none",
            getTableAccessLevel: unrestricted,
        });

        expect(result).toBe("Manage");
    });

    test("getTableAccessLevel rejects calls outside an execution", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();

        expect(() => database.getTableAccessLevel(otherTableId)).toThrow(
            "Database table access requested outside an execution",
        );
    });

    test("tracked executions recompute under their own table access function", async () => {
        const {database, otherTableId} = await createDatabaseWithAttachedTable();

        const execution = database.createTrackedExecution(
            () => database.getTableAccessLevel(otherTableId),
            {getTableAccessLevel: () => null},
        );

        expect(execution.getSnapshot()).toBeNull();
        execution.destroy();
    });
});

describe("Database — attach", () => {
    test("attaches a fresh table and reports reads under the new tableId", async () => {
        const {database, storage} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();

        database.attach(otherTableId);

        // Write a table into the attached schema, persist, and read back. The new pager
        // must flow through the same VFS / hook plumbing as the main table.
        database.executeSql(
            sql`CREATE TABLE ${sql.tableRef(otherTableId, "items")} (id INTEGER PRIMARY KEY)`,
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );
        database.executeSql(
            sql`
                INSERT INTO
                    ${sql.tableRef(otherTableId, "items")}
                VALUES
                    (1)
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        commit(database, storage);

        const result = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(otherTableId, "items")}
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        expect(result.rows).toEqual([{id: 1}]);
        const otherReads = result.readPages.get(otherTableId);
        expect(otherReads).toBeDefined();
        expect(otherReads!.size).toBeGreaterThan(0);
        // No reads should bleed into the main table for a query that touches only the
        // attached schema.
        expect(result.readPages.has(databaseMainTableId)).toBe(false);
    });

    test("rejects re-attaching the same table", async () => {
        const {database} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();

        database.attach(otherTableId);

        expect(() => database.attach(otherTableId)).toThrow("already attached");
    });

    test("after attach, normal writeLevel still bans further ATTACH", async () => {
        const {database} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();

        database.attach(otherTableId);

        const yetAnother = generateChronologicalId<DatabaseTableId>();
        expect(() =>
            database.executeSql(
                sql`ATTACH DATABASE ${`/${yetAnother}`} AS ${sql.identifier(yetAnother)}`,
                {
                    allowWrites: "schema+data",
                    getTableAccessLevel: allowAllTableAccess,
                },
            ),
        ).toThrow();
    });

    test("attaches a fresh table mid-execute and round-trips a write", async () => {
        const {database, storage} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();

        // A server-only action like createTable attaches its own per-db file partway
        // through an in-flight execute.
        database.execute(
            db => {
                database.attach(otherTableId);
                sql`
                    CREATE TABLE ${sql.tableRef(otherTableId, "items")} (id INTEGER PRIMARY KEY)
                `.exec(db);
                sql`
                    INSERT INTO
                        ${sql.tableRef(otherTableId, "items")}
                    VALUES
                        (1)
                `.exec(db);
            },
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(database, storage);

        const result = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(otherTableId, "items")}
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        expect(result.rows).toEqual([{id: 1}]);
    });

    test("tracks writes to a mid-execute attached schema under its tableId", async () => {
        const {database} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();

        const {writtenPages} = database.execute(
            db => {
                database.attach(otherTableId);
                sql`
                    CREATE TABLE ${sql.tableRef(otherTableId, "items")} (id INTEGER PRIMARY KEY)
                `.exec(db);
            },
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );

        expect(writtenPages.get(otherTableId)?.size).toBeGreaterThan(0);
    });

    test("isAttached reflects attach state; attachIfNeeded is idempotent", async () => {
        const {database} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();

        database.attachIfNeeded(otherTableId);
        database.attachIfNeeded(otherTableId);

        expect(database.isAttached(otherTableId)).toBe(true);
    });

    test("detachTableIfAttached detaches and drops buffered writes to the table", async () => {
        const {database} = await createDatabase();
        const otherTableId = generateChronologicalId<DatabaseTableId>();
        database.attach(otherTableId);
        database.executeSql(
            sql`CREATE TABLE ${sql.tableRef(otherTableId, "items")} (id INTEGER PRIMARY KEY)`,
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );

        const detached = database.detachTableIfAttached(otherTableId);

        expect({
            detached,
            isAttached: database.isAttached(otherTableId),
            bufferedPages: database.getBufferedWrites()?.pages.get(otherTableId),
        }).toEqual({detached: true, isAttached: false, bufferedPages: undefined});
    });

    test("detachTableIfAttached is a no-op for an unattached table", async () => {
        const {database} = await createDatabase();

        expect(database.detachTableIfAttached(generateChronologicalId<DatabaseTableId>())).toBe(
            true,
        );
    });
});

describe("Database — unattached per-db file detection", () => {
    test("a query against an unattached per-db file throws TableNotAttachedError", async () => {
        const {database} = await createDatabase();
        const tableId = generateChronologicalId<DatabaseTableId>();

        // The table's file was never attached, so name resolution fails with "no such
        // table" — surfaced as TableNotAttachedError so the client attaches the file on
        // demand and retries.
        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        table_name
                    FROM
                        ${sql.tableRef(tableId, "_alpine_table")}
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow(DatabaseTableNotAttachedError);
    });

    test("the unknown database DDL error shape also becomes TableNotAttachedError", async () => {
        const {database} = await createDatabaseWithSchema(sql`CREATE TABLE items (x INTEGER)`);
        const tableId = generateChronologicalId<DatabaseTableId>();

        // CREATE INDEX against an unattached schema reports "unknown database" rather than
        // "no such table"; both must be detected.
        expect(() =>
            database.executeSql(sql`CREATE INDEX ${sql.tableRef(tableId, "i")} ON items (x)`, {
                allowWrites: "schema+data",
                getTableAccessLevel: allowAllTableAccess,
            }),
        ).toThrow(DatabaseTableNotAttachedError);
    });

    test("a missing inner table in an ATTACHED file throws the raw error, not TableNotAttachedError", async () => {
        const {database} = await createDatabase();
        const tableId = generateChronologicalId<DatabaseTableId>();

        // Attaching an empty store succeeds (valid empty DB). The inner \_alpine_table
        // genuinely doesn't exist, so this is a real error and must NOT be masked as an
        // attach-on-demand signal.
        database.attach(tableId);

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        table_name
                    FROM
                        ${sql.tableRef(tableId, "_alpine_table")}
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("no such table");
    });

    test("the server surfaces the raw SQL error, not TableNotAttachedError", async () => {
        const storage = new InMemoryStorage();
        const database = await Database.create(storage, {server: testServerOptions()});
        openDatabases.push(database);
        const tableId = generateChronologicalId<DatabaseTableId>();

        // The canonical server attaches every per-db file it touches, so an unattached
        // reference there is a genuine bug, not a fallback signal.
        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        table_name
                    FROM
                        ${sql.tableRef(tableId, "_alpine_table")}
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("no such table");
    });
});

// ---------------------------------------------------------------------------
// Attach-on-miss + LRU eviction
// ---
//
// ---

/**
 * Server-mode database with a migrated main registry and `count` registered,
 * migrated per-table files, each holding an `items` table with one row `(i)`.
 * Mirrors the post-bootstrap invariant attach-on-miss relies on: every registered
 * file is migration-current.
 */
async function createServerDatabaseWithTables(
    count: number,
    attachEvictionThresholdForTests: number,
): Promise<{database: Database; storage: InMemoryStorage; tableIds: Array<DatabaseTableId>}> {
    const storage = new InMemoryStorage();
    const database = await Database.create(storage, {
        server: testServerOptions(),
        attachEvictionThresholdForTests,
    });
    openDatabases.push(database);
    database.execute(db => runMainMigrations(db), {
        allowWrites: "schema+data",
        getTableAccessLevel: allowAllTableAccess,
    });
    commit(database, storage);

    const tableIds: Array<DatabaseTableId> = [];
    for (let i = 0; i < count; i++) {
        const tableId = generateChronologicalId<DatabaseTableId>();
        tableIds.push(tableId);
        database.execute(
            db => {
                sql`
                    INSERT INTO
                        main._alpine_tables (id, kind)
                    VALUES
                        (${tableId}, 'table')
                `.exec(db);
                database.attach(tableId);
                runTableMigrations(db, tableId);
                sql` CREATE TABLE ${sql.tableRef(tableId, "items")} (id INTEGER PRIMARY KEY) `.exec(
                    db,
                );
                sql`
                    INSERT INTO
                        ${sql.tableRef(tableId, "items")}
                    VALUES
                        (${i})
                `.exec(db);
            },
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(database, storage);
    }
    return {database, storage, tableIds};
}

describe("Database — LRU eviction at the attach threshold", () => {
    test("attaching past the threshold evicts the least-recently-used table", async () => {
        // Threshold 3 = main + 2 per-table files.
        const {database, tableIds} = await createServerDatabaseWithTables(3, 3);
        const [tableA, tableB, tableC] = tableIds as [
            DatabaseTableId,
            DatabaseTableId,
            DatabaseTableId,
        ];

        expect({
            a: database.isAttached(tableA),
            b: database.isAttached(tableB),
            c: database.isAttached(tableC),
        }).toEqual({a: false, b: true, c: true});
    });

    test("a query against an evicted table re-attaches it on demand", async () => {
        const {database, tableIds} = await createServerDatabaseWithTables(3, 3);
        const tableA = tableIds[0]!;
        expect(database.isAttached(tableA)).toBe(false);

        const result = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(tableA, "items")}
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        expect({rows: result.rows, reattached: database.isAttached(tableA)}).toEqual({
            rows: [{id: 0}],
            reattached: true,
        });
    });

    test("attach-on-miss refuses a table missing from the registry", async () => {
        const {database} = await createServerDatabaseWithTables(1, 115);
        const unregisteredTableId = generateChronologicalId<DatabaseTableId>();

        // Attaching an unregistered name would create a phantom empty file; the original
        // name-resolution error must surface instead.
        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        id
                    FROM
                        ${sql.tableRef(unregisteredTableId, "items")}
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("no such table");
        expect(database.isAttached(unregisteredTableId)).toBe(false);
    });

    test("attach-on-miss asserts the re-attached file is migration-current", async () => {
        const {database} = await createServerDatabaseWithTables(0, 115);
        const staleTableId = generateChronologicalId<DatabaseTableId>();
        // Register the table without ever migrating its file — the post-bootstrap
        // invariant attach-on-miss depends on is broken, which must be loud.
        database.executeSql(
            sql`
                INSERT INTO
                    main._alpine_tables (id, kind)
                VALUES
                    (${staleTableId}, 'table')
            `,
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        id
                    FROM
                        ${sql.tableRef(staleTableId, "items")}
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("attach-on-miss found table");
    });

    test("eviction skips tables with buffered writes", async () => {
        const {database, tableIds} = await createServerDatabaseWithTables(2, 3);
        const [tableA, tableB] = tableIds as [DatabaseTableId, DatabaseTableId];

        // Buffer a write into the LRU candidate without committing: its buffered pages
        // would be lost with its table state, so eviction must pick the other table
        // despite it being more recently used.
        database.executeSql(
            sql`
                INSERT INTO
                    ${sql.tableRef(tableA, "items")}
                VALUES
                    (100)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        // tableB was touched after tableA's insert; make tableA the LRU candidate again by
        // touching tableB even later.
        database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(tableB, "items")}
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        database.attach(generateChronologicalId<DatabaseTableId>());

        expect({a: database.isAttached(tableA), b: database.isAttached(tableB)}).toEqual({
            a: true,
            b: false,
        });
    });

    test("a schema read by the open transaction is pinned; attach overflows the threshold instead", async () => {
        // Threshold 2 = main + 1: the only eviction candidate is pinned mid-txn.
        const {database, tableIds} = await createServerDatabaseWithTables(1, 2);
        const tableA = tableIds[0]!;
        const tableB = generateChronologicalId<DatabaseTableId>();

        database.execute(
            db => {
                db.exec("BEGIN");
                sql`
                    SELECT
                        id
                    FROM
                        ${sql.tableRef(tableA, "items")}
                `.selectAllUnknown(db);
                // SQLite holds a btree read transaction on tableA until COMMIT, so DETACH reports
                // it locked; attach must proceed past the threshold using the headroom below the
                // hard SQLITE_MAX_ATTACHED limit.
                database.attach(tableB);
                db.exec("COMMIT");
            },
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );

        expect({a: database.isAttached(tableA), b: database.isAttached(tableB)}).toEqual({
            a: true,
            b: true,
        });
    });
});

describe("Database — client attach-on-miss", () => {
    test("re-attaches a table whose pages are locally cached instead of failing", async () => {
        // Populate storage through one client database...
        const storage = new InMemoryStorage();
        const first = await Database.create(storage);
        openDatabases.push(first);
        const tableId = generateChronologicalId<DatabaseTableId>();
        first.attach(tableId);
        first.executeSql(
            sql`CREATE TABLE ${sql.tableRef(tableId, "items")} (id INTEGER PRIMARY KEY)`,
            {allowWrites: "schema+data", getTableAccessLevel: allowAllTableAccess},
        );
        first.executeSql(
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, "items")}
                VALUES
                    (7)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(first, storage);

        // ...then query it from a second database that never attached it. The header page
        // is cached in storage, so attach-on-miss recovers locally instead of throwing
        // TableNotAttachedError for a server round-trip.
        const second = await Database.create(storage);
        openDatabases.push(second);
        const result = second.executeSql(
            sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(tableId, "items")}
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        expect({rows: result.rows, attached: second.isAttached(tableId)}).toEqual({
            rows: [{id: 7}],
            attached: true,
        });
    });
});

describe("Database — error handling", () => {
    test("invalid SQL throws", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.executeSql(sql`NOT VALID SQL`, {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            }),
        ).toThrow();
    });

    test("reference to non-existent table throws", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        *
                    FROM
                        nonexistent
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
    });

    test("constraint violation throws", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        expect(() =>
            database.executeSql(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
    });

    test("database remains usable after a failed execute", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        // Hit several failure modes in succession.
        expect(() =>
            database.executeSql(sql`CREATE TABLE x (id INTEGER)`, {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            }),
        ).toThrow();
        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        *
                    FROM
                        nope
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
        expect(() =>
            database.executeSql(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();

        // Subsequent reads and writes still work.
        const before = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    items
                ORDER BY
                    id
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(before.rows).toEqual([{id: 1}]);

        database.executeSql(
            sql`
                INSERT INTO
                    items
                VALUES
                    (2)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(database, storage);
        const after = database.executeSql(
            sql`
                SELECT
                    id
                FROM
                    items
                ORDER BY
                    id
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(after.rows).toEqual([{id: 1}, {id: 2}]);
    });

    test("nested read-only execute calls are tracked", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);
        const innerDb = database.unsafeGetDbForTests();

        // Trigger a re-entrant execute by registering a SQLite function that calls
        // execute() again.
        innerDb.createFunction("reenter", () => {
            const result = database.executeSql(
                sql`
                    SELECT
                        1
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            );
            return (result.rows[0] as {"1": number})["1"];
        });

        expect(
            database.executeSql(
                sql`
                    SELECT
                        reenter () AS value
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ).rows,
        ).toEqual([{value: 1}]);
    });

    test("nested execute cannot broaden write permissions", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);
        const innerDb = database.unsafeGetDbForTests();

        innerDb.createFunction("reenter", () => {
            database.executeSql(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
            );
            return 0;
        });

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        reenter ()
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("nested execute cannot use broader write permissions than its parent");
    });

    test("nested write-permission guard resets after a thrown execute", async () => {
        const {database, storage} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);
        const innerDb = database.unsafeGetDbForTests();
        innerDb.createFunction("reenter", () => {
            database.executeSql(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
            );
            return 0;
        });

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        reenter ()
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("nested execute cannot use broader write permissions than its parent");

        // Subsequent normal executes work — read and write.
        const read = database.executeSql(
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    items
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(read.rows).toEqual([{n: 0}]);

        database.executeSql(
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(database, storage);
        const after = database.executeSql(
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    items
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(after.rows).toEqual([{n: 1}]);
    });
});

describe("Database — getBufferedWrites", () => {
    test("returns null on a fresh database with no writes", async () => {
        const {database} = await createDatabase();

        // A pure read shouldn't buffer anything.
        database.executeSql(
            sql`
                SELECT
                    1
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        expect(database.getBufferedWrites()).toBeNull();
    });

    test("contains pages after a DDL+DML write", async () => {
        const {database} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );

        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        const pages = buffered!.pages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.size).toBeGreaterThan(0);
    });

    test("each buffered page is exactly sqlitePageSize bytes", async () => {
        const {database} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });

        const pages = database.getBufferedWrites()!.pages.get(databaseMainTableId)!;
        for (const [, data] of pages) {
            expect(data.byteLength).toBe(sqlitePageSize);
        }
    });

    test("returns null after markCommitted clears the buffer", async () => {
        const {database, storage} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        commit(database, storage);

        expect(database.getBufferedWrites()).toBeNull();
    });

    test("returns null after discardBuffer clears the buffer", async () => {
        const {database} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        database.discardBuffer();

        expect(database.getBufferedWrites()).toBeNull();
    });

    test("returns the same inner page-map reference across calls (live state)", async () => {
        // The docstring on getBufferedWrites promises the returned inner maps reference
        // live state. Pin it down so callers can drain into a wire format without paying
        // for a copy on every read.
        const {database} = await createDatabase();
        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });

        const first = database.getBufferedWrites();
        const second = database.getBufferedWrites();

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        // Outer map is fresh per call (different reference).
        expect(first).not.toBe(second);
        // Inner per-table page map IS shared — same reference.
        expect(first!.pages.get(databaseMainTableId)).toBe(second!.pages.get(databaseMainTableId));
    });

    test("buffer accumulates across multiple execute calls", async () => {
        const {database} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        const afterCreate = database.getBufferedWrites()!.pages.get(databaseMainTableId)!.size;

        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (2)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        const afterInserts = database.getBufferedWrites()!.pages.get(databaseMainTableId)!.size;

        expect(afterInserts).toBeGreaterThanOrEqual(afterCreate);
    });
});

describe("Database — markCommitted", () => {
    test("durable storage state is visible to subsequent reads", async () => {
        const {database, storage} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (1, 'hello')
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(database, storage);

        const result = database.executeSql(
            sql`
                SELECT
                    id,
                    val
                FROM
                    t
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        expect(result.rows).toEqual([{id: 1, val: "hello"}]);
    });

    test("is a no-op on a fresh database (no buffered writes)", async () => {
        const {database, storage} = await createDatabase();
        expect(() => database.markCommitted()).not.toThrow();
        expect(database.getBufferedWrites()).toBeNull();
        // Storage is untouched.
        expect(storage.getFileSize(databaseMainTableId)).toBe(0);
    });

    test("called twice in a row is a no-op the second time", async () => {
        const {database, storage} = await createDatabase();
        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        commit(database, storage);

        expect(() => database.markCommitted()).not.toThrow();
        expect(database.getBufferedWrites()).toBeNull();
    });

    test("writes after commit are buffered fresh, not merged with prior commit", async () => {
        const {database, storage} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        commit(database, storage);

        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        // Buffer reflects only the post-commit insert; the table-creation pages have
        // already been drained.
        const pageCount = buffered!.pages.get(databaseMainTableId)!.size;
        expect(pageCount).toBeGreaterThan(0);
    });
});

describe("Database — discardBuffer", () => {
    test("is a no-op on a fresh database (no buffered writes)", async () => {
        const {database} = await createDatabase();
        expect(() => database.discardBuffer()).not.toThrow();
        expect(database.getBufferedWrites()).toBeNull();
    });

    test("called twice in a row is a no-op the second time", async () => {
        const {database} = await createDatabase();
        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        database.discardBuffer();
        expect(() => database.discardBuffer()).not.toThrow();
        expect(database.getBufferedWrites()).toBeNull();
    });

    test("rolls back buffered writes — table no longer exists", async () => {
        const {database} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        database.discardBuffer();

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        *
                    FROM
                        t
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
    });

    test("rolls back uncommitted DML — original row count restored", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `,
        );

        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (2)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (3)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        database.discardBuffer();

        const result = database.executeSql(
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(result.rows).toEqual([{n: 1}]);
        // Storage is unchanged.
        expect(storage.getFileSize(databaseMainTableId)).toBeGreaterThan(0);
    });

    test("subsequent reads pick up externally applied page changes", async () => {
        // Goal: prove that discardBuffer invalidates SQLite's pager cache so changes to
        // underlying storage become visible. We build state in DB1, drain it to storage,
        // mutate storage out-of-band by running DB2 against the same backing store, then
        // verify DB1 sees the new state after discardBuffer.
        const {database: db1, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `,
        );

        // Prime the pager cache by reading.
        const before = db1.executeSql(
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(before.rows).toEqual([{n: 1}]);

        // External mutation: open a second database on the same storage and write through
        // it.
        const {database: db2} = await createDatabase(storage);
        db2.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (2)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        commit(db2, storage);
        db2.close();

        // Without discardBuffer, db1's pager cache may still serve the old page. After
        // discard, the next read re-issues xRead and sees the new state.
        db1.discardBuffer();
        const after = db1.executeSql(
            sql`
                SELECT
                    id
                FROM
                    t
                ORDER BY
                    id
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(after.rows).toEqual([{id: 1}, {id: 2}]);
    });

    // The two tests below are paired. They reproduce the production failure mode where
    // SQLite's change-counter optimization defeats us: client and server both
    // independently bump the database header's change counter from N to N+1, so SQLite
    // — comparing its cached counter against storage's counter — concludes "nothing
    // changed" and serves the discarded buffered write from its pager cache.
    //
    // Concrete sequence:
    //
    // 1. db1 (the "client") and db2 (the "server") share storage at baseline change
    //    counter N.
    // 2. db1 buffers an UPDATE locally (writes value A). SQLite bumps the change
    //    counter to N+1 in db1's cached page 0.
    // 3. db2 commits an independent UPDATE (writes value B) through storage. Storage's
    //    change counter becomes N+1 — same as db1's cached counter.
    // 4. db1.discardBuffer() drops db1's buffered writes (rebase: throw away the
    //    optimistic local edit).
    // 5. db1 reads. Storage now holds B; db1's pager cache holds A (the buffered,
    //    now-discarded after-image) and counter N+1 (matching storage).
    //
    // Without `PRAGMA shrink_memory`, SQLite trusts its cache and returns A. With it,
    // the cache is dropped, xRead is re-issued against storage, and B is returned —
    // the correct post-rebase state.
    async function setupCounterCollision(): Promise<{
        db1: Database;
        storage: InMemoryStorage;
        targetId: number;
    }> {
        const storage = new InMemoryStorage();
        const {database: db1} = await createDatabase(storage);
        db1.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        // Spread rows across multiple pages so the target row sits past the schema page.
        for (let i = 1; i <= 200; i++) {
            db1.executeSql(
                sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i},
                            ${i}
                        )
                `,
                {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
            );
        }
        commit(db1, storage);

        const targetId = 100;

        // db1 buffers an optimistic local update — value A. SQLite bumps the cached change
        // counter on page 0.
        db1.executeSql(
            sql`
                UPDATE t
                SET
                    v = -1
                WHERE
                    id = ${targetId}
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );

        // Prime db1's pager cache for the target row by reading it. SQLite serves the
        // buffered (A) value, and now caches that page along with page 0.
        const buffered = db1.executeSql(
            sql`
                SELECT
                    v
                FROM
                    t
                WHERE
                    id = ${targetId}
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(buffered.rows).toEqual([{v: -1}]);

        // db2 (the "server") opens against the same storage — it sees the pre-buffered
        // baseline (db1's buffer never touched storage). db2 commits its own update, which
        // bumps storage's change counter from N to N+1, matching db1's cached counter.
        const {database: db2} = await createDatabase(storage);
        db2.executeSql(
            sql`
                UPDATE t
                SET
                    v = 999
                WHERE
                    id = ${targetId}
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        commit(db2, storage);
        db2.close();

        return {db1, storage, targetId};
    }

    test("invalidates cache when local + remote both bump the change counter (normal mode)", async () => {
        const {db1, targetId} = await setupCounterCollision();

        db1.discardBuffer();

        const after = db1.executeSql(
            sql`
                SELECT
                    v
                FROM
                    t
                WHERE
                    id = ${targetId}
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        // Server's value wins — discardBuffer dropped both the local buffer and the stale
        // pager cache.
        expect(after.rows).toEqual([{v: 999}]);
    });

    test("with skipClearCacheForTests, serves the discarded local write past a counter collision", async () => {
        const {db1, targetId} = await setupCounterCollision();

        db1.discardBuffer({skipClearCacheForTests: true});

        const after = db1.executeSql(
            sql`
                SELECT
                    v
                FROM
                    t
                WHERE
                    id = ${targetId}
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        // The discarded local value wins because SQLite's cached change counter (N+1)
        // matches storage's counter (N+1, from the server's commit), so SQLite sees "no
        // external change" and serves the stale pager cache. This is exactly the failure
        // mode the normal-mode test above is guarding against.
        expect(after.rows).toEqual([{v: -1}]);
    });
});

describe("Database — read path edge cases", () => {
    test("reads past EOF return zero-filled buffers (short read)", async () => {
        // Empty storage → fileSize 0 → any read returns short. SQLite handles this
        // internally during open; we verify by simply opening and selecting from
        // sqlite_schema.
        const {database} = await createDatabase();

        const result = database.executeSql(
            sql`
                SELECT
                    name
                FROM
                    sqlite_schema
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(result.rows).toEqual([]);
    });

    test("buffered page overlays storage page", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
            sql`
                INSERT INTO
                    t
                VALUES
                    (1, 'before')
            `,
        );

        // Mutate without committing — storage still says 'before'.
        database.executeSql(
            sql`
                UPDATE t
                SET
                    val = 'after'
                WHERE
                    id = 1
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );

        // Read should see the buffered (new) value.
        const buffered = database.executeSql(
            sql`
                SELECT
                    val
                FROM
                    t
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        expect(buffered.rows).toEqual([{val: "after"}]);

        // Discard the buffer — read should see the storage value.
        database.discardBuffer();
        const fromStorage = database.executeSql(
            sql`
                SELECT
                    val
                FROM
                    t
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(fromStorage.rows).toEqual([{val: "before"}]);

        // And storage was indeed never mutated.
        expect(storage.getFileSize(databaseMainTableId)).toBeGreaterThan(0);
    });

    test("storage that throws on readPage propagates the error", async () => {
        // Populate a real storage with a wide table so the schema page (page 0) is
        // readable but later pages can be made to throw.
        const {database: setup, storage} = await createDatabase();
        setup.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        for (let i = 1; i <= 50; i++) {
            setup.executeSql(
                sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i},
                            ${"x".repeat(200)}
                        )
                `,
                {
                    allowWrites: "data",
                    getTableAccessLevel: allowAllTableAccess,
                },
            );
        }
        commit(setup, storage);
        setup.close();
        openDatabases.pop();

        // Wrap the populated storage with a proxy that throws once SQLite walks past
        // page 0.
        let failOnRead = false;
        const proxy: ReadonlyDatabaseStorage = {
            readPage(tableId, index) {
                if (failOnRead && index > 0) throw new InternalError("storage failure");
                return storage.readPage(tableId, index);
            },
            getFileSize(tableId) {
                return storage.getFileSize(tableId);
            },
        };

        const database = await Database.create(proxy);
        openDatabases.push(database);

        // Open succeeds — the proxy didn't throw yet. Now arm the failure and force a deep
        // read.
        failOnRead = true;
        // Drop SQLite's page cache so the next select re-issues xRead.
        database.discardBuffer();

        expect(() =>
            database.executeSql(
                sql`
                    SELECT
                        COUNT(*)
                    FROM
                        t
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow("storage failure");
    });

    test("storage error rethrown by execute carries the SQLite error as `cause`", async () => {
        // Same harness as above, but asserting the cause- chaining done in `runTracked`:
        // the stashed VFS error is rethrown as the outer error, with the SQLite-side error
        // attached via `.cause`.
        const {database: setup, storage} = await createDatabase();
        setup.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        for (let i = 1; i <= 50; i++) {
            setup.executeSql(
                sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i},
                            ${"x".repeat(200)}
                        )
                `,
                {
                    allowWrites: "data",
                    getTableAccessLevel: allowAllTableAccess,
                },
            );
        }
        commit(setup, storage);
        setup.close();
        openDatabases.pop();

        let failOnRead = false;
        const proxy: ReadonlyDatabaseStorage = {
            readPage(tableId, index) {
                if (failOnRead && index > 0) throw new InternalError("storage failure");
                return storage.readPage(tableId, index);
            },
            getFileSize(tableId) {
                return storage.getFileSize(tableId);
            },
        };

        const database = await Database.create(proxy);
        openDatabases.push(database);
        failOnRead = true;
        database.discardBuffer();

        let caught: unknown;
        try {
            database.executeSql(
                sql`
                    SELECT
                        COUNT(*)
                    FROM
                        t
                `,
                {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
            );
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(InternalError);
        expect((caught as Error).message).toContain("storage failure");
        // SQLite's error is chained as the cause so the original control-flow path remains
        // diagnosable.
        expect((caught as Error).cause).toBeDefined();
    });
});

describe("Database — truncate semantics", () => {
    test("VACUUM produces a buffered truncate", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)`,
            // Inflate the file then delete the rows so VACUUM has something to reclaim.
            ...Array.from(
                {length: 50},
                (_, i) => sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i + 1},
                            ${"x".repeat(200)}
                        )
                `,
            ),
            sql`DELETE FROM t`,
        );

        const sizeBefore = storage.getFileSize(databaseMainTableId);

        database.executeSql(sql`VACUUM`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });

        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        // Truncate is buffered in memory; storage isn't touched.
        expect(storage.getFileSize(databaseMainTableId)).toBe(sizeBefore);

        commit(database, storage);
        // After draining the buffer, storage actually shrinks.
        expect(storage.getFileSize(databaseMainTableId)).toBeLessThan(sizeBefore);
    });

    test("after a truncate that shrinks the file, queries still see surviving rows", async () => {
        const {database, storage} = await createDatabase();

        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        for (let i = 1; i <= 50; i++) {
            database.executeSql(
                sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i},
                            ${"x".repeat(200)}
                        )
                `,
                {
                    allowWrites: "data",
                    getTableAccessLevel: allowAllTableAccess,
                },
            );
        }
        commit(database, storage);

        database.executeSql(
            sql`
                DELETE FROM t
                WHERE
                    id > 5
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        database.executeSql(sql`VACUUM`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        commit(database, storage);

        const result = database.executeSql(
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(result.rows).toEqual([{n: 5}]);
    });

    test("buffered pages past a buffered truncate are dropped", async () => {
        // Build up a wide file in storage.
        const {database, storage} = await createDatabase();
        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        for (let i = 1; i <= 20; i++) {
            database.executeSql(
                sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i},
                            ${"x".repeat(200)}
                        )
                `,
                {
                    allowWrites: "data",
                    getTableAccessLevel: allowAllTableAccess,
                },
            );
        }
        commit(database, storage);
        const wideSize = storage.getFileSize(databaseMainTableId);
        const widePageCount = wideSize / sqlitePageSize;
        expect(widePageCount).toBeGreaterThan(2);

        // Now: write a page late in the file (still buffered), then VACUUM (which buffers
        // a truncate that should drop the late buffered write).
        database.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (1000, 'tail')
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        // The tail insert buffers some pages near the end.
        database.executeSql(
            sql`
                DELETE FROM t
                WHERE
                    id != 1000
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        database.executeSql(sql`VACUUM`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });

        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        const truncateSize = buffered!.truncates.get(databaseMainTableId);
        expect(truncateSize).toBeDefined();
        expect(truncateSize!).toBeLessThan(wideSize);

        // Every buffered page must lie within the truncated region — none should sit past
        // the new end.
        const pages = buffered!.pages.get(databaseMainTableId);
        if (pages !== undefined) {
            for (const [pageIndex] of pages) {
                expect((pageIndex + 1) * sqlitePageSize).toBeLessThanOrEqual(truncateSize!);
            }
        }
    });

    test("VACUUM does not surface the truncate in writtenPages", async () => {
        // `writtenPages` only tracks page writes. Truncates are surfaced separately, via
        // `getBufferedWrites`. Pin the contract so callers can rely on it.
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)`,
            ...Array.from(
                {length: 50},
                (_, i) => sql`
                    INSERT INTO
                        t
                    VALUES
                        (
                            ${i + 1},
                            ${"x".repeat(200)}
                        )
                `,
            ),
            sql`DELETE FROM t`,
        );

        const result = database.executeSql(sql`VACUUM`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });

        // Truncate did happen — observable via the buffer.
        const buffered = database.getBufferedWrites();
        expect(buffered?.truncates.has(databaseMainTableId)).toBe(true);

        // But VACUUM also rewrites pages; those _do_ show up in writtenPages. The contract
        // under test is narrower: there's no separate "tableId truncated" entry.
        // writtenPages is page-granular only.
        const written = result.writtenPages.get(databaseMainTableId);
        expect(written).toBeDefined();
        for (const pageIndex of written!) {
            expect(typeof pageIndex).toBe("number");
            expect(pageIndex).toBeGreaterThanOrEqual(0);
        }
        commit(database, storage);
    });
});

describe("Database — page tracking", () => {
    test("readPages includes page 0 (schema page)", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        const result = database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        const pages = result.readPages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.has(0)).toBe(true);
    });

    test("writtenPages is empty for read-only execute", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        const result = database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        expect(result.writtenPages.size).toBe(0);
    });

    test("writtenPages is non-empty for INSERT", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);

        const result = database.executeSql(
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        const pages = result.writtenPages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.size).toBeGreaterThan(0);
    });

    test("reading the same query twice returns identical readPages", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1),
                    (2),
                    (3)
            `,
        );

        const r1 = database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        const r2 = database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        const p1 = [...(r1.readPages.get(databaseMainTableId) ?? [])].sort();
        const p2 = [...(r2.readPages.get(databaseMainTableId) ?? [])].sort();
        expect(p1).toEqual(p2);
    });

    test("readPages captures cache-hit reads via pageAccessHook", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1, 'a')
            `,
        );

        // Prime the cache.
        database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        // Second read likely serves from the pager cache — xRead may not fire — but the
        // page-access hook must still record the page in readPages.
        const result = database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        const pages = result.readPages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.size).toBeGreaterThan(0);
    });

    test("readPages and writtenPages from a previous call do not leak into the next", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            sql`CREATE TABLE a (id INTEGER PRIMARY KEY)`,
            sql`CREATE TABLE b (id INTEGER PRIMARY KEY)`,
        );
        commit(database, storage);

        const first = database.executeSql(
            sql`
                INSERT INTO
                    a
                VALUES
                    (1)
            `,
            {
                allowWrites: "data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        const second = database.executeSql(
            sql`
                SELECT
                    *
                FROM
                    b
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );

        // The second call should not include any writes.
        expect(second.writtenPages.size).toBe(0);
        // And the first call should not include any leak from a future invocation.
        // (Covered by structural type; the assert below just sanity-checks that each call
        // got its own map.)
        expect(first.readPages).not.toBe(second.readPages);
        expect(first.writtenPages).not.toBe(second.writtenPages);
    });
});

describe("Database — executeAction", () => {
    test("rawSql returns rows", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
            sql`
                INSERT INTO
                    items (name)
                VALUES
                    ('alpha'),
                    ('beta')
            `,
        );

        const {result} = database.executeAction<"rawSql">(
            {
                name: "rawSql",
                input: {
                    sql: sql`
                        SELECT
                            id,
                            name
                        FROM
                            items
                        ORDER BY
                            id
                    `.query,
                },
            },
            {getTableAccessLevel: allowAllTableAccess},
        );

        expect(result.rows).toEqual([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("rawSql rejects DDL (writeLevel='data')", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.executeAction(
                {
                    name: "rawSql",
                    input: {sql: sql`CREATE TABLE bad (id INTEGER)`.query},
                },
                {getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
    });

    test("readonlyRawSql rejects DML (writeLevel='none')", async () => {
        const {database} = await createDatabaseWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);

        expect(() =>
            database.executeAction(
                {
                    name: "readonlyRawSql",
                    input: {
                        sql: sql`
                            INSERT INTO
                                items
                            VALUES
                                (1)
                        `.query,
                    },
                },
                {getTableAccessLevel: allowAllTableAccess},
            ),
        ).toThrow();
    });

    test("returns readPages and writtenPages tracking", async () => {
        const {database} = await createDatabaseWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `,
        );

        const {readPages} = database.executeAction(
            {
                name: "readonlyRawSql",
                input: {
                    sql: sql`
                        SELECT
                            *
                        FROM
                            items
                    `.query,
                },
            },
            {getTableAccessLevel: allowAllTableAccess},
        );

        expect(readPages.get(databaseMainTableId)?.size ?? 0).toBeGreaterThan(0);
    });
});

describe("Database — independence between instances", () => {
    test("two databases on independent storages do not share state", async () => {
        const {database: db1} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`,
            sql`
                INSERT INTO
                    t
                VALUES
                    (1, 'one')
            `,
        );
        const {database: db2} = await createDatabaseWithSchema(
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`,
            sql`
                INSERT INTO
                    t
                VALUES
                    (1, 'two')
            `,
        );

        const r1 = db1.executeSql(
            sql`
                SELECT
                    v
                FROM
                    t
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        const r2 = db2.executeSql(
            sql`
                SELECT
                    v
                FROM
                    t
            `,
            {allowWrites: "none", getTableAccessLevel: allowAllTableAccess},
        );
        expect(r1.rows).toEqual([{v: "one"}]);
        expect(r2.rows).toEqual([{v: "two"}]);
    });

    test("buffered writes in one database do not appear in another sharing storage", async () => {
        // Two databases on the same storage. db1 buffers a write but doesn't commit; db2
        // should not see it.
        const storage = new InMemoryStorage();
        const {database: db1} = await createDatabase(storage);
        db1.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        commit(db1, storage);

        const {database: db2} = await createDatabase(storage);

        db1.executeSql(
            sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `,
            {allowWrites: "data", getTableAccessLevel: allowAllTableAccess},
        );
        // db1's insert is only in its in-memory buffer.

        const result = db2.executeSql(
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
            {
                allowWrites: "none",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        expect(result.rows).toEqual([{n: 0}]);
    });
});

describe("Database — close", () => {
    test("close after writes does not throw", async () => {
        const {database} = await createDatabase();
        database.executeSql(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
            getTableAccessLevel: allowAllTableAccess,
        });
        expect(() => database.close()).not.toThrow();
    });
});
