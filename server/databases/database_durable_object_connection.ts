import {TypedFastBitSet} from "typedfastbitset";
import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {buildDatabasePageDiffs} from "~/server/databases/build_database_page_diffs.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import type {AccessLevel} from "~/shared/access/access_policy.js";
import {databaseActions} from "~/shared/databases/database_actions.js";
import type {
    DatabasePageDiffs,
    DatabaseRegisterTablesResult,
    DatabaseTablePageDiffs,
    DatabaseTablePages,
    DatabaseTableRegistrationResult,
    DatabaseTableRegistrations,
} from "~/shared/databases/database_protocol_schemas.js";
import {
    DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {
    databaseMainTableId,
    registrationCatchUpInlinePageLimit,
    sqlitePageSize,
} from "~/shared/databases/sqlite_constants.js";
import type {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.js";
import {
    authorizeDatabaseGroupAccess,
    getDatabaseTableMetadataRealtimeEvent,
} from "~/shared/rpc/database_tables_rpc_definitions.js";

export type DatabaseRealtimeEventStub =
    | {
          type: "PagesChanged";
          pageDiffs: DatabasePageDiffs;
          mutationId: DatabaseMutationId;
      }
    | {
          type: "TableMetadataChanged";
          events: ReadonlyArray<RynamoEventStub>;
      };

export class DatabaseDurableObjectConnection {
    private readonly server: DatabaseServer;
    private readonly sendEventToAll: (event: DatabaseRealtimeEventStub) => void;
    private readonly sendEventToSelf: (event: DatabaseRealtimeEventStub) => void;
    private readonly databaseGroupId: DatabaseGroupId;
    private readonly subscriptions = new Map<DatabaseTableId, TypedFastBitSet>();
    private readonly originatedMutationIds = new Set<DatabaseMutationId>();

    constructor({
        server,
        sendEventToAll,
        sendEventToSelf,
        databaseGroupId,
    }: {
        server: DatabaseServer;
        sendEventToAll: (event: DatabaseRealtimeEventStub) => void;
        sendEventToSelf: (event: DatabaseRealtimeEventStub) => void;
        databaseGroupId: DatabaseGroupId;
    }) {
        this.server = server;
        this.sendEventToAll = sendEventToAll;
        this.sendEventToSelf = sendEventToSelf;
        this.databaseGroupId = databaseGroupId;
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol
    > = {
        executeAction: async (context, input) => {
            if (databaseActions[input.action.name].internalOnly) {
                throw new PermissionDeniedError(
                    `Database action ${input.action.name} is internal-only`,
                );
            }

            const result = this.server.executeAction(context, input.action);
            const registeredTables = this.registerTables(context, input.registerTables);

            let filteredReadPages: Map<DatabaseTableId, DatabaseTablePages> | null = null;
            if (input.returnPages) {
                filteredReadPages = new Map();
                for (const [tableId, tablePages] of result.readPages) {
                    const registration = input.registerTables.get(tableId);
                    const filteredTablePages = new Map<
                        number,
                        {version: number; data: Uint8Array}
                    >();
                    for (const [pageIndex, page] of tablePages) {
                        if (
                            registration !== undefined &&
                            registration.heldPages.has(pageIndex) &&
                            page.version <= registration.watermark
                        ) {
                            continue;
                        }
                        filteredTablePages.set(pageIndex, page);
                    }
                    if (filteredTablePages.size > 0) {
                        filteredReadPages.set(tableId, filteredTablePages);
                    }
                }
            }

            // Every table the action touched becomes a subscription. A registration request
            // replaced its held-page set above; pages actually returned are then added to that
            // set. Tables omitted from the registration payload are deliberately unfiltered.
            for (const [tableId] of result.readPages) {
                const heldPages = this.subscriptions.get(tableId) ?? new TypedFastBitSet();
                this.subscriptions.set(tableId, heldPages);
                for (const pageIndex of filteredReadPages?.get(tableId)?.keys() ?? []) {
                    heldPages.add(pageIndex);
                }
            }

            const pageDiffs = buildDatabasePageDiffs(
                result.changedPages,
                result.readPages,
                result.snapshotVersion,
            );
            if (pageDiffs.size > 0) {
                this.originatedMutationIds.add(input.mutationId);
                this.sendEventToAll({
                    type: "PagesChanged",
                    pageDiffs,
                    mutationId: input.mutationId,
                });
            } else if (!input.returnPages) {
                // `returnPages: false` marks the fire-and-forget send of an optimistic mutation,
                // which relies on a realtime event to confirm (and dequeue) it — and this event
                // must arrive before the procedure response. A mutation that ends up writing
                // nothing (e.g. deleting a row another client already deleted) broadcasts no
                // diffs, so confirm it to the originator explicitly with an empty event.
                // Foreground calls (`returnPages: true`) consume the response directly and need no
                // confirmation.
                this.sendEventToSelf({
                    type: "PagesChanged",
                    pageDiffs: new Map(),
                    mutationId: input.mutationId,
                });
            }

            // Report the canonical file size for every table whose pages we return, so the
            // client's sparse cache can serve the correct file size (SQLite treats a file
            // shorter than its header claims as corrupt).
            let fileSizesInPages: Map<DatabaseTableId, number> | null = null;
            const readPagesSnapshotVersion = new Map<DatabaseTableId, number>();
            if (filteredReadPages !== null) {
                fileSizesInPages = new Map();
                for (const tableId of filteredReadPages.keys()) {
                    fileSizesInPages.set(
                        tableId,
                        this.server.getFileSize(tableId) / sqlitePageSize,
                    );
                    readPagesSnapshotVersion.set(tableId, result.snapshotVersion);
                }
            }

            return {
                result: input.returnResult
                    ? ({name: input.action.name, output: result.result} as any)
                    : null,
                readPages: filteredReadPages,
                fileSizesInPages,
                registeredTables,
                readPagesSnapshotVersion,
            };
        },
        registerTables: async (context, input) => {
            return this.registerTables(context, input.tables);
        },
    };

    public async authorize(context: WorkerSessionActionContext): Promise<void> {
        // Space-level gate: every database group belongs to exactly one space, and all
        // per-table checks downstream (the authorizer's access lookup, realtime filtering)
        // evaluate local policy copies _assuming_ space access — this is the async check
        // that assumption rests on. The websocket wrapper re-runs it roughly every two
        // minutes, so a revoked space membership closes the socket within that bound (plus
        // the ~15s server-side membership cache) — the same staleness Alpine accepts for
        // documents and chat.
        await authorizeDatabaseGroupAccess(context, {databaseGroupId: this.databaseGroupId});
    }

    private registerTables(
        context: WorkerSessionActionContext,
        registrations: DatabaseTableRegistrations,
    ): DatabaseRegisterTablesResult {
        const accountId = context.actor.getPossiblyBotAccountIdIfExists();
        const tableAccess = new Map<DatabaseTableId, AccessLevel | null>();
        const tables = new Map<DatabaseTableId, DatabaseTableRegistrationResult>();
        const snapshotVersion = this.server.getSnapshotVersion();

        for (const [tableId, registration] of registrations) {
            const accessLevel =
                tableId === databaseMainTableId
                    ? "Manage"
                    : this.server.getTableAccessLevelForAccount(tableId, accountId);
            tableAccess.set(tableId, accessLevel);

            const entry = this.server.getDatabaseTableAccessEntry(tableId);
            if (entry !== null && entry.kind === "join") {
                for (const sideTableId of [entry.sourceTableId, entry.targetTableId]) {
                    tableAccess.set(
                        sideTableId,
                        this.server.getTableAccessLevelForAccount(sideTableId, accountId),
                    );
                }
            }

            if (accessLevel === null) {
                this.subscriptions.delete(tableId);
                continue;
            }

            const {changedPageIndexes, tombstonedPageIndexes} = this.server.changedPagesSince(
                tableId,
                registration.watermark,
            );
            const heldChangedPageIndexes = new TypedFastBitSet(changedPageIndexes).intersection(
                registration.heldPages,
            );
            const heldTombstonedPageIndexes = new TypedFastBitSet(
                tombstonedPageIndexes,
            ).intersection(registration.heldPages);
            heldChangedPageIndexes.union(heldTombstonedPageIndexes);

            let catchUp: DatabaseTableRegistrationResult["catchUp"];
            if (heldChangedPageIndexes.isEmpty()) {
                catchUp = {type: "current"};
            } else if (
                !heldTombstonedPageIndexes.isEmpty() ||
                heldChangedPageIndexes.size() > registrationCatchUpInlinePageLimit
            ) {
                // The wire union cannot carry inline pages and deletions together. When a
                // tombstone is present, invalidate the whole changed intersection so the client
                // refetches surviving pages on demand.
                catchUp = {type: "stale", pageIndexes: heldChangedPageIndexes};
            } else {
                const pages = new Map<number, {version: number; data: Uint8Array}>();
                for (const pageIndex of heldChangedPageIndexes) {
                    const page = this.server.readPage(tableId, pageIndex);
                    assert(page !== null, `changed page ${pageIndex} is missing from ${tableId}`);
                    pages.set(pageIndex, page);
                }
                catchUp = {type: "pages", pages};
            }

            this.subscriptions.set(tableId, registration.heldPages.clone());
            tables.set(tableId, {
                watermark: snapshotVersion,
                fileSizeInPages: this.server.getFileSize(tableId) / sqlitePageSize,
                catchUp,
            });
        }

        return {tables, tableAccess};
    }

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: DatabaseRealtimeEventStub,
    ): Promise<DatabaseRealtimeEvent> {
        switch (eventStub.type) {
            case "PagesChanged": {
                const originatedHere = this.originatedMutationIds.delete(eventStub.mutationId);
                const accountId = context.actor.getPossiblyBotAccountIdIfExists();
                const pageDiffs = new Map<DatabaseTableId, DatabaseTablePageDiffs>();
                for (const [tableId, diffs] of eventStub.pageDiffs) {
                    const hasAccess =
                        tableId === databaseMainTableId ||
                        this.server.getTableAccessLevelForAccount(tableId, accountId) !== null;
                    if (!hasAccess) {
                        this.subscriptions.delete(tableId);
                        continue;
                    }

                    const heldPages = this.subscriptions.get(tableId);
                    if (heldPages === undefined) {
                        continue;
                    }

                    const filteredDiffs = new Map<
                        number,
                        DatabaseTablePageDiffs["diffs"] extends ReadonlyMap<number, infer Diff>
                            ? Diff
                            : never
                    >();
                    for (const [pageIndex, diff] of diffs.diffs) {
                        const materializesNewPage = diff.previousVersion === 0;
                        if (originatedHere || materializesNewPage || heldPages.has(pageIndex)) {
                            filteredDiffs.set(pageIndex, diff);
                            if (originatedHere || materializesNewPage) {
                                heldPages.add(pageIndex);
                            }
                        }
                    }
                    pageDiffs.set(tableId, {...diffs, diffs: filteredDiffs});
                }
                return {type: "PagesChanged", pageDiffs, mutationId: eventStub.mutationId};
            }
            case "TableMetadataChanged": {
                const {events, deniedTableIds} = await getDatabaseTableMetadataRealtimeEvent(
                    context,
                    {
                        databaseGroupId: this.databaseGroupId,
                        events: eventStub.events,
                    },
                );
                // Access-map delta for every table the batch touched: visible events report the
                // account's current level from the local policy copies; denied ones report null
                // (the revocation signal).
                const tableAccess = new Map<DatabaseTableId, AccessLevel | null>();
                const accountId = context.actor.getPossiblyBotAccountIdIfExists();
                for (const event of events) {
                    if (event.type !== "PutItem") continue;
                    const tableId = event.item.model.tableId;
                    tableAccess.set(
                        tableId,
                        this.server.getTableAccessLevelForAccount(tableId, accountId),
                    );
                }
                for (const tableId of deniedTableIds ?? []) {
                    tableAccess.set(tableId, null);
                }
                for (const [tableId, accessLevel] of tableAccess) {
                    if (accessLevel === null) {
                        this.subscriptions.delete(tableId);
                    }
                }
                return {
                    type: "TableMetadataChanged",
                    events,
                    tableAccess,
                };
            }
            default:
                throw exhaustive(eventStub);
        }
    }
}
