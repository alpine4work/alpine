import {jest} from "@jest/globals";
import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {TypedFastBitSet} from "typedfastbitset";
import {DatabaseDurableObjectConnection} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {truncateFor} from "~/server/databases/test_helpers/truncate_for.js";
import {writePagesFor} from "~/server/databases/test_helpers/write_pages_for.js";
import type {AccessLevel} from "~/shared/access/access_policy.js";
import type {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {
    databaseMainTableId,
    registrationCatchUpInlinePageLimit,
    sqlitePageSize,
} from "~/shared/databases/sqlite_constants.js";
import type {RynamoEvent, RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.open_source.js";

let server: DatabaseServer;
// A per-test table id standing in for one per-db file. Bootstrap writes real pages
// for the main registry file, so page-mechanics tests write to a fresh id instead
// of `databaseMainTableId` — its page set is theirs alone.
let tableId: DatabaseTableId;

beforeEach(async () => {
    server = await DatabaseServer.create(new DurableObjectStorage(new MemoryStorage()) as any);
    tableId = generateChronologicalId<DatabaseTableId>();
    // These page-mechanics tests aren't about access, so grant every table. Access
    // filtering itself has dedicated tests (see `createUntrustedContext`).
    jest.spyOn(server, "getTableAccessLevelForAccount").mockReturnValue("Manage");
});

afterEach(() => {
    server.close();
});

// Websocket connections are always browser sessions, so the procedures always
// enforce per-table access. The full-access spy in `beforeEach` grants every table
// without enumerating the dynamically-generated table ids these tests use.
const sessionTestContext = {
    actor: {
        serviceName: "EdgeService",
        getPossiblyBotAccountIdIfExists: () => null,
    },
} as any;

function createConnection({
    sendEventToAllAndWaitForOne = async () => {},
    sendEventToSelf = async () => {},
}: {
    sendEventToAllAndWaitForOne?: DatabaseDurableObjectConnectionConstructorOptions["sendEventToAllAndWaitForOne"];
    sendEventToSelf?: DatabaseDurableObjectConnectionConstructorOptions["sendEventToSelf"];
} = {}) {
    return new DatabaseDurableObjectConnection({
        server,
        sendEventToAllAndWaitForOne,
        sendEventToSelf,
        databaseGroupId: generateId<DatabaseGroupId>(),
    });
}

type DatabaseDurableObjectConnectionConstructorOptions = ConstructorParameters<
    typeof DatabaseDurableObjectConnection
>[0];

function makePage(marker: number): Uint8Array {
    const data = new Uint8Array(sqlitePageSize);
    data[0] = marker;
    return data;
}

function makeTablePageDiffs(pageIndexes: ReadonlyArray<number>, version = 1) {
    return {
        version,
        diffs: new Map(
            pageIndexes.map(pageIndex => [
                pageIndex,
                {previousVersion: 1, version, diff: [] as const},
            ]),
        ),
        fileSizeInPages: Math.max(0, ...pageIndexes) + 1,
    };
}

async function registerHeldPages(
    conn: DatabaseDurableObjectConnection,
    heldPagesByTable: ReadonlyMap<DatabaseTableId, Iterable<number>>,
    watermark = server.getSnapshotVersion(),
) {
    return conn.procedures.registerTables(
        sessionTestContext,
        {
            tables: new Map(
                [...heldPagesByTable].map(([registrationTableId, heldPages]) => [
                    registrationTableId,
                    {watermark, heldPages: new TypedFastBitSet(heldPages)},
                ]),
            ),
        },
        null as any,
    );
}

describe("executeAction", () => {
    test("waits for a changed-pages confirmation before returning", async () => {
        const confirmation = createPromiseResolver();
        const conn = createConnection({
            sendEventToAllAndWaitForOne: async () => await confirmation.promise,
        });
        const after = makePage(0xaa);
        jest.spyOn(server, "executeAction").mockReturnValue({
            result: {rows: []},
            readPages: new Map([[databaseMainTableId, new Map([[0, {data: after, version: 2}]])]]),
            changedPages: new Map([
                [
                    databaseMainTableId,
                    {
                        pages: new Map([
                            [
                                0,
                                {
                                    before: new Uint8Array(sqlitePageSize),
                                    after,
                                    beforeVersion: 1,
                                },
                            ],
                        ]),
                        fileSizeInPages: 1,
                    },
                ],
            ]),
            snapshotVersion: 2,
        } as any);

        let responseReturned = false;
        const response = conn.procedures
            .executeAction(
                sessionTestContext,
                {
                    action: {name: "rawSql", input: {sql: "SELECT 1"}},
                    mutationId: generateId(),
                    returnResult: false,
                    returnPages: false,
                    registerTables: new Map(),
                },
                null as any,
            )
            .then(() => {
                responseReturned = true;
            });

        await Promise.resolve();
        expect(responseReturned).toBe(false);

        confirmation.resolve();
        await response;
        expect(responseReturned).toBe(true);
    });

    test("waits for an empty self-confirmation before returning", async () => {
        const confirmation = createPromiseResolver();
        const conn = createConnection({
            sendEventToSelf: async () => await confirmation.promise,
        });

        let responseReturned = false;
        const response = conn.procedures
            .executeAction(
                sessionTestContext,
                {
                    action: {name: "rawSql", input: {sql: "SELECT 1"}},
                    mutationId: generateId(),
                    returnResult: false,
                    returnPages: false,
                    registerTables: new Map(),
                },
                null as any,
            )
            .then(() => {
                responseReturned = true;
            });

        await Promise.resolve();
        expect(responseReturned).toBe(false);

        confirmation.resolve();
        await response;
        expect(responseReturned).toBe(true);
    });

    test("read-only pages carry the current snapshot version", async () => {
        const storedVersion = server.readPage(databaseMainTableId, 0)!.version;

        const result = await createConnection().procedures.executeAction(
            sessionTestContext,
            {
                action: {name: "listTableIds", input: {}},
                mutationId: generateId(),
                returnResult: true,
                returnPages: true,
                registerTables: new Map(),
            },
            null as any,
        );

        expect({
            snapshotVersion: result.readPagesSnapshotVersion.get(databaseMainTableId),
            pageVersion: result.readPages?.get(databaseMainTableId)?.get(0)?.version,
        }).toEqual({snapshotVersion: storedVersion, pageVersion: storedVersion});
    });

    test("deduplicates only pages named by the request bitset at or below its watermark", async () => {
        const conn = createConnection();
        const currentVersion = server.getSnapshotVersion();
        const readPageIndexes = [
            ...(
                await conn.procedures.executeAction(
                    sessionTestContext,
                    {
                        action: {name: "listTableIds", input: {}},
                        mutationId: generateId(),
                        returnResult: true,
                        returnPages: true,
                        registerTables: new Map(),
                    },
                    null as any,
                )
            )
                .readPages!.get(databaseMainTableId)!
                .keys(),
        ];

        const result = await conn.procedures.executeAction(
            sessionTestContext,
            {
                action: {name: "listTableIds", input: {}},
                mutationId: generateId(),
                returnResult: true,
                returnPages: true,
                registerTables: new Map([
                    [
                        databaseMainTableId,
                        {
                            watermark: currentVersion,
                            heldPages: new TypedFastBitSet(readPageIndexes),
                        },
                    ],
                ]),
            },
            null as any,
        );

        expect(result.readPages?.has(databaseMainTableId)).toBe(false);
    });

    test("sends an evicted page even when the connection superset previously contained it", async () => {
        const conn = createConnection();
        await conn.procedures.executeAction(
            sessionTestContext,
            {
                action: {name: "listTableIds", input: {}},
                mutationId: generateId(),
                returnResult: true,
                returnPages: true,
                registerTables: new Map(),
            },
            null as any,
        );

        const result = await conn.procedures.executeAction(
            sessionTestContext,
            {
                action: {name: "listTableIds", input: {}},
                mutationId: generateId(),
                returnResult: true,
                returnPages: true,
                registerTables: new Map([
                    [
                        databaseMainTableId,
                        {
                            watermark: server.getSnapshotVersion(),
                            heldPages: new TypedFastBitSet(),
                        },
                    ],
                ]),
            },
            null as any,
        );

        expect(result.readPages?.get(databaseMainTableId)?.has(0)).toBe(true);
    });

    test("sends a held page whose version is newer than the request watermark", async () => {
        const pageVersion = server.readPage(databaseMainTableId, 0)!.version;

        const result = await createConnection().procedures.executeAction(
            sessionTestContext,
            {
                action: {name: "listTableIds", input: {}},
                mutationId: generateId(),
                returnResult: true,
                returnPages: true,
                registerTables: new Map([
                    [
                        databaseMainTableId,
                        {
                            watermark: pageVersion - 1,
                            heldPages: new TypedFastBitSet([0]),
                        },
                    ],
                ]),
            },
            null as any,
        );

        expect(result.readPages?.get(databaseMainTableId)?.has(0)).toBe(true);
    });
});

describe("registerTables", () => {
    test("returns current and advances the table watermark", async () => {
        writePagesFor(server, tableId, new Map([[0, makePage(0xaa)]]));
        const watermark = server.getSnapshotVersion();

        const result = await registerHeldPages(
            createConnection(),
            new Map([[tableId, [0]]]),
            watermark,
        );

        expect(result.tables.get(tableId)).toMatchObject({
            watermark,
            fileSizeInPages: 1,
            catchUp: {type: "Current"},
        });
    });

    test("returns empty catch-up for a quiet table with a lagging watermark", async () => {
        writePagesFor(server, tableId, new Map([[0, makePage(0xaa)]]));
        const quietTableWatermark = server.getSnapshotVersion();
        const activeTableId = generateChronologicalId<DatabaseTableId>();
        writePagesFor(server, activeTableId, new Map([[0, makePage(0xbb)]]));
        const currentWatermark = server.getSnapshotVersion();

        const result = await registerHeldPages(
            createConnection(),
            new Map([[tableId, [0]]]),
            quietTableWatermark,
        );

        expect(result.tables.get(tableId)).toMatchObject({
            watermark: currentWatermark,
            catchUp: {type: "Current"},
        });
    });

    test("inlines changed held pages", async () => {
        writePagesFor(
            server,
            tableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const watermark = server.getSnapshotVersion();
        writePagesFor(server, tableId, new Map([[1, makePage(0xcc)]]));

        const result = await registerHeldPages(
            createConnection(),
            new Map([[tableId, [0, 1]]]),
            watermark,
        );
        const table = result.tables.get(tableId)!;
        assert(table.catchUp.type === "Pages");

        expect({
            indexes: [...table.catchUp.pages.keys()],
            marker: table.catchUp.pages.get(1)?.data[0],
        }).toEqual({indexes: [1], marker: 0xcc});
    });

    test("inlines at the limit and returns stale above it", async () => {
        const atLimit = new TypedFastBitSet();
        atLimit.addRange(0, registrationCatchUpInlinePageLimit);
        const overLimit = new TypedFastBitSet();
        overLimit.addRange(0, registrationCatchUpInlinePageLimit + 1);
        jest.spyOn(server, "changedPagesSince")
            .mockReturnValueOnce({
                changedPageIndexes: new Set(atLimit),
                tombstonedPageIndexes: new Set(),
            })
            .mockReturnValueOnce({
                changedPageIndexes: new Set(overLimit),
                tombstonedPageIndexes: new Set(),
            });
        jest.spyOn(server, "readPage").mockReturnValue({data: makePage(0xaa), version: 1});
        const conn = createConnection();

        const inline = await registerHeldPages(conn, new Map([[tableId, atLimit]]), 0);
        const stale = await registerHeldPages(conn, new Map([[tableId, overLimit]]), 0);
        const inlineCatchUp = inline.tables.get(tableId)!.catchUp;
        const staleCatchUp = stale.tables.get(tableId)!.catchUp;
        assert(inlineCatchUp.type === "Pages");
        assert(staleCatchUp.type === "Stale");

        expect({
            inlineType: inlineCatchUp.type,
            inlineCount: inlineCatchUp.pages.size,
            staleType: staleCatchUp.type,
            staleCount: staleCatchUp.pageIndexes.size(),
        }).toEqual({
            inlineType: "Pages",
            inlineCount: registrationCatchUpInlinePageLimit,
            staleType: "Stale",
            staleCount: registrationCatchUpInlinePageLimit + 1,
        });
    });

    test("folds tombstoned indexes into stale catch-up", async () => {
        writePagesFor(
            server,
            tableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const watermark = server.getSnapshotVersion();
        truncateFor(server, tableId, sqlitePageSize);

        const result = await registerHeldPages(
            createConnection(),
            new Map([[tableId, [0, 1]]]),
            watermark,
        );
        const catchUp = result.tables.get(tableId)?.catchUp;

        expect(catchUp?.type === "Stale" ? catchUp.pageIndexes.array() : []).toEqual([1]);
    });

    test("withholds inaccessible tables", async () => {
        jest.spyOn(server, "getTableAccessLevelForAccount").mockReturnValue(null);

        const result = await registerHeldPages(createConnection(), new Map([[tableId, [0]]]));

        expect({tables: result.tables, tableAccess: result.tableAccess}).toEqual({
            tables: new Map(),
            tableAccess: new Map([[tableId, null]]),
        });
    });

    test("reports join-side access", async () => {
        const sourceTableId = generateChronologicalId<DatabaseTableId>();
        const targetTableId = generateChronologicalId<DatabaseTableId>();
        jest.spyOn(server, "getDatabaseTableAccessEntry").mockImplementation(lookupTableId =>
            lookupTableId === tableId
                ? {kind: "Join", sourceTableId, targetTableId}
                : {kind: "Table", accessPolicy: null},
        );
        jest.spyOn(server, "getTableAccessLevelForAccount").mockImplementation(lookupTableId => {
            if (lookupTableId === sourceTableId) return "View";
            if (lookupTableId === targetTableId) return null;
            return "Edit";
        });

        const result = await registerHeldPages(createConnection(), new Map([[tableId, []]]));

        expect(result.tableAccess).toEqual(
            new Map([
                [tableId, "Edit"],
                [sourceTableId, "View"],
                [targetTableId, null],
            ]),
        );
    });
});

describe("connection authorization and metadata", () => {
    test("transformEvent resolves table metadata events", async () => {
        const databaseGroupId = generateId<DatabaseGroupId>();
        const conn = new DatabaseDurableObjectConnection({
            server,
            sendEventToAllAndWaitForOne: async () => {},
            sendEventToSelf: async () => {},
            databaseGroupId,
        });
        const eventStub: RynamoEventStub = {
            type: "PutItem",
            item: {key: "table-key" as any, version: 1},
        };
        const resolvedEvent: RynamoEvent<DatabaseTableMetadataModel> = {
            type: "PutItem",
            item: {
                key: "table-key" as any,
                version: 1,
                model: {
                    databaseGroupId,
                    tableId: generateChronologicalId<DatabaseTableId>(),
                    spaceId: generateId(),
                    name: "Roadmap",
                    isDeleted: false,
                    accessPolicy: {type: "Local", accountGrants: new Map()},
                    version: 1,
                } as any,
            },
            indexes: new Map(),
        };
        const context = {
            ...sessionTestContext,
            rpc: {
                execute: async (_definition: any, _callId: unknown, input: unknown) => {
                    expect(input).toMatchObject({
                        databaseGroupId,
                        events: [eventStub],
                    });
                    return {events: [resolvedEvent]};
                },
            },
        };

        const event = await conn.transformEvent(context as any, {
            type: "TableMetadataChanged",
            events: [eventStub],
        });

        expect(event).toEqual({
            type: "TableMetadataChanged",
            events: [resolvedEvent],
            // Access delta for the touched table, resolved against the session's account.
            tableAccess: new Map([[resolvedEvent.item.model.tableId, "Manage"]]),
        });
    });

    test("authorize checks space access for the database group", async () => {
        const databaseGroupId = generateId<DatabaseGroupId>();
        const conn = new DatabaseDurableObjectConnection({
            server,
            sendEventToAllAndWaitForOne: async () => {},
            sendEventToSelf: async () => {},
            databaseGroupId,
        });
        const authorizedInputs: Array<unknown> = [];
        const context = {
            ...sessionTestContext,
            rpc: {
                execute: async (_definition: any, _callId: unknown, input: unknown) => {
                    authorizedInputs.push(input);
                    return {};
                },
            },
        };

        await conn.authorize(context as any);

        expect(authorizedInputs).toEqual([{databaseGroupId}]);
    });

    test("authorize propagates a space access denial", async () => {
        const conn = createConnection();
        const context = {
            ...sessionTestContext,
            rpc: {
                execute: async () => {
                    throw new PermissionDeniedError("Actor doesn\u2019t have access to the space");
                },
            },
        };

        await expect(conn.authorize(context as any)).rejects.toThrow(
            "Actor doesn\u2019t have access to the space",
        );
    });

    test("transformEvent rejects table metadata events without access", async () => {
        const eventStub: RynamoEventStub = {
            type: "PutItem",
            item: {key: "table-key" as any, version: 1},
        };
        const conn = createConnection();
        const context = {
            ...sessionTestContext,
            rpc: {
                execute: async () => {
                    throw new PermissionDeniedError("Actor doesn\u2019t have View access level");
                },
            },
        };

        await expect(
            conn.transformEvent(context as any, {
                type: "TableMetadataChanged",
                events: [eventStub],
            }),
        ).rejects.toThrow("Actor doesn\u2019t have View access level");
    });
});

describe("per-table realtime filtering", () => {
    // An EdgeService-issued (browser) actor: untrusted, so per-table filtering
    // applies. The server's access-level lookup is re-spied per test.
    function createUntrustedContext() {
        return {
            actor: {
                serviceName: "EdgeService",
                getPossiblyBotAccountIdIfExists: () => null,
            },
        } as any;
    }

    function createFilteringConnection(
        levelByTableId: ReadonlyMap<DatabaseTableId, AccessLevel | null>,
    ) {
        // Replace the full-access spy from `beforeEach` with the test's access matrix.
        jest.spyOn(server, "getTableAccessLevelForAccount").mockImplementation(
            (lookupTableId: DatabaseTableId) => levelByTableId.get(lookupTableId) ?? null,
        );
        return new DatabaseDurableObjectConnection({
            server,
            sendEventToAllAndWaitForOne: async () => {},
            sendEventToSelf: async () => {},
            databaseGroupId: generateId<DatabaseGroupId>(),
        });
    }

    test("PagesChanged drops readable but unsubscribed tables", async () => {
        const readableTableId = generateChronologicalId<DatabaseTableId>();
        const conn = createFilteringConnection(new Map([[readableTableId, "View"]]));

        const event = await conn.transformEvent(createUntrustedContext(), {
            type: "PagesChanged",
            pageDiffs: new Map([[readableTableId, makeTablePageDiffs([0])]]),
            mutationId: generateId<DatabaseMutationId>(),
        });

        assert(event.type === "PagesChanged");
        expect(event.pageDiffs).toEqual(new Map());
    });

    test("an action subscribes every table in its read set", async () => {
        const conn = createConnection();
        await conn.procedures.executeAction(
            sessionTestContext,
            {
                action: {name: "listTableIds", input: {}},
                mutationId: generateId(),
                returnResult: true,
                returnPages: true,
                registerTables: new Map(),
            },
            null as any,
        );

        const event = await conn.transformEvent(sessionTestContext, {
            type: "PagesChanged",
            pageDiffs: new Map([[databaseMainTableId, makeTablePageDiffs([0])]]),
            mutationId: generateId<DatabaseMutationId>(),
        });

        assert(event.type === "PagesChanged");
        expect(event.pageDiffs.has(databaseMainTableId)).toBe(true);
    });

    test("PagesChanged emits a snapshot stub when all table diffs are outside the bitset", async () => {
        const readableTableId = generateChronologicalId<DatabaseTableId>();
        const conn = createFilteringConnection(new Map([[readableTableId, "View"]]));
        await registerHeldPages(conn, new Map([[readableTableId, [0]]]));

        const event = await conn.transformEvent(createUntrustedContext(), {
            type: "PagesChanged",
            pageDiffs: new Map([[readableTableId, makeTablePageDiffs([1], 7)]]),
            mutationId: generateId<DatabaseMutationId>(),
        });

        assert(event.type === "PagesChanged");
        expect(event.pageDiffs.get(readableTableId)).toEqual({
            version: 7,
            diffs: new Map(),
            fileSizeInPages: 2,
        });
    });

    test("PagesChanged materializes a new page and adds it to the subscription", async () => {
        const readableTableId = generateChronologicalId<DatabaseTableId>();
        const conn = createFilteringConnection(new Map([[readableTableId, "View"]]));
        await registerHeldPages(conn, new Map([[readableTableId, [0]]]));

        const newPageEvent = await conn.transformEvent(createUntrustedContext(), {
            type: "PagesChanged",
            pageDiffs: new Map([
                [
                    readableTableId,
                    {
                        version: 7,
                        diffs: new Map([[1, {previousVersion: 0, version: 7, diff: [] as const}]]),
                        fileSizeInPages: 2,
                    },
                ],
            ]),
            mutationId: generateId<DatabaseMutationId>(),
        });
        const laterEvent = await conn.transformEvent(createUntrustedContext(), {
            type: "PagesChanged",
            pageDiffs: new Map([[readableTableId, makeTablePageDiffs([1], 8)]]),
            mutationId: generateId<DatabaseMutationId>(),
        });
        assert(newPageEvent.type === "PagesChanged");
        assert(laterEvent.type === "PagesChanged");

        expect({
            newPageIndexes: [...(newPageEvent.pageDiffs.get(readableTableId)?.diffs.keys() ?? [])],
            laterIndexes: [...(laterEvent.pageDiffs.get(readableTableId)?.diffs.keys() ?? [])],
        }).toEqual({newPageIndexes: [1], laterIndexes: [1]});
    });

    test("originator receives its full write set and adds it to the subscription", async () => {
        const eventStubs: Array<
            Parameters<
                DatabaseDurableObjectConnectionConstructorOptions["sendEventToAllAndWaitForOne"]
            >[0]
        > = [];
        const conn = createConnection({
            sendEventToAllAndWaitForOne: async event => {
                eventStubs.push(event);
            },
        });
        const mutationId = generateId<DatabaseMutationId>();
        await registerHeldPages(conn, new Map([[databaseMainTableId, []]]));
        const after = makePage(0xaa);
        jest.spyOn(server, "executeAction").mockReturnValue({
            result: {rows: []},
            readPages: new Map([[databaseMainTableId, new Map([[0, {data: after, version: 2}]])]]),
            changedPages: new Map([
                [
                    databaseMainTableId,
                    {
                        pages: new Map([
                            [
                                0,
                                {
                                    before: new Uint8Array(sqlitePageSize),
                                    after,
                                    beforeVersion: 1,
                                },
                            ],
                        ]),
                        fileSizeInPages: 1,
                    },
                ],
            ]),
            snapshotVersion: 2,
        } as any);

        await conn.procedures.executeAction(
            sessionTestContext,
            {
                action: {
                    name: "rawSql",
                    input: {sql: "SELECT 1"},
                },
                mutationId,
                returnResult: false,
                returnPages: false,
                registerTables: new Map(),
            },
            null as any,
        );
        const eventStub = eventStubs[0];
        assert(eventStub !== undefined && eventStub.type === "PagesChanged");

        const originEvent = await conn.transformEvent(sessionTestContext, eventStub);
        assert(originEvent.type === "PagesChanged");
        const writtenPageIndexes = [
            ...(originEvent.pageDiffs.get(databaseMainTableId)?.diffs.keys() ?? []),
        ];
        const externalEvent = await conn.transformEvent(sessionTestContext, {
            type: "PagesChanged",
            pageDiffs: new Map([
                [databaseMainTableId, makeTablePageDiffs(writtenPageIndexes, 999)],
            ]),
            mutationId: generateId<DatabaseMutationId>(),
        });
        assert(externalEvent.type === "PagesChanged");

        expect({
            originIndexes: writtenPageIndexes,
            laterIndexes: [
                ...(externalEvent.pageDiffs.get(databaseMainTableId)?.diffs.keys() ?? []),
            ],
        }).toEqual({originIndexes: writtenPageIndexes, laterIndexes: writtenPageIndexes});
    });

    test("access revocation removes the subscription even if access is later restored", async () => {
        const readableTableId = generateChronologicalId<DatabaseTableId>();
        const levelByTableId = new Map<DatabaseTableId, AccessLevel | null>([
            [readableTableId, "View"],
        ]);
        const conn = createFilteringConnection(levelByTableId);
        await registerHeldPages(conn, new Map([[readableTableId, [0]]]));
        const context = {
            ...createUntrustedContext(),
            rpc: {
                execute: async () => ({events: [], deniedTableIds: [readableTableId]}),
            },
        };

        await conn.transformEvent(context, {
            type: "TableMetadataChanged",
            events: [{type: "PutItem", item: {key: "table-key" as any, version: 1}}],
        });
        levelByTableId.set(readableTableId, "View");
        const event = await conn.transformEvent(context, {
            type: "PagesChanged",
            pageDiffs: new Map([[readableTableId, makeTablePageDiffs([0])]]),
            mutationId: generateId<DatabaseMutationId>(),
        });

        assert(event.type === "PagesChanged");
        expect(event.pageDiffs).toEqual(new Map());
    });

    test("PagesChanged withholds diffs for tables without read access", async () => {
        const readableTableId = generateChronologicalId<DatabaseTableId>();
        const hiddenTableId = generateChronologicalId<DatabaseTableId>();
        const conn = createFilteringConnection(new Map([[readableTableId, "View"]]));
        const mutationId = generateId<DatabaseMutationId>();
        await registerHeldPages(
            conn,
            new Map([
                [databaseMainTableId, [0]],
                [readableTableId, [0]],
            ]),
        );

        const event = await conn.transformEvent(createUntrustedContext(), {
            type: "PagesChanged",
            pageDiffs: new Map([
                [databaseMainTableId, makeTablePageDiffs([0])],
                [readableTableId, makeTablePageDiffs([0])],
                [hiddenTableId, makeTablePageDiffs([0])],
            ]),
            mutationId,
        });

        assert(event.type === "PagesChanged");
        expect({tableIds: [...event.pageDiffs.keys()], mutationId: event.mutationId}).toEqual({
            tableIds: [databaseMainTableId, readableTableId],
            mutationId,
        });
    });

    test("TableMetadataChanged carries the access delta", async () => {
        const visibleTableId = generateChronologicalId<DatabaseTableId>();
        const deniedTableId = generateChronologicalId<DatabaseTableId>();
        const conn = createFilteringConnection(new Map([[visibleTableId, "Edit"]]));
        const visibleEvent = {
            type: "PutItem",
            item: {key: "table-key" as any, version: 1, model: {tableId: visibleTableId}},
            indexes: new Map(),
        };
        const context = {
            ...createUntrustedContext(),
            rpc: {
                execute: async () => ({events: [visibleEvent], deniedTableIds: [deniedTableId]}),
            },
        };

        const event = await conn.transformEvent(context, {
            type: "TableMetadataChanged",
            events: [{type: "PutItem", item: {key: "table-key" as any, version: 1}}],
        });

        assert(event.type === "TableMetadataChanged");
        expect({events: event.events, tableAccess: event.tableAccess}).toEqual({
            events: [visibleEvent],
            tableAccess: new Map([
                [visibleTableId, "Edit"],
                [deniedTableId, null],
            ]),
        });
    });

    test("TableMetadataChanged recomputes subscribed joins touching a changed table", async () => {
        const changedTableId = generateChronologicalId<DatabaseTableId>();
        const otherTableId = generateChronologicalId<DatabaseTableId>();
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        const unrelatedJoinTableId = generateChronologicalId<DatabaseTableId>();
        const unrelatedSourceTableId = generateChronologicalId<DatabaseTableId>();
        const unrelatedTargetTableId = generateChronologicalId<DatabaseTableId>();
        const accessLevelByTableId = new Map<DatabaseTableId, AccessLevel | null>([
            [changedTableId, "View"],
            [otherTableId, null],
            [joinTableId, "View"],
            [unrelatedJoinTableId, "View"],
        ]);
        const conn = createFilteringConnection(accessLevelByTableId);
        jest.spyOn(server, "getDatabaseTableAccessEntry").mockImplementation(lookupTableId => {
            if (lookupTableId === joinTableId) {
                return {
                    kind: "Join",
                    sourceTableId: changedTableId,
                    targetTableId: otherTableId,
                };
            }
            if (lookupTableId === unrelatedJoinTableId) {
                return {
                    kind: "Join",
                    sourceTableId: unrelatedSourceTableId,
                    targetTableId: unrelatedTargetTableId,
                };
            }
            return {kind: "Table", accessPolicy: null};
        });
        await registerHeldPages(
            conn,
            new Map([
                [joinTableId, []],
                [unrelatedJoinTableId, []],
            ]),
        );
        accessLevelByTableId.set(changedTableId, null);
        accessLevelByTableId.set(joinTableId, null);
        const context = {
            ...createUntrustedContext(),
            rpc: {
                execute: async () => ({events: [], deniedTableIds: [changedTableId]}),
            },
        };

        const event = await conn.transformEvent(context, {
            type: "TableMetadataChanged",
            events: [{type: "PutItem", item: {key: "table-key" as any, version: 1}}],
        });

        assert(event.type === "TableMetadataChanged");
        expect(event.tableAccess).toEqual(
            new Map([
                [changedTableId, null],
                [joinTableId, null],
            ]),
        );
    });
});
