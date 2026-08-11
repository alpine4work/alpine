import {jest} from "@jest/globals";
import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {
    databaseDurableObjectSqlMigrations,
    runDatabaseDurableObjectSqlMigrations,
} from "~/server/databases/database_durable_object_sql_migrations.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {noTruncates} from "~/server/databases/test_helpers/no_truncates.js";
import {truncateFor} from "~/server/databases/test_helpers/truncate_for.js";
import {writePagesFor} from "~/server/databases/test_helpers/write_pages_for.js";
import type {AccessLevel, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {type SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {tableSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {captureResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    AccountId,
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

// In-memory durable object storage, as patched by our Miniflare polyfill. The
// polyfill's `sql`/`transactionSync` aren't in the upstream .d.ts TypeScript
// resolves for the global `DurableObjectStorage` type — cast through `any`.
function createStorage(): any {
    return new DurableObjectStorage(new MemoryStorage());
}

// Servers created during a test are tracked here and closed in `afterEach` so
// individual tests don't have to call `server.close()` themselves.
const openServers: Array<DatabaseServer> = [];
const testAccountId = generateId<AccountId>();
const testContext = {
    process: {
        waitUntil: () => {},
    },
    rpc: {
        execute: async () => ({ok: true as const}),
    },
    actor: {
        // A `System` actor with a trusted (`Test`) provenance: it passes the
        // internal-action gate (see `isInternalDatabaseServiceActor`) and, being a system
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
        policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
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
    const server = await DatabaseServer.create(createStorage());
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
    test("a failed buffer drain does not wedge later executes", async () => {
        const server = await DatabaseServer.create(createStorage());
        openServers.push(server);
        server.executeForTests(testContext, sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`, {
            allowWrites: "schema+data",
        });

        // Arm a storage failure: the drain (`writePages`) throws after `execute` has
        // already buffered its write. Later calls fall through to the real implementation.
        jest.spyOn(server, "writePages").mockImplementationOnce(() => {
            throw new InternalError("simulated storage failure");
        });
        expect(() =>
            server.executeForTests(
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
            server.executeForTests(
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

    test("a partial page drain rolls back pages, metadata, and caches", async () => {
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();
        const exec = storage.sql.exec.bind(storage.sql);
        let pageWriteCount = 0;
        const execSpy = jest
            .spyOn(storage.sql, "exec")
            .mockImplementation((...args: Array<unknown>) => {
                if (
                    String(args[0]).includes(
                        "INSERT INTO\n                        database_table_pages",
                    )
                ) {
                    pageWriteCount++;
                    if (pageWriteCount === 2) {
                        throw new InternalError("simulated partial page drain");
                    }
                }
                return exec(...args);
            });

        const writeResult = captureResult(() =>
            server.writePages(
                new Map([
                    [tableA, new Map([[0, new Uint8Array(sqlitePageSize)]])],
                    [tableB, new Map([[0, new Uint8Array(sqlitePageSize)]])],
                ]),
                noTruncates,
            ),
        );
        execSpy.mockRestore();

        const tableRows = [
            ...storage.sql.exec(
                "SELECT file_size_in_pages, last_version FROM database_tables WHERE table_id IN (?, ?)",
                tableA,
                tableB,
            ),
        ];
        const rolledBackSize = server.getFileSize(tableA);
        const retryVersion = writePagesFor(
            server,
            tableA,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );

        expect({
            error: writeResult.ok ? null : String(writeResult.error),
            rolledBackSize,
            tableRows,
            retryPage: server.readPage(tableA, 0)?.version,
            retrySize: server.getFileSize(tableA),
        }).toEqual({
            error: "InternalError: simulated partial page drain",
            rolledBackSize: 0,
            tableRows: [],
            retryPage: retryVersion,
            retrySize: sqlitePageSize,
        });
    });

    test("a rolled-back version cannot escape as a snapshot watermark", async () => {
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        const tableId = generateChronologicalId<DatabaseTableId>();
        const exec = storage.sql.exec.bind(storage.sql);
        const execSpy = jest.spyOn(storage.sql, "exec").mockImplementation((...args) => {
            if (
                String(args[0]).includes(
                    "INSERT INTO\n                        database_table_pages",
                )
            ) {
                throw new InternalError("simulated page drain failure");
            }
            return exec(...args);
        });

        const writeResult = captureResult(() =>
            writePagesFor(server, tableId, new Map([[0, new Uint8Array(sqlitePageSize)]])),
        );
        execSpy.mockRestore();
        const snapshotVersion = server.executeForTests(
            testContext,
            sql`
                SELECT
                    1
            `,
            {
                allowWrites: "none",
            },
        ).snapshotVersion;

        server.close();
        const reloaded = await DatabaseServer.create(storage);
        openServers.push(reloaded);
        const nextVersion = writePagesFor(
            reloaded,
            tableId,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );

        expect({
            error: writeResult.ok ? null : String(writeResult.error),
            nextVersionIsAfterSnapshot: nextVersion > snapshotVersion,
        }).toEqual({
            error: "InternalError: simulated page drain failure",
            nextVersionIsAfterSnapshot: true,
        });
    });
});

describe("DatabaseServer", () => {
    test("execute runs inside the storage transactionSync", async () => {
        const calls: Array<string> = [];
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        // Wrap after create — bootstrap and migrations would otherwise add noise.
        const transactionSync = storage.transactionSync.bind(storage);
        storage.transactionSync = (fn: () => unknown) => {
            calls.push("before");
            const result = transactionSync(fn);
            calls.push("after");
            return result;
        };

        server.executeForTests(
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

        const result = server.executeForTests(
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

    test("a read-only execute reports the current snapshot version", async () => {
        const server = await createServerWithSchema(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY)
        `);
        const storedVersion = server.readPage(databaseMainTableId, 0)!.version;

        const result = server.executeForTests(
            testContext,
            sql`
                SELECT
                    *
                FROM
                    items
            `,
            {
                allowWrites: "none",
            },
        );

        expect({
            snapshotVersion: result.snapshotVersion,
            changedPageCount: result.changedPages.size,
        }).toEqual({snapshotVersion: storedVersion, changedPageCount: 0});
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

            const result = server.executeForTests(
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

            const result = server.executeForTests(
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

            const result = server.executeForTests(
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
                    type = 'Table'
                    AND name IN ('t1', 't2', 't3')
                ORDER BY
                    name
            `.selectAll(db, {name: Schema.string, rootpage: Schema.integer});

            for (const {name, rootpage} of schema) {
                const result = server.executeForTests(
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

            const result1 = server.executeForTests(
                testContext,
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {allowWrites: "none"},
            );
            const result2 = server.executeForTests(
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

            const before = server.executeForTests(
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

            const after = server.executeForTests(
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
                server.executeForTests(
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
                server.executeForTests(
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
                server.executeForTests(
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
            const after = server.executeForTests(
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
            server.executeForTests(
                testContext,
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (2)
                `,
                {allowWrites: "data"},
            );
            const final = server.executeForTests(
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
                server.executeForTests(testContext, sql`NOT VALID SQL`, {allowWrites: "none"}),
            ).toThrow();
            expect(() =>
                server.executeForTests(testContext, sql`NOT VALID SQL`, {allowWrites: "data"}),
            ).toThrow();
        });
    });

    describe("storage integration", () => {
        test("writes go through to storage", async () => {
            const server = await DatabaseServer.create(createStorage());
            openServers.push(server);
            const db = server.unsafeGetDbForTests();
            // Bootstrap already wrote main's migration pages, so assert on the schema page's
            // version bumping rather than the file merely existing.
            const versionBefore = server.readPage(databaseMainTableId, 0)!.version;

            sql`CREATE TABLE items (id INTEGER PRIMARY KEY)`.exec(db);
            sql`
                INSERT INTO
                    items
                VALUES
                    (1)
            `.exec(db);
            server.commitBufferForTests();

            expect(server.readPage(databaseMainTableId, 0)!.version).toBeGreaterThan(versionBefore);
        });

        test("page data from execute matches what storage has", async () => {
            const server = await DatabaseServer.create(createStorage());
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

            const result = server.executeForTests(
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
                const stored = server.readPage(databaseMainTableId, pageIndex)!;
                expect(pageData).toEqual({
                    data: new Uint8Array(stored.data),
                    version: stored.version,
                });
            }
        });
    });

    describe("execute with writes — basic operations", () => {
        test("INSERT returns empty rows and non-empty changedPages", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)
            `);

            const result = server.executeForTests(
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

            const result = server.executeForTests(
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

            const result = server.executeForTests(
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

            const result = server.executeForTests(
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
            const server = await DatabaseServer.create(createStorage());
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
            for (let i = 0; i < server.getFileSize(databaseMainTableId) / sqlitePageSize; i++) {
                prePages.set(i, new Uint8Array(server.readPage(databaseMainTableId, i)!.data));
            }

            const result = server.executeForTests(
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
            const server = await DatabaseServer.create(createStorage());
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

            const result = server.executeForTests(
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
                    new Uint8Array(server.readPage(databaseMainTableId, pageIndex)!.data),
                );
            }
        });

        test("before and after differ for changed pages", async () => {
            const server = await createServerWithSchema(sql`
                CREATE TABLE items (id INTEGER PRIMARY KEY)
            `);

            const result = server.executeForTests(
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

            const result = server.executeForTests(
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
            const server = await DatabaseServer.create(createStorage());
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
            const sizeBefore = server.getFileSize(databaseMainTableId);

            server.executeForTests(testContext, sql`VACUUM`, {allowWrites: "schema+data"});

            expect(server.getFileSize(databaseMainTableId)).toBeLessThan(sizeBefore);
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
        for (const serviceName of ["AppService", "JobQueueService", "ApiService"] as const) {
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
        // (how a public request is re-signed when forwarded through the edge), and the
        // durable object's own service name (`DatabaseGroupService`) — proving it is not a
        // privilege-escalation path even though it holds the durable object's key.
        for (const serviceName of ["AppClient", "EdgeService", "DatabaseGroupService"] as const) {
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
                        policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
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

        test("internalOnly actions bypass per-table access even for a non-system session", async () => {
            const server = await createServerWithSchema();
            const creator = generateId<AccountId>();
            // The production path: `createDatabaseTable` forwards the creator's session with
            // AppService provenance — a session actor, not `System`. createTable is a schema
            // mutation that writes the shared registry and a not-yet-mapped file, so it can
            // only run with a full grant: being `internalOnly` is what grants it, not the
            // actor type.
            const appServiceSession = {
                ...testContext,
                actor: {
                    type: "Session",
                    serviceName: "AppService",
                    getPossiblyBotAccountIdIfExists: () => creator,
                },
            };
            const tableId = generateChronologicalId<DatabaseTableId>();

            const {result} = server.executeAction<"createTable">(appServiceSession, {
                name: "createTable",
                input: {
                    tableId,
                    name: "Tasks",
                    accessPolicy: databaseTableAccessPolicyForCreator(creator),
                    policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
                },
            });

            expect(result.tableId).toBe(tableId);
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
        const server = await DatabaseServer.create(createStorage());
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
        const server = await DatabaseServer.create(createStorage());
        openServers.push(server);
        const {result} = server.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        const db = server.unsafeGetDbForTests();

        // Main holds only public routing metadata — no name, no table_name; those live in
        // the per-db file and the server-only table store.
        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(tables).toEqual([
            {
                id: result.tableId,
                kind: "Table",
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
        const storage = createStorage();
        const server1 = await DatabaseServer.create(storage);
        const {result} = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        server1.close();

        // Reopen on the same storage; the table must stay queryable (bootstrap skips
        // migration-current files, so this exercises attach-on-miss).
        const server2 = await DatabaseServer.create(storage);
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
        const storage = createStorage();
        const server1 = await DatabaseServer.create(storage);
        const {result} = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        server1.close();

        // The registry's schema_version says the file is current, so bootstrap never
        // attaches it — cold starts cost O(stale tables), not O(tables).
        const server2 = await DatabaseServer.create(storage);
        openServers.push(server2);
        const attachedSchemaNames = sql`PRAGMA database_list`
            .selectAllUnknown(server2.unsafeGetDbForTests())
            .map(row => row.name);

        expect(attachedSchemaNames).not.toContain(databaseTableSchemaName(result.tableId));
    });

    test("bootstrap migrates a table whose stored schema_version is stale", async () => {
        const storage = createStorage();
        const server1 = await DatabaseServer.create(storage);
        const {result} = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });
        // Zero the stored mirror — the state a pre-existing table is in when new per-table
        // migrations ship.
        server1.setDatabaseTableSchemaVersion(result.tableId, 0);
        server1.close();

        // Bootstrap must attach the "stale" table, run its (no-op) migrations, and repair
        // the stored mirror so the next cold start skips it again.
        const server2 = await DatabaseServer.create(storage);
        openServers.push(server2);
        const attachedSchemaNames = sql`PRAGMA database_list`
            .selectAllUnknown(server2.unsafeGetDbForTests())
            .map(row => row.name);
        const storedVersion = server2
            .listDatabaseTables()
            .find(table => table.tableId === result.tableId)?.schemaVersion;

        expect({
            attachedAfterBootstrap: attachedSchemaNames.includes(
                databaseTableSchemaName(result.tableId),
            ),
            storedVersion,
        }).toEqual({
            attachedAfterBootstrap: true,
            storedVersion: tableSqliteMigrations(result.tableId).length,
        });
    });

    test("re-attaches and serves an existing relation join table after reopening", async () => {
        const storage = createStorage();
        const server1 = await DatabaseServer.create(storage);
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
                cardinality: "Many",
            },
        }).result;
        server1.close();

        const server2 = await DatabaseServer.create(storage);
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
        const server = await DatabaseServer.create(createStorage());
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
            input: {
                tableId,
                name,
                accessPolicy,
                policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
            },
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

        // `createField` writes field metadata and then ALTERs the data table to add its
        // column; the denial fires on the first write it attempts.
        expect(() =>
            server.executeAction(createSessionContext(viewer), {
                name: "createField",
                input: {
                    fieldId: generateChronologicalId<DatabaseFieldId>(),
                    tableId,
                    name: "Notes",
                    config: {type: "PlainText"},
                },
            }),
        ).toThrow(`Permission denied for insert on database table ${tableId}`);
    });

    test("allows schema changes at Edit level", async () => {
        const server = await createServer();
        const editor = generateId<AccountId>();
        const {tableId} = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([[editor, "Edit"]]),
        );

        expect(() =>
            server.executeAction(createSessionContext(editor), {
                name: "createField",
                input: {
                    fieldId: generateChronologicalId<DatabaseFieldId>(),
                    tableId,
                    name: "Notes",
                    config: {type: "PlainText"},
                },
            }),
        ).not.toThrow();
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
            input: {
                tableId,
                name: "Tasks",
                accessPolicy: localPolicyWithGrants([]),
                policyRevision: {tableMetadataVersion: 2, sourcePolicyVersion: 0},
            },
        });

        expect(() =>
            server.executeAction(createSessionContext(viewer), selectAllFromTable(tableName)),
        ).toThrow(`Permission denied for read on database table ${tableId}`);
    });

    test("a stale metadata sync cannot restore a policy or table name", async () => {
        const server = await createServer();
        const viewer = generateId<AccountId>();
        const {tableId} = createTableWithPolicy(
            server,
            "Tasks",
            localPolicyWithGrants([[viewer, "View"]]),
        );
        const currentPolicy = localPolicyWithGrants([]);

        server.executeAction<"syncTableMetadata">(testContext, {
            name: "syncTableMetadata",
            input: {
                tableId,
                name: "Current",
                accessPolicy: currentPolicy,
                policyRevision: {tableMetadataVersion: 2, sourcePolicyVersion: 5},
            },
        });
        const staleResult = server.executeAction<"syncTableMetadata">(testContext, {
            name: "syncTableMetadata",
            input: {
                tableId,
                name: "Stale",
                accessPolicy: localPolicyWithGrants([[viewer, "View"]]),
                policyRevision: {tableMetadataVersion: 2, sourcePolicyVersion: 4},
            },
        }).result;

        expect({
            policy: server.getDatabaseTableAccessPolicy(tableId),
            tableName: staleResult.tableName,
        }).toEqual({policy: currentPolicy, tableName: "current"});
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
                cardinality: "Many",
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
                    cardinality: "Many",
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
                    cardinality: "Many",
                },
            }),
        ).toThrow(`Permission denied for insert on database table ${scenario.people.tableId}`);
    });
});

describe("DatabaseServer — table access levels", () => {
    test("returns the complete map, loading policies for never-attached tables", async () => {
        const storage = createStorage();
        const server1 = await DatabaseServer.create(storage);
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
                policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
            },
        }).result;
        const hidden = server1.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: {
                tableId: generateChronologicalId<DatabaseTableId>(),
                name: "Hidden",
                accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
                policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
            },
        }).result;
        server1.close();

        // A fresh server on the same storage attaches nothing at bootstrap (both tables
        // are migration-current); access levels read policies straight from storage.
        const server2 = await DatabaseServer.create(storage);
        openServers.push(server2);

        expect({
            readable: server2.getTableAccessLevelForAccount(readable.tableId, viewer),
            hidden: server2.getTableAccessLevelForAccount(hidden.tableId, viewer),
        }).toEqual({readable: "View", hidden: null});
    });

    test("owners report write access", async () => {
        const server = await DatabaseServer.create(createStorage());
        openServers.push(server);
        const {result} = server.executeAction<"createTable">(testContext, {
            name: "createTable",
            input: createTableInputForTest("Tasks"),
        });

        expect(server.getTableAccessLevelForAccount(result.tableId, testAccountId)).toBe("Manage");
    });
});

describe("DatabaseServer — built-in SQLite migrations", () => {
    test("runs and records built-in SQLite migrations", () => {
        const storage = createStorage();

        runDatabaseDurableObjectSqlMigrations(storage);

        const version = storage.sql.exec("SELECT MAX(version) AS version FROM _migrations").next()
            .value.version;
        expect({
            version,
            tableNames: [...storage.sql.exec("SELECT name FROM sqlite_master")].map(
                ({name}: {name: string}) => name,
            ),
            pageForeignKeys: [
                ...storage.sql.exec("PRAGMA foreign_key_list(database_table_pages)"),
            ].map(({table}: {table: string}) => table),
        }).toEqual({
            version: databaseDurableObjectSqlMigrations.length,
            tableNames: expect.arrayContaining([
                "_migrations",
                "database_tables",
                "database_table_pages",
            ]),
            pageForeignKeys: ["database_tables"],
        });
    });

    test("does not rerun recorded built-in SQLite migrations", () => {
        const storage = createStorage();

        runDatabaseDurableObjectSqlMigrations(storage);
        runDatabaseDurableObjectSqlMigrations(storage);

        expect([...storage.sql.exec("SELECT version FROM _migrations")]).toEqual([
            {version: 1},
            {version: 2},
            {version: 3},
        ]);
    });

    test("converts stored table kinds to PascalCase", () => {
        const storage = createStorage();
        storage.sql.exec("CREATE TABLE _migrations (version INTEGER PRIMARY KEY)");
        databaseDurableObjectSqlMigrations[0]!(storage.sql);
        storage.sql.exec("INSERT INTO _migrations (version) VALUES (1)");
        databaseDurableObjectSqlMigrations[1]!(storage.sql);
        storage.sql.exec("INSERT INTO _migrations (version) VALUES (2)");
        storage.sql.exec(`
            INSERT INTO database_tables (
                sqlite_id,
                table_id,
                kind,
                table_name,
                schema_version,
                access_policy
            ) VALUES (1, 'table-id', 'table', 'tasks', 1, '{}')
        `);
        storage.sql.exec(`
            INSERT INTO database_table_pages (sqlite_id, page_index, version, data)
            VALUES (1, 0, 1, X'01')
        `);

        runDatabaseDurableObjectSqlMigrations(storage);

        expect([...storage.sql.exec("SELECT kind FROM database_tables")]).toEqual([
            {kind: "Table"},
        ]);
        expect([...storage.sql.exec("SELECT sqlite_id FROM database_table_pages")]).toEqual([
            {sqlite_id: 1},
        ]);
    });
});

// These pin the durable page-store contract (versioning, tombstones, per-table
// isolation) directly through the storage methods, bypassing SQL execution. They
// use fresh generated table ids — bootstrap writes real pages for the main
// registry file, so tests can't assume it starts empty.
describe("DatabaseServer — durable page storage", () => {
    async function createServer(): Promise<DatabaseServer> {
        const server = await DatabaseServer.create(createStorage());
        openServers.push(server);
        return server;
    }

    test("stores, updates, and removes table access policies", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const firstPolicy = {
            type: "Local" as const,
            accountGrantById: new Map(),
            defaultGrant: {level: "View" as const},
            urlGrant: null,
        };
        const secondPolicy = {...firstPolicy, defaultGrant: {level: "Edit" as const}};

        server.setDatabaseTableAccessPolicy(tableId, firstPolicy, {
            tableMetadataVersion: 1,
            sourcePolicyVersion: 0,
        });
        server.setDatabaseTableAccessPolicy(tableId, secondPolicy, {
            tableMetadataVersion: 2,
            sourcePolicyVersion: 0,
        });
        const storedPolicy = server.getDatabaseTableAccessPolicy(tableId);
        server.setDatabaseTableAccessPolicy(tableId, null, {
            tableMetadataVersion: 3,
            sourcePolicyVersion: 0,
        });

        expect({
            storedPolicy,
            removedPolicy: server.getDatabaseTableAccessPolicy(tableId),
        }).toEqual({storedPolicy: secondPolicy, removedPolicy: null});
    });

    test("rejects access-policy replicas with an older composite revision", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const newerPolicy = databaseTableAccessPolicyForCreator(testAccountId);
        const stalePolicy = {...newerPolicy, defaultGrant: {level: "View" as const}};

        server.setDatabaseTableAccessPolicy(tableId, newerPolicy, {
            tableMetadataVersion: 2,
            sourcePolicyVersion: 3,
        });
        const staleSourceApplied = server.setDatabaseTableAccessPolicy(tableId, stalePolicy, {
            tableMetadataVersion: 2,
            sourcePolicyVersion: 2,
        });
        const staleTableApplied = server.setDatabaseTableAccessPolicy(tableId, stalePolicy, {
            tableMetadataVersion: 1,
            sourcePolicyVersion: 100,
        });

        expect({
            staleSourceApplied,
            staleTableApplied,
            storedPolicy: server.getDatabaseTableAccessPolicy(tableId),
        }).toEqual({
            staleSourceApplied: false,
            staleTableApplied: false,
            storedPolicy: newerPolicy,
        });
    });

    test("write pages, read them back", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        const page = new Uint8Array(sqlitePageSize);
        page[0] = 0xab;
        page[sqlitePageSize - 1] = 0xcd;

        writePagesFor(server, tableId, new Map([[0, page]]));

        const {data: read, version} = server.readPage(tableId, 0)!;

        expect(read[0]).toBe(0xab);
        expect(read[sqlitePageSize - 1]).toBe(0xcd);
        expect(read.byteLength).toBe(sqlitePageSize);
        expect(version).toBeGreaterThan(0);
    });

    test("readPage returns null for unwritten index", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        expect(server.readPage(tableId, 99)).toBeNull();
    });

    test("getFileSize reflects written pages", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        expect(server.getFileSize(tableId)).toBe(0);

        writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        expect(server.getFileSize(tableId)).toBe(3 * sqlitePageSize);
    });

    test("truncate makes pages at or beyond the threshold disappear", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        truncateFor(server, tableId, 1 * sqlitePageSize);

        // Pages 1 and 2 are tombstoned internally; they surface as missing from readPage.
        // Page 0 survives.
        expect(server.readPage(tableId, 0)).not.toBeNull();
        expect(server.readPage(tableId, 1)).toBeNull();
        expect(server.readPage(tableId, 2)).toBeNull();

        expect(server.getFileSize(tableId)).toBe(1 * sqlitePageSize);
    });

    test("readPage returns null after truncate", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        writePagesFor(server, tableId, new Map([[0, new Uint8Array(sqlitePageSize)]]));
        truncateFor(server, tableId, 0);

        expect(server.readPage(tableId, 0)).toBeNull();
    });

    test("getFileSize is correct after truncate", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        expect(server.getFileSize(tableId)).toBe(3 * sqlitePageSize);
        truncateFor(server, tableId, 2 * sqlitePageSize);
        expect(server.getFileSize(tableId)).toBe(2 * sqlitePageSize);
    });

    test("writePages after truncate correctly extends file size", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        truncateFor(server, tableId, 1 * sqlitePageSize);
        expect(server.getFileSize(tableId)).toBe(1 * sqlitePageSize);

        // Write a page beyond the current file size.
        writePagesFor(server, tableId, new Map([[3, new Uint8Array(sqlitePageSize)]]));
        expect(server.getFileSize(tableId)).toBe(4 * sqlitePageSize);
    });

    test("writePages and truncate in the same call share a single version", async () => {
        // Pin the contract that one writePages call produces exactly one version,
        // regardless of whether it carries pages, truncates, or both.
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        writePagesFor(server, tableId, new Map([[0, new Uint8Array(sqlitePageSize)]]));

        const batchVersion = server.writePages(
            new Map([[tableId, new Map([[2, new Uint8Array(sqlitePageSize)]])]]),
            new Map([[tableId, 1 * sqlitePageSize]]),
        );

        // Page 2 (written) and any tombstones from the truncate of pages >= 1 share the
        // same version.
        expect(server.readPage(tableId, 2)!.version).toBe(batchVersion);
    });

    test("a rewrite wins over a truncate tombstone for the same page", async () => {
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        const tableId = generateChronologicalId<DatabaseTableId>();
        const initial = new Uint8Array(sqlitePageSize);
        initial[0] = 0x11;
        writePagesFor(server, tableId, new Map([[2, initial]]));

        const replacement = new Uint8Array(sqlitePageSize);
        replacement[0] = 0x22;
        const version = server.writePages(
            new Map([[tableId, new Map([[2, replacement]])]]),
            new Map([[tableId, 1 * sqlitePageSize]]),
        );
        const sqliteId = storage.sql
            .exec("SELECT sqlite_id FROM database_tables WHERE table_id = ?", tableId)
            .next().value.sqlite_id;
        const rowCount = storage.sql
            .exec(
                "SELECT COUNT(*) AS count FROM database_table_pages WHERE sqlite_id = ? AND page_index = 2",
                sqliteId,
            )
            .next().value.count;

        expect({data: server.readPage(tableId, 2)!.data[0], rowCount, version}).toEqual({
            data: 0x22,
            rowCount: 1,
            version: server.readPage(tableId, 2)!.version,
        });
    });

    test("writePages returns the version it stamped onto the rows", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        const returned = writePagesFor(
            server,
            tableId,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );

        const {version} = server.readPage(tableId, 0)!;
        expect(returned).toBe(version);
    });

    test("consecutive writes have strictly increasing versions", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        const versions: Array<number> = [];
        for (let i = 0; i < 50; i++) {
            versions.push(
                writePagesFor(server, tableId, new Map([[i, new Uint8Array(sqlitePageSize)]])),
            );
        }

        for (let i = 1; i < versions.length; i++) {
            expect(versions[i]!).toBe(versions[i - 1]! + 1);
        }
    });

    test("truncate version is strictly greater than prior writePages version", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        const writeVersion = writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        const truncateVersion = truncateFor(server, tableId, 0);
        expect(truncateVersion).toBeGreaterThan(writeVersion);
    });

    test("readPage returns the latest version when a page is rewritten", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();

        const first = new Uint8Array(sqlitePageSize);
        first[0] = 0x11;
        const second = new Uint8Array(sqlitePageSize);
        second[0] = 0x22;

        writePagesFor(server, tableId, new Map([[0, first]]));
        writePagesFor(server, tableId, new Map([[0, second]]));

        const {data} = server.readPage(tableId, 0)!;
        expect(data[0]).toBe(0x22);
    });

    test("repeated page rewrites replace the stored image", async () => {
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        const tableId = generateChronologicalId<DatabaseTableId>();

        for (let i = 0; i < 50; i++) {
            writePagesFor(server, tableId, new Map([[0, new Uint8Array(sqlitePageSize)]]));
        }
        const rowCount = storage.sql
            .exec(
                `SELECT COUNT(*) AS count
                 FROM database_table_pages p
                 JOIN database_tables t ON t.sqlite_id = p.sqlite_id
                 WHERE t.table_id = ?`,
                tableId,
            )
            .next().value.count;

        expect(rowCount).toBe(1);
    });

    test("nextVersion recovers MAX(version) on cold load", async () => {
        // Seed the underlying storage via one server, then create a fresh server over the
        // same storage (simulating a Durable Object restart). The next write must produce
        // a version strictly greater than the previously-persisted one.
        const storage = createStorage();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const first = await DatabaseServer.create(storage);
        openServers.push(first);
        const seedVersion = writePagesFor(
            first,
            tableId,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );

        const reloaded = await DatabaseServer.create(storage);
        openServers.push(reloaded);
        const nextVersion = writePagesFor(
            reloaded,
            tableId,
            new Map([[1, new Uint8Array(sqlitePageSize)]]),
        );

        expect(nextVersion).toBeGreaterThan(seedVersion);
    });

    test("getFileSize recovers per-table metadata on cold load", async () => {
        const storage = createStorage();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const first = await DatabaseServer.create(storage);
        openServers.push(first);
        writePagesFor(first, tableId, new Map([[2, new Uint8Array(sqlitePageSize)]]));

        const reloaded = await DatabaseServer.create(storage);
        openServers.push(reloaded);

        expect(reloaded.getFileSize(tableId)).toBe(3 * sqlitePageSize);
    });

    test("changedPagesSince reports latest writes and tombstones", async () => {
        const server = await createServer();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const initialVersion = writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );

        server.writePages(
            new Map([[tableId, new Map([[0, new Uint8Array(sqlitePageSize)]])]]),
            new Map([[tableId, sqlitePageSize]]),
        );

        expect(server.changedPagesSince(tableId, initialVersion)).toEqual({
            changedPageIndexes: new Set([0]),
            tombstonedPageIndexes: new Set([1]),
        });
    });

    test("changedPagesSince skips the page query at a current watermark", async () => {
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        const tableId = generateChronologicalId<DatabaseTableId>();
        const version = writePagesFor(
            server,
            tableId,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );
        const exec = jest.spyOn(storage.sql, "exec");

        const result = server.changedPagesSince(tableId, version);
        const queriedPages = exec.mock.calls.some(call =>
            String(call[0]).includes("database_table_pages"),
        );

        expect({result, queriedPages}).toEqual({
            result: {changedPageIndexes: new Set(), tombstonedPageIndexes: new Set()},
            queriedPages: false,
        });
    });

    test("getFileSize ignores tombstones in the interior of the file", async () => {
        const storage = createStorage();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);

        // Write three pages, then tombstone the middle page by writing a tombstone row
        // directly so we can probe the size query without going through truncate (which
        // would tombstone the trailing pages too).
        writePagesFor(
            server,
            tableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        // Force a fresh `getFileSize` query (don't trust the fileSizes cache) by creating
        // a new server over the same backing storage. Then write a tombstone for page 1
        // directly.
        const reloaded = await DatabaseServer.create(storage);
        openServers.push(reloaded);
        const sqliteIdRow = storage.sql
            .exec("SELECT sqlite_id FROM database_tables WHERE table_id = ?", tableId)
            .next();
        expect(sqliteIdRow.done).toBe(false);
        const sqliteId = sqliteIdRow.value.sqlite_id;
        storage.sql.exec(
            "UPDATE database_table_pages SET version = ?, data = NULL WHERE sqlite_id = ? AND page_index = ?",
            999_999,
            sqliteId,
            1,
        );

        // Page 2 is still the highest live page — file size should still reflect three
        // pages, not one.
        expect(reloaded.getFileSize(tableId)).toBe(3 * sqlitePageSize);
    });

    test("pages from different tables are isolated", async () => {
        const server = await createServer();
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        const pageA = new Uint8Array(sqlitePageSize);
        pageA[0] = 0xa1;
        const pageB = new Uint8Array(sqlitePageSize);
        pageB[0] = 0xb2;

        writePagesFor(server, tableA, new Map([[0, pageA]]));
        writePagesFor(server, tableB, new Map([[0, pageB]]));

        expect(server.readPage(tableA, 0)!.data[0]).toBe(0xa1);
        expect(server.readPage(tableB, 0)!.data[0]).toBe(0xb2);
    });

    test("file size is tracked per table", async () => {
        const server = await createServer();
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        writePagesFor(
            server,
            tableA,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        writePagesFor(server, tableB, new Map([[0, new Uint8Array(sqlitePageSize)]]));

        expect(server.getFileSize(tableA)).toBe(2 * sqlitePageSize);
        expect(server.getFileSize(tableB)).toBe(1 * sqlitePageSize);
    });

    test("versions are global across tables", async () => {
        const server = await createServer();
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        const a1 = writePagesFor(server, tableA, new Map([[0, new Uint8Array(sqlitePageSize)]]));
        const a2 = writePagesFor(server, tableA, new Map([[1, new Uint8Array(sqlitePageSize)]]));
        const b1 = writePagesFor(server, tableB, new Map([[0, new Uint8Array(sqlitePageSize)]]));

        // Strictly monotonic across the entire database, not partitioned per table.
        expect(a2).toBe(a1 + 1);
        expect(b1).toBe(a2 + 1);
    });

    test("multi-table writePages stamps every page with the same version", async () => {
        const server = await createServer();
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        const version = server.writePages(
            new Map([
                [tableA, new Map([[0, new Uint8Array(sqlitePageSize)]])],
                [tableB, new Map([[0, new Uint8Array(sqlitePageSize)]])],
            ]),
            noTruncates,
        );

        expect(server.readPage(tableA, 0)!.version).toBe(version);
        expect(server.readPage(tableB, 0)!.version).toBe(version);
    });

    test("readPage on unknown table returns null without registering an id", async () => {
        const storage = createStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        const unknown = generateChronologicalId<DatabaseTableId>();

        expect(server.readPage(unknown, 0)).toBeNull();

        const cursor = storage.sql.exec(
            "SELECT COUNT(*) AS c FROM database_tables WHERE table_id = ?",
            unknown,
        );
        expect(cursor.next().value.c).toBe(0);
    });
});
