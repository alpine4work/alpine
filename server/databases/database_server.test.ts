import {DatabaseServer} from "~/server/databases/database_server.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import type {AccessLevel, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {hashWithPrivateSalt} from "~/shared/databases/hash_with_private_salt.js";
import {type SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {tableSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {InternalError} from "~/shared/error/error.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {AccountId, DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

interface InMemoryTable {
    pages: Map<number, {data: Uint8Array; version: number}>;
    fileSize: number;
}

class InMemoryStorage implements DatabaseServerStorage {
    private tables = new Map<DatabaseTableId, InMemoryTable>();
    private accessPolicyByTableId = new Map<DatabaseTableId, LocalAccessPolicy>();
    private lastWriteVersion = 0;

    transactionSync<T>(fn: () => T): T {
        return fn();
    }

    getDatabaseTableAccessPolicy(tableId: DatabaseTableId): LocalAccessPolicy | null {
        return this.accessPolicyByTableId.get(tableId) ?? null;
    }

    setDatabaseTableAccessPolicy(
        tableId: DatabaseTableId,
        accessPolicy: LocalAccessPolicy | null,
    ): void {
        if (accessPolicy === null) {
            this.accessPolicyByTableId.delete(tableId);
        } else {
            this.accessPolicyByTableId.set(tableId, accessPolicy);
        }
    }

    private getTable(databaseTableId: DatabaseTableId): InMemoryTable {
        let table = this.tables.get(databaseTableId);
        if (table === undefined) {
            table = {pages: new Map(), fileSize: 0};
            this.tables.set(databaseTableId, table);
        }
        return table;
    }

    readPage(
        databaseTableId: DatabaseTableId,
        index: number,
    ): {data: Uint8Array; version: number} | null {
        const table = this.tables.get(databaseTableId);
        return table?.pages.get(index) ?? null;
    }

    writePages(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): number {
        const version = ++this.lastWriteVersion;
        for (const [databaseTableId, size] of truncates) {
            const table = this.getTable(databaseTableId);
            table.fileSize = size;
            const maxPageIndex = Math.floor(size / sqlitePageSize);
            for (const [index] of table.pages) {
                if (index >= maxPageIndex) {
                    table.pages.delete(index);
                }
            }
        }
        for (const [databaseTableId, tablePages] of pages) {
            const table = this.getTable(databaseTableId);
            for (const [index, data] of tablePages) {
                table.pages.set(index, {data: new Uint8Array(data), version});
                const end = (index + 1) * sqlitePageSize;
                if (end > table.fileSize) {
                    table.fileSize = end;
                }
            }
        }
        return version;
    }

    getFileSize(databaseTableId: DatabaseTableId): number {
        return this.tables.get(databaseTableId)?.fileSize ?? 0;
    }
}

// Servers created during a test are tracked here and closed in `afterEach` so
// individual tests don't have to call `server.close()` themselves.
const openServers: Array<DatabaseServer> = [];
const testAccountId = generateId<AccountId>();
const testPrivateSalt = new Uint8Array(32).fill(7);
const testContext = {
    process: {
        waitUntil: () => {},
    },
    rpc: {
        execute: async () => ({ok: true as const}),
    },
    actor: {
        // A `System` actor with a trusted (`Test`) provenance: it passes the
        // internal-action gate (see `canRunInternalDatabaseActions`) and, being a system
        // actor, runs unrestricted by per-table access — the stand-in for privileged
        // internal setup. Per-account tests use `createSessionContext` instead.
        type: "System",
        serviceName: "Test",
        getPossiblyBotAccountIdIfExists: () => testAccountId,
    },
} as any;

function createTableInputForTest(name: string) {
    return {
        tableId: generateChronologicalId<DatabaseTableId>(),
        name,
        accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
    };
}

afterEach(() => {
    while (openServers.length > 0) {
        // Tolerate already-closed servers — earlier tests may have called close()
        // explicitly.
        try {
            openServers.pop()!.close();
        } catch {
            // ignore
        }
    }
});

async function createServerWithSchema(...statements: Array<SqlQuery>): Promise<DatabaseServer> {
    const server = await DatabaseServer.create(new InMemoryStorage(), testPrivateSalt);
    openServers.push(server);
    const db = server.unsafeGetDbForTests();
    for (const stmt of statements) {
        stmt.exec(db);
    }
    // Drain test-setup writes to durable storage so a later failed execute (which
    // discards the buffer) doesn't roll the schema out from under the test.
    server.commitBufferForTests();
    return server;
}

describe("DatabaseServer — storage failure recovery", () => {
    // A storage that delegates to an in-memory store but can be armed to throw from
    // `writePages`, simulating a durable-storage failure during the buffer drain.
    class FlakyStorage implements DatabaseServerStorage {
        private readonly inner = new InMemoryStorage();
        failNextWritePages = false;

        transactionSync<T>(fn: () => T): T {
            return this.inner.transactionSync(fn);
        }

        getDatabaseTableAccessPolicy(tableId: DatabaseTableId): LocalAccessPolicy | null {
            return this.inner.getDatabaseTableAccessPolicy(tableId);
        }

        setDatabaseTableAccessPolicy(
            tableId: DatabaseTableId,
            accessPolicy: LocalAccessPolicy | null,
        ): void {
            this.inner.setDatabaseTableAccessPolicy(tableId, accessPolicy);
        }

        readPage(
            databaseTableId: DatabaseTableId,
            index: number,
        ): {data: Uint8Array; version: number} | null {
            return this.inner.readPage(databaseTableId, index);
        }

        getFileSize(databaseTableId: DatabaseTableId): number {
            return this.inner.getFileSize(databaseTableId);
        }

        writePages(
            pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
            truncates: ReadonlyMap<DatabaseTableId, number>,
        ): number {
            if (this.failNextWritePages) {
                this.failNextWritePages = false;
                throw new InternalError("simulated storage failure");
            }
            return this.inner.writePages(pages, truncates);
        }
    }

    test("a failed buffer drain does not wedge later executes", async () => {
        const storage = new FlakyStorage();
        const server = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server);
        server.execute(testContext, sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
        });

        // Arm a storage failure: the drain (`writePages`) throws after `execute` has
        // already buffered its write.
        storage.failNextWritePages = true;
        expect(() =>
            server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data"},
            ),
        ).toThrow("simulated storage failure");

        // The failed drain must not leave the buffer dirty: a subsequent execute should
        // succeed, not throw "\_runAndPersist requires an empty buffer".
        expect(() =>
            server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (2)
                `,
                {allowWrites: "data"},
            ),
        ).not.toThrow();
    });
});

describe("DatabaseServer", () => {
    test("execute runs inside configured transactionSync", async () => {
        const calls: Array<string> = [];
        const storage = new InMemoryStorage();
        storage.transactionSync = fn => {
            calls.push("before");
            const result = fn();
            calls.push("after");
            return result;
        };
        const server = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server);

        server.execute(
            testContext,
            sql`
                SELECT
                    1 AS value
            `,
            {allowWrites: "none"},
        );

        expect(calls).toEqual(["before", "after"]);
    });

    // Pass-through smoke: rows from a SELECT come back as objects. Exhaustive SQL
    // feature coverage lives in SQLite's own test suite; we only verify the wiring.
    test("execute passes SELECT rows through", async () => {
        const server = await createServerWithSchema(
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
            sql`
                INSERT INTO
                    items (name)
                VALUES
                    ('alpha'),
                    ('beta')
            `,
        );

        const result = server.execute(
            testContext,
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
            },
        );

        expect(result.rows).toEqual([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    describe("execute read-only — page tracking", () => {
        test("returns non-empty pages map", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
            );

            const result = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );

            expect(result.readPages.get(databaseMainTableId)?.size ?? 0).toBeGreaterThan(0);
        });

        test("all page values are 4096 bytes", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT)`,

                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1, 'hello world')
                `,
            );

            const result = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );

            for (const [, pageData] of result.readPages.get(databaseMainTableId)!) {
                expect(pageData.data.byteLength).toBe(sqlitePageSize);
            }
        });

        test("pages contain actual database content", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
            );

            const result = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );

            // At least one page should be non-zero.
            let hasNonZeroPage = false;
            for (const [, pageData] of result.readPages.get(databaseMainTableId)!) {
                if (pageData.data.some(b => b !== 0)) {
                    hasNonZeroPage = true;
                    break;
                }
            }
            expect(hasNonZeroPage).toBe(true);
        });

        test("tracks page 0 and the root page of the queried table", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY, data TEXT)`,
                sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY, data TEXT)`,
                sql`CREATE TABLE t3 (id INTEGER PRIMARY KEY, data TEXT)`,

                sql`
                    INSERT INTO
                        t1
                    VALUES
                        (1, 'a')
                `,

                sql`
                    INSERT INTO
                        t2
                    VALUES
                        (1, 'b')
                `,

                sql`
                    INSERT INTO
                        t3
                    VALUES
                        (1, 'c')
                `,
            );

            // Get each table's root page (SQLite's rootpage is 1-based; our storage is
            // 0-based).
            const db = server.unsafeGetDbForTests();
            const schema = sql`
                SELECT
                    name,
                    rootpage
                FROM
                    sqlite_schema
                WHERE
                    type = 'table'
                    AND name IN ('t1', 't2', 't3')
                ORDER BY
                    name
            `.selectAll(db, {name: Schema.string, rootpage: Schema.integer});

            for (const {name, rootpage} of schema) {
                const result = server.execute(
                    testContext,
                    sql`
                        SELECT
                            *
                        FROM
                            ${sql.identifier(name)}
                    `,
                    {allowWrites: "none"},
                );
                const pageIndices = [...result.readPages.get(databaseMainTableId)!.keys()];

                // Page 0 (the schema page) is always accessed.
                expect(pageIndices).toContain(0);
                // The table's own root page should be accessed. rootpage is 1-based, our map keys
                // are 0-based.
                expect(pageIndices).toContain(rootpage - 1);
            }
        });

        test("repeated identical queries return identical readPages", async () => {
            const server = await createServerWithSchema(
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

            const result1 = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );
            const result2 = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );

            const t1 = result1.readPages.get(databaseMainTableId)!;
            const t2 = result2.readPages.get(databaseMainTableId)!;
            expect(t1.size).toBe(t2.size);
            for (const [pageIndex, pageData] of t1) {
                expect(t2.has(pageIndex)).toBe(true);
                expect(pageData).toEqual(t2.get(pageIndex));
            }
        });
    });

    // The writeLevel × action authorization matrix is covered exhaustively in
    // shared/databases/sqlite_authorizer.test.ts. The tests here only assert behavior
    // unique to DatabaseServer (page tracking, changedPages, transaction lifecycle).

    describe("execute read-only — isolation", () => {
        test("writes via unsafeGetDbForTests are visible to execute", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
            );

            const before = server.execute(
                testContext,
                sql`
                    SELECT
                        COUNT(*) AS cnt
                    FROM
                        items
                `,
                {
                    allowWrites: "none",
                },
            );
            expect(before.rows).toEqual([{cnt: 1}]);

            const db = server.unsafeGetDbForTests();
            sql`
                INSERT INTO
                    items
                VALUES
                    (2)
            `.exec(db);
            server.commitBufferForTests();

            const after = server.execute(
                testContext,
                sql`
                    SELECT
                        COUNT(*) AS cnt
                    FROM
                        items
                `,
                {
                    allowWrites: "none",
                },
            );
            expect(after.rows).toEqual([{cnt: 2}]);
        });

        test("database is usable after a failed execute (any writeLevel)", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
            );

            // Authorizer rejection.
            expect(() =>
                server.execute(
                    testContext,
                    sql`
                        INSERT INTO
                            items
                        VALUES
                            (2)
                    `,
                    {allowWrites: "none"},
                ),
            ).toThrow();
            // Reference to non-existent table.
            expect(() =>
                server.execute(
                    testContext,
                    sql`
                        SELECT
                            *
                        FROM
                            nonexistent
                    `,
                    {allowWrites: "none"},
                ),
            ).toThrow();
            // Constraint violation under writes.
            expect(() =>
                server.execute(
                    testContext,
                    sql`
                        INSERT INTO
                            items
                        VALUES
                            (1)
                    `,
                    {allowWrites: "data"},
                ),
            ).toThrow();

            // After all of the above, the server should still serve queries and accept new
            // writes.
            const after = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );
            expect(after.rows).toEqual([{id: 1}]);
            server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (2)
                `,
                {allowWrites: "data"},
            );
            const final = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                    ORDER BY
                        id
                `,
                {
                    allowWrites: "none",
                },
            );
            expect(final.rows).toEqual([{id: 1}, {id: 2}]);
        });
    });

    describe("execute — error handling", () => {
        test("invalid SQL throws regardless of writeLevel", async () => {
            const server = await createServerWithSchema();

            expect(() =>
                server.execute(testContext, sql`NOT VALID SQL`, {allowWrites: "none"}),
            ).toThrow();
            expect(() =>
                server.execute(testContext, sql`NOT VALID SQL`, {allowWrites: "data"}),
            ).toThrow();
        });
    });

    describe("storage integration", () => {
        test("writes go through to storage", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage, testPrivateSalt);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();

            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`.exec(db);
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `.exec(db);
            server.commitBufferForTests();

            // Storage should have been written to.
            expect(storage.getFileSize(databaseMainTableId)).toBeGreaterThan(0);
        });

        test("page data from execute matches what storage has", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage, testPrivateSalt);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();

            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`.exec(db);
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `.exec(db);
            server.commitBufferForTests();

            const result = server.execute(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );

            // Each page in the result should match what storage returns for that page index.
            for (const [pageIndex, pageData] of result.readPages.get(databaseMainTableId)!) {
                expect(pageData).toEqual(storage.readPage(databaseMainTableId, pageIndex));
            }
        });
    });

    describe("execute with writes — basic operations", () => {
        test("INSERT returns empty rows and non-empty changedPages", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)
            `);

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1, 'hello')
                `,
                {
                    allowWrites: "data",
                },
            );

            expect(result.rows).toEqual([]);
            expect(result.changedPages.get(databaseMainTableId)?.pages.size ?? 0).toBeGreaterThan(
                0,
            );
        });

        test("INSERT with RETURNING returns rows", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)
            `);

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1, 'hello')
                    RETURNING
                        id,
                        name
                `,
                {allowWrites: "data"},
            );

            expect(result.rows).toEqual([{id: 1, name: "hello"}]);
        });
    });

    describe("execute with writes — changed pages", () => {
        test("changedPages has before and after snapshots", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY)
            `);

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data"},
            );

            for (const [, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                expect(change.before).toBeInstanceOf(Uint8Array);
                expect(change.after).toBeInstanceOf(Uint8Array);
            }
        });

        test("all page snapshots are 4096 bytes", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY)
            `);

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data"},
            );

            for (const [, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                expect(change.before.byteLength).toBe(sqlitePageSize);
                expect(change.after.byteLength).toBe(sqlitePageSize);
            }
        });

        test("before snapshot matches pre-mutation storage state", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage, testPrivateSalt);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`.exec(db);
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `.exec(db);
            server.commitBufferForTests();

            // Snapshot storage state before the mutation.
            const prePages = new Map<number, Uint8Array>();
            for (let i = 0; i < storage.getFileSize(databaseMainTableId) / sqlitePageSize; i++) {
                prePages.set(i, new Uint8Array(storage.readPage(databaseMainTableId, i)!.data));
            }

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (2)
                `,
                {allowWrites: "data"},
            );

            for (const [pageIndex, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                const prePage = prePages.get(pageIndex) ?? new Uint8Array(sqlitePageSize);
                expect(change.before).toEqual(prePage);
            }
        });

        test("after snapshot matches post-mutation storage state", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage, testPrivateSalt);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`.exec(db);
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `.exec(db);
            server.commitBufferForTests();

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (2)
                `,
                {allowWrites: "data"},
            );

            for (const [pageIndex, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                expect(change.after).toEqual(
                    storage.readPage(databaseMainTableId, pageIndex)!.data,
                );
            }
        });

        test("before and after differ for changed pages", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY)
            `);

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data"},
            );

            // At least one page should have different before/after.
            let hasDiff = false;
            for (const [, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                if (!change.before.every((b, i) => b === change.after[i])) {
                    hasDiff = true;
                    break;
                }
            }
            expect(hasDiff).toBe(true);
        });

        test("changedPages reports per-table fileSizeInPages after the drain", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY)
            `);

            const result = server.execute(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (1)
                `,
                {allowWrites: "data"},
            );
            const entry = result.changedPages.get(databaseMainTableId);
            expect(entry).toBeDefined();
            expect(entry!.fileSizeInPages).toBeGreaterThan(0);
        });
    });

    describe("execute with writes — truncation", () => {
        // VACUUM is the one SQL path that drains a VFS-produced file truncate through
        // storage. The truncate size arrives from SQLite's `xTruncate` as an `i64`
        // (BigInt); if it isn't normalized to a JS number it poisons the
        // `Math.floor(size / pageSize)` page arithmetic in storage's `writePages`.
        // Regression guard: VACUUM that shrinks the file must drain cleanly and actually
        // shrink.
        test("VACUUM that shrinks the file drains without error", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage, testPrivateSalt);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, BLOB TEXT NOT NULL)`.exec(db);
            // Grow the file across many pages, then free them all so the VACUUM rebuild
            // produces a shrinking truncate.
            for (let i = 0; i < 200; i++) {
                sql`
                    INSERT INTO
                        items (BLOB)
                    VALUES
                        (${"x".repeat(200)})
                `.exec(db);
            }
            sql`DELETE FROM items`.exec(db);
            server.commitBufferForTests();
            const sizeBefore = storage.getFileSize(databaseMainTableId);

            server.execute(testContext, sql`VACUUM`, {allowWrites: "schema+data"});

            expect(storage.getFileSize(databaseMainTableId)).toBeLessThan(sizeBefore);
        });
    });

    describe("executeAction — rawSql", () => {
        test("SELECT returns rows in result", async () => {
            const server = await createServerWithSchema(
                sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,

                sql`
                    INSERT INTO
                        items (name)
                    VALUES
                        ('alpha'),
                        ('beta')
                `,
            );

            const {result} = server.executeAction<"rawSql">(testContext, {
                name: "rawSql",
                input: {sql: "SELECT id, name FROM items ORDER BY id"},
            });

            expect(result.rows).toEqual([
                {id: 1, name: "alpha"},
                {id: 2, name: "beta"},
            ]);
        });

        test("respects writeLevel (rawSql uses data)", async () => {
            const server = await createServerWithSchema();

            // DDL should be rejected because rawSql writeLevel is "data"
            expect(() =>
                server.executeAction(testContext, {
                    name: "rawSql",
                    input: {sql: "CREATE TABLE bad (id INTEGER)"},
                }),
            ).toThrow();
        });
    });

    describe("executeAction — internal actions", () => {
        // The allowlisted first-party backend services may run internal schema actions.
        for (const serviceName of ["AppService", "JobQueueService"] as const) {
            test(`allows the internal ${serviceName} to run internal actions`, async () => {
                const server = await createServerWithSchema();
                const internalContext = {
                    ...testContext,
                    actor: {...testContext.actor, serviceName},
                };

                const input = createTableInputForTest("Tasks");
                const {result} = server.executeAction<"createTable">(internalContext, {
                    name: "createTable",
                    input,
                });

                expect(result.tableId).toBe(input.tableId);
            });
        }

        // Everyone else is rejected: `AppClient` (a public session actor), `EdgeService`
        // (how a public request is re-signed when forwarded through the edge), another
        // backend service that has no business mutating schema (`ApiService`), and the
        // durable object's own service name (`DatabaseGroupService`) — proving it is not a
        // privilege-escalation path even though it holds the durable object's key.
        for (const serviceName of [
            "AppClient",
            "EdgeService",
            "ApiService",
            "DatabaseGroupService",
        ] as const) {
            test(`rejects the non-allowlisted ${serviceName} from running internal actions`, async () => {
                const server = await createServerWithSchema();
                const deniedContext = {
                    ...testContext,
                    actor: {...testContext.actor, serviceName},
                };

                expect(() =>
                    server.executeAction(deniedContext, {
                        name: "createTable",
                        input: createTableInputForTest("Tasks"),
                    }),
                ).toThrow("Database action createTable is internal-only");
            });
        }

        // The gate keys off the action's `internalOnly` flag, not the action name: a
        // rejected service can't reach any internal action, `syncTableMetadata` included.
        test("rejects a non-allowlisted service from every internal action", async () => {
            const server = await createServerWithSchema();
            const deniedContext = {
                ...testContext,
                actor: {...testContext.actor, serviceName: "AppClient"},
            };

            expect(() =>
                server.executeAction(deniedContext, {
                    name: "syncTableMetadata",
                    input: {
                        tableId: generateChronologicalId<DatabaseTableId>(),
                        name: "Tasks",
                        accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
                    },
                }),
            ).toThrow("Database action syncTableMetadata is internal-only");
        });

        test("accepts internal actions forwarded by trusted services", async () => {
            const server = await createServerWithSchema();
            // `syncDatabaseTableMetadataToDurableObject` reaches the durable object with an
            // AppService-issued token; the actor's payload may be the end user's session, but
            // the forwarding server code already authorized the operation.
            const appServiceContext = {
                ...testContext,
                actor: {...testContext.actor, serviceName: "AppService"},
            };

            expect(() =>
                server.executeAction(appServiceContext, {
                    name: "createTable",
                    input: createTableInputForTest("Tasks"),
                }),
            ).not.toThrow();
        });
    });

    describe("create", () => {
        test("multiple servers can coexist", async () => {
            const server1 = await createServerWithSchema(
                sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY)`,
                sql`
                    INSERT INTO
                        t1
                    VALUES
                        (1)
                `,
            );
            const server2 = await createServerWithSchema(
                sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY)`,
                sql`
                    INSERT INTO
                        t2
                    VALUES
                        (2)
                `,
            );

            expect(
                sql`
                    SELECT
                        id
                    FROM
                        t1
                `.selectValue(server1.unsafeGetDbForTests(), Schema.integer),
            ).toBe(1);
            expect(
                sql`
                    SELECT
                        id
                    FROM
                        t2
                `.selectValue(server2.unsafeGetDbForTests(), Schema.integer),
            ).toBe(2);

            server1.close();
            server2.close();
        });
    });
});

describe("DatabaseServer — per-table storage", () => {
    test("a fresh group has no tables", async () => {
        const server = await DatabaseServer.create(new InMemoryStorage(), testPrivateSalt);
        openServers.push(server);

        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(server.unsafeGetDbForTests());
        expect(tables).toEqual([]);
    });

    test("createTable stores public main metadata plus its own per-db file", async () => {
        const server = await DatabaseServer.create(new InMemoryStorage(), testPrivateSalt);
        openServers.push(server);
        const {result} = server.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        const db = server.unsafeGetDbForTests();

        // Main holds only public routing metadata — no name, no table_name; the table's
        // name appears only as a salted hash.
        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(tables).toEqual([
            {
                id: result.tableId,
                kind: "table",
                schema_version: tableSqliteMigrations(result.tableId).length,
                table_name_hash: hashWithPrivateSalt(testPrivateSalt, "tasks"),
            },
        ]);

        // The display name lives in the table's own per-db file.
        const name = sql`
            SELECT
                name
            FROM
                ${sql.tableRef(result.tableId, "_alpine_table")}
        `.selectValue(db, Schema.string);
        expect(name).toBe("Tasks");
    });

    test("re-attaches and serves an existing table after reopening", async () => {
        const storage = new InMemoryStorage();
        const server1 = await DatabaseServer.create(storage, testPrivateSalt);
        const {result} = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        server1.close();

        // Reopen on the same storage; the table must stay queryable (bootstrap skips
        // migration-current files, so this exercises attach-on-miss).
        const server2 = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server2);
        const name = sql`
            SELECT
                name
            FROM
                ${sql.tableRef(result.tableId, "_alpine_table")}
        `.selectValue(server2.unsafeGetDbForTests(), Schema.string);
        expect(name).toBe("Tasks");
    });

    test("bootstrap skips attaching migration-current tables", async () => {
        const storage = new InMemoryStorage();
        const server1 = await DatabaseServer.create(storage, testPrivateSalt);
        const {result} = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        server1.close();

        // The registry's schema_version says the file is current, so bootstrap never
        // attaches it — cold starts cost O(stale tables), not O(tables).
        const server2 = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server2);
        const attachedSchemaNames = sql`PRAGMA database_list`
            .selectAllUnknown(server2.unsafeGetDbForTests())
            .map(row => row.name);

        expect(attachedSchemaNames).not.toContain(databaseTableSchemaName(result.tableId));
    });

    test("bootstrap migrates a table whose registry schema_version is stale", async () => {
        const storage = new InMemoryStorage();
        const server1 = await DatabaseServer.create(storage, testPrivateSalt);
        const {result} = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        // Zero the registry mirror — the state every pre-existing table is in right after
        // the ALTER TABLE backfill migration.
        sql`
            UPDATE _alpine_tables
            SET
                schema_version = 0
            WHERE
                id = ${result.tableId}
        `.exec(server1.unsafeGetDbForTests());
        server1.commitBufferForTests();
        server1.close();

        // Bootstrap must attach the "stale" table, run its (no-op) migrations, and repair
        // the registry mirror so the next cold start skips it again.
        const server2 = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server2);
        const db = server2.unsafeGetDbForTests();
        const attachedSchemaNames = sql`PRAGMA database_list`
            .selectAllUnknown(db)
            .map(row => row.name);
        const registryVersion = sql`
            SELECT
                schema_version
            FROM
                _alpine_tables
            WHERE
                id = ${result.tableId}
        `.selectValue(db, Schema.integer);

        expect({
            attachedAfterBootstrap: attachedSchemaNames.includes(
                databaseTableSchemaName(result.tableId),
            ),
            registryVersion,
        }).toEqual({
            attachedAfterBootstrap: true,
            registryVersion: tableSqliteMigrations(result.tableId).length,
        });
    });

    test("re-attaches and serves an existing relation join table after reopening", async () => {
        const storage = new InMemoryStorage();
        const server1 = await DatabaseServer.create(storage, testPrivateSalt);
        const source = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        }).result;
        const target = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Projects"),
        }).result;
        const relation = server1.executeAction<"createRelationField">(testContext, {
            name: "createRelationField",
            input: {
                joinTableId: generateChronologicalId<DatabaseTableId>(),
                sourceTableId: source.tableId,
                sourceFieldName: "Project",
                targetTableId: target.tableId,
                cardinality: "many",
            },
        }).result;
        server1.close();

        const server2 = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server2);
        const joinTableId = sql`
            SELECT
                id
            FROM
                ${sql.tableRef(relation.joinTableId, "_alpine_join_table")}
        `.selectValue(server2.unsafeGetDbForTests(), Schema.id<DatabaseTableId>());
        expect(joinTableId).toBe(relation.joinTableId);
    });
});

/* eslint-disable cyberworlds/string-quotes -- raw SQL strings quote identifiers */
describe("DatabaseServer — per-table access", () => {
    function createSessionContext(accountId: AccountId | null) {
        return {
            ...testContext,
            actor: {
                serviceName: undefined,
                getPossiblyBotAccountIdIfExists: () => accountId,
            },
        } as any;
    }

    function localPolicyWithGrants(
        grants: ReadonlyArray<[AccountId, Exclude<AccessLevel, "Manage">]>,
    ): LocalAccessPolicy {
        return {
            type: "Local",
            accountGrantById: new Map(grants.map(([accountId, level]) => [accountId, {level}])),
            defaultGrant: null,
            urlGrant: null,
        };
    }

    async function createServer(): Promise<DatabaseServer> {
        const server = await DatabaseServer.create(new InMemoryStorage(), testPrivateSalt);
        openServers.push(server);
        return server;
    }

    function createTableWithPolicy(
        server: DatabaseServer,
        name: string,
        accessPolicy: LocalAccessPolicy,
    ): {tableId: DatabaseTableId; tableName: string} {
        const tableId = generateChronologicalId<DatabaseTableId>();
        const {result} = server.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: {tableId, name, accessPolicy},
        });
        return {tableId, tableName: result.tableName};
    }

    function selectAllFromTable(tableName: string) {
        return {
            name: "readonlyRawSql" as const,
            input: {sql: `SELECT * FROM "${tableName}"`},
        };
    }

    test("denies reads of a table the account has no access to", async () => {
        const server = await createServer();
        const {tableId, tableName} = createTableWithPolicy(
            server,
            "Tasks",
            databaseTableAccessPolicyForCreator(testAccountId),
        );
        const outsider = generateId<AccountId>();

        expect(() =>
            server.executeAction(createSessionContext(outsider), selectAllFromTable(tableName)),
        ).toThrow(`Permission denied for read on database table ${tableId}`);
    });

    test("allows reads at View level", async () => {
        const server = await createServer();
        const viewer = generateId<AccountId>();
        const {tableName} = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([[viewer, "View"]]),
        );

        const {result} = server.executeAction<"readonlyRawSql">(
            createSessionContext(viewer),
            selectAllFromTable(tableName),
        );

        expect(result.rows).toEqual([]);
    });

    test("denies schema changes at View level", async () => {
        const server = await createServer();
        const viewer = generateId<AccountId>();
        const {tableId} = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([[viewer, "View"]]),
        );

        expect(() =>
            server.executeAction(createSessionContext(viewer), {
                name: "renameTable",
                input: {tableId, name: "Renamed"},
            }),
        ).toThrow(`Permission denied for alter-table on database table ${tableId}`);
    });

    test("allows schema changes at Edit level", async () => {
        const server = await createServer();
        const editor = generateId<AccountId>();
        const {tableId} = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([[editor, "Edit"]]),
        );

        const {result} = server.executeAction<"renameTable">(createSessionContext(editor), {
            name: "renameTable",
            input: {tableId, name: "Renamed"},
        });

        expect(result.tableName).toBe("renamed");
    });

    test("system actors bypass per-table access", async () => {
        const server = await createServer();
        // A policy granting nobody anything; a `System` actor (holding space-wide
        // authority and no account) must still read.
        const {tableName} = createTableWithPolicy(server, "Tasks", localPolicyWithGrants([]));

        const {result} = server.executeAction<"readonlyRawSql">(
            testContext,
            selectAllFromTable(tableName),
        );

        expect(result.rows).toEqual([]);
    });

    test("a policy update through syncTableMetadata revokes access mid-session", async () => {
        const server = await createServer();
        const viewer = generateId<AccountId>();
        const {tableId, tableName} = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([[viewer, "View"]]),
        );
        server.executeAction<"readonlyRawSql">(
            createSessionContext(viewer),
            selectAllFromTable(tableName),
        );

        server.executeAction<"syncTableMetadata">(testContext, {
            name: "syncTableMetadata",
            input: {tableId, name: "Tasks", accessPolicy: localPolicyWithGrants([])},
        });

        expect(() =>
            server.executeAction(createSessionContext(viewer), selectAllFromTable(tableName)),
        ).toThrow(`Permission denied for read on database table ${tableId}`);
    });

    // Linked-records scenario: Tasks и People joined by an "Assignee" relation.
    // Account access matrix — everyone has Edit on Tasks; People access varies.
    async function createLinkedTablesScenario() {
        const server = await createServer();
        const viewPeople = generateId<AccountId>();
        const noPeople = generateId<AccountId>();
        const editBoth = generateId<AccountId>();
        const tasks = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([
                [viewPeople, "Edit"],
                [noPeople, "Edit"],
                [editBoth, "Edit"],
            ]),
        );
        const people = createTableWithPolicy(
            server,
            "People",
            localPolicyWithGrants([
                [viewPeople, "View"],
                [editBoth, "Edit"],
            ]),
        );
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        const relation = server.executeAction<"createRelationField">(testContext, {
            name: "createRelationField",
            input: {
                joinTableId,
                sourceTableId: tasks.tableId,
                sourceFieldName: "Assignee",
                targetTableId: people.tableId,
                cardinality: "many",
            },
        }).result;
        const taskRowId = generateChronologicalId<DatabaseRowId>();
        const personRowId = generateChronologicalId<DatabaseRowId>();
        server.executeAction<"createRow">(testContext, {
            name: "createRow",
            input: {tableId: tasks.tableId, rowId: taskRowId},
        });
        server.executeAction<"createRow">(testContext, {
            name: "createRow",
            input: {tableId: people.tableId, rowId: personRowId},
        });
        return {
            server,
            viewPeople,
            noPeople,
            editBoth,
            tasks,
            people,
            relation,
            taskRowId,
            personRowId,
        };
    }

    function addLinkAction(scenario: Awaited<ReturnType<typeof createLinkedTablesScenario>>) {
        return {
            name: "addLink" as const,
            input: {
                tableId: scenario.tasks.tableId,
                fieldId: scenario.relation.sourceFieldId,
                rowId: scenario.taskRowId,
                linkedRowId: scenario.personRowId,
            },
        };
    }

    test("addLink succeeds with Edit on one side and View on the other", async () => {
        const scenario = await createLinkedTablesScenario();

        expect(() =>
            scenario.server.executeAction(
                createSessionContext(scenario.viewPeople),
                addLinkAction(scenario),
            ),
        ).not.toThrow();
    });

    test("addLink is denied without access to the linked table", async () => {
        const scenario = await createLinkedTablesScenario();

        expect(() =>
            scenario.server.executeAction(
                createSessionContext(scenario.noPeople),
                addLinkAction(scenario),
            ),
        ).toThrow(`Permission denied for read on database table ${scenario.people.tableId}`);
    });

    test("removeLink succeeds with Edit on one side only", async () => {
        const scenario = await createLinkedTablesScenario();
        scenario.server.executeAction(
            createSessionContext(scenario.viewPeople),
            addLinkAction(scenario),
        );

        expect(() =>
            scenario.server.executeAction(createSessionContext(scenario.noPeople), {
                name: "removeLink",
                input: addLinkAction(scenario).input,
            }),
        ).not.toThrow();
    });

    test("join file reads are allowed with access to either side", async () => {
        const scenario = await createLinkedTablesScenario();
        const joinSchemaName = databaseTableSchemaName(scenario.relation.joinTableId);

        const {result} = scenario.server.executeAction<"readonlyRawSql">(
            createSessionContext(scenario.noPeople),
            {
                name: "readonlyRawSql",
                input: {sql: `SELECT * FROM "${joinSchemaName}"._alpine_join_table`},
            },
        );

        expect(result.rows).toHaveLength(1);
    });

    test("join file reads are denied without access to either side", async () => {
        const scenario = await createLinkedTablesScenario();
        const outsider = generateId<AccountId>();
        const joinSchemaName = databaseTableSchemaName(scenario.relation.joinTableId);

        expect(() =>
            scenario.server.executeAction(createSessionContext(outsider), {
                name: "readonlyRawSql",
                input: {sql: `SELECT * FROM "${joinSchemaName}"._alpine_join_table`},
            }),
        ).toThrow(`Permission denied for read on database table ${scenario.relation.joinTableId}`);
    });

    test("createRelationField succeeds with Edit on both sides", async () => {
        const scenario = await createLinkedTablesScenario();
        const joinTableId = generateChronologicalId<DatabaseTableId>();

        const {result} = scenario.server.executeAction<"createRelationField">(
            createSessionContext(scenario.editBoth),
            {
                name: "createRelationField",
                input: {
                    joinTableId,
                    sourceTableId: scenario.tasks.tableId,
                    sourceFieldName: "Reviewer",
                    targetTableId: scenario.people.tableId,
                    cardinality: "many",
                },
            },
        );

        expect(result.joinTableId).toBe(joinTableId);
    });

    test("view rows degrade linked records to ids when the linked table is unreadable", async () => {
        const scenario = await createLinkedTablesScenario();
        scenario.server.executeAction(
            createSessionContext(scenario.viewPeople),
            addLinkAction(scenario),
        );

        const {result} = scenario.server.executeAction<"getViewRowsPage">(
            createSessionContext(scenario.noPeople),
            {
                name: "getViewRowsPage",
                input: {
                    tableOrViewId: scenario.tasks.tableId,
                    afterCursor: null,
                    endCursor: null,
                },
            },
        );

        const fieldIndex = result.fieldIndexes.get(scenario.relation.sourceFieldId)!;
        expect(result.rows[0]![fieldIndex]).toEqual([{id: scenario.personRowId, name: null}]);
    });

    test("view schema reports linked-table read access on the relation field", async () => {
        const scenario = await createLinkedTablesScenario();

        const {result} = scenario.server.executeAction<"getViewSchema">(
            createSessionContext(scenario.noPeople),
            {
                name: "getViewSchema",
                input: {tableOrViewId: scenario.tasks.tableId},
            },
        );

        const relationField = result.fields.find(
            field => field.id === scenario.relation.sourceFieldId,
        );
        expect(relationField?.linkedTableReadAccess).toBe(false);
    });

    test("listLinkedRows redacts linked records when the linked table is unreadable", async () => {
        const scenario = await createLinkedTablesScenario();
        scenario.server.executeAction(
            createSessionContext(scenario.viewPeople),
            addLinkAction(scenario),
        );

        const {result} = scenario.server.executeAction<"listLinkedRows">(
            createSessionContext(scenario.noPeople),
            {
                name: "listLinkedRows",
                input: {
                    tableId: scenario.tasks.tableId,
                    fieldId: scenario.relation.sourceFieldId,
                    rowId: scenario.taskRowId,
                },
            },
        );

        expect(result.rows).toEqual([{id: scenario.personRowId, name: null, position: "a0"}]);
    });

    test("listLinkableRows hides candidates when the linked table is unreadable", async () => {
        const scenario = await createLinkedTablesScenario();

        const {result} = scenario.server.executeAction<"listLinkableRows">(
            createSessionContext(scenario.noPeople),
            {
                name: "listLinkableRows",
                input: {
                    tableId: scenario.tasks.tableId,
                    fieldId: scenario.relation.sourceFieldId,
                    rowId: scenario.taskRowId,
                },
            },
        );

        expect(result).toEqual({linkedTableName: "No access", rows: []});
    });

    test("view rows include linked record names when the linked table is readable", async () => {
        const scenario = await createLinkedTablesScenario();
        scenario.server.executeAction(
            createSessionContext(scenario.viewPeople),
            addLinkAction(scenario),
        );

        const {result} = scenario.server.executeAction<"getViewRowsPage">(
            createSessionContext(scenario.viewPeople),
            {
                name: "getViewRowsPage",
                input: {
                    tableOrViewId: scenario.tasks.tableId,
                    afterCursor: null,
                    endCursor: null,
                },
            },
        );

        const fieldIndex = result.fieldIndexes.get(scenario.relation.sourceFieldId)!;
        expect(result.rows[0]![fieldIndex]).toEqual([
            {id: scenario.personRowId, name: "", position: "a0"},
        ]);
    });

    test("createRelationField is denied with only View on the target", async () => {
        const scenario = await createLinkedTablesScenario();

        expect(() =>
            scenario.server.executeAction(createSessionContext(scenario.viewPeople), {
                name: "createRelationField",
                input: {
                    joinTableId: generateChronologicalId<DatabaseTableId>(),
                    sourceTableId: scenario.tasks.tableId,
                    sourceFieldName: "Reviewer",
                    targetTableId: scenario.people.tableId,
                    cardinality: "many",
                },
            }),
        ).toThrow(`Permission denied for insert on database table ${scenario.people.tableId}`);
    });
});

describe("DatabaseServer — table access levels", () => {
    test("returns the complete map, loading policies for never-attached tables", async () => {
        const storage = new InMemoryStorage();
        const server1 = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server1);
        const viewer = generateId<AccountId>();
        const readable = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: {
                tableId: generateChronologicalId<DatabaseTableId>(),
                name: "Readable",
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map([[viewer, {level: "View" as const}]]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            },
        }).result;
        const hidden = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: {
                tableId: generateChronologicalId<DatabaseTableId>(),
                name: "Hidden",
                accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
            },
        }).result;
        server1.close();

        // A fresh server on the same storage attaches nothing at bootstrap (both tables
        // are migration-current); the access map must load their policies on demand.
        const server2 = await DatabaseServer.create(storage, testPrivateSalt);
        openServers.push(server2);

        expect(server2.getTableAccessLevelsForAccount(viewer)).toEqual(
            new Map([
                [readable.tableId, "View"],
                [hidden.tableId, null],
                [databaseMainTableId, "Manage"],
            ]),
        );
    });

    test("owners report write access", async () => {
        const server = await DatabaseServer.create(new InMemoryStorage(), testPrivateSalt);
        openServers.push(server);
        const {result} = server.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });

        expect(server.getTableAccessLevelsForAccount(testAccountId).get(result.tableId)).toBe(
            "Manage",
        );
    });
});
