import {AccessLevelSchema} from "~/shared/access/access_policy.js";
import {
    type DatabaseActionInput,
    type DatabaseActionName,
    DatabaseActionObjectSchema,
    type DatabaseActionOutput,
    DatabaseActionResultSchema,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {BitsetSchema} from "~/shared/schema/bitset_schema.js";
import {
    type ObjectSchema,
    type ObjectSchemaConfigType,
    Schema,
    type SchemaType,
} from "~/shared/schema/schema.js";

/**
 * Shared schema definitions used by both the WebSocket realtime protocol
 * (`DatabaseRealtimeProtocol`) and the tab/worker RPC protocols
 * (`tabToWorkerDatabaseRpcMethods`, `workerToTabDatabaseRpcMethods`). Centralizing
 * them here keeps the wire format identical across transports and avoids drift.
 */

// -- Pages --------------------------------------------------------------------

/**
 * A set of SQLite page indices grouped by {@link DatabaseTableId}. Used in-memory
 * to track which pages an action read or wrote across one or more tables; not part
 * of any wire format.
 */
export type ReadonlyDatabasePageSet = ReadonlyMap<DatabaseTableId, ReadonlySet<number>>;

/**
 * The pages of a single database table, keyed by SQLite page index. Each value is
 * the page bytes plus the version at which the canonical server observed them.
 */
export const DatabaseTablePagesSchema = Schema.map(
    Schema.integer,
    Schema.object({
        version: Schema.integer,
        data: Schema.bytes,
    }),
);

export type DatabaseTablePages = SchemaType<typeof DatabaseTablePagesSchema>;

/**
 * Pages spanning one or more database tables. Each table is its own SQLite
 * database (attached together on the client), so the outer key is a {@link
 * DatabaseTableId} and the inner is {@link DatabaseTablePagesSchema}.
 */
export const DatabasePagesSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    DatabaseTablePagesSchema,
);

export type DatabasePages = SchemaType<typeof DatabasePagesSchema>;

// -- Page diffs ---------------------------------------------------------------

/**
 * The page diffs for a single database table.
 *
 * `diffs` is keyed by SQLite page index; each value is the diff bytes plus the
 * version at which the canonical server produced them. Mirrors {@link
 * DatabaseTablePagesSchema} for realtime updates.
 *
 * `previousVersion` is the version of the page the diff was computed against (0
 * for a page that didn't exist before). A client must only apply the diff to a
 * base at exactly that version — applying it to any other base fabricates a page
 * state that never existed on the server.
 *
 * `fileSizeInPages` is the canonical SQLite file size after applying these diffs —
 * sent alongside the diffs so the client can truncate / extend its OPFS store
 * atomically with the page writes.
 */
export const DatabaseTablePageDiffsSchema = Schema.object({
    version: Schema.integer,
    diffs: Schema.map(
        Schema.integer,
        Schema.object({
            previousVersion: Schema.integer,
            version: Schema.integer,
            diff: pageDiffSchema,
        }),
    ),
    fileSizeInPages: Schema.integer,
});

export type DatabaseTablePageDiffs = SchemaType<typeof DatabaseTablePageDiffsSchema>;

/**
 * Page diffs spanning one or more database tables. Mirrors {@link
 * DatabasePagesSchema} for realtime updates.
 */
export const DatabasePageDiffsSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    DatabaseTablePageDiffsSchema,
);

export type DatabasePageDiffs = SchemaType<typeof DatabasePageDiffsSchema>;

// -- Cache validation ---------------------------------------------------------

/**
 * Map a client sends to validate its page cache: per table, the page-index →
 * version pairs the client believes it has cached.
 */
export const DatabasePageVersionsByIndexSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    Schema.map(Schema.integer, Schema.integer),
);

export type DatabasePageVersionsByIndex = SchemaType<typeof DatabasePageVersionsByIndexSchema>;

// -- Table access levels --------------------------------------------------------

/**
 * The receiving account's access to each table file, derived server-side from the
 * durable object's policy copies. `null` means no access.
 *
 * The client can't compute this itself because policy copies remain server-side,
 * so the server pushes per-table entries in `ensureCacheIsUpToDate` responses
 * (covering the tables the client asked about) and per-table deltas on
 * `TableMetadataChanged` events. The client uses it to _plan_ (e.g. relation
 * fields render "No access" chips instead of joining into a file it can't read);
 * the authoritative enforcement is the server's per-statement authorizer.
 */
export const DatabaseTableAccessLevelsSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    AccessLevelSchema.nullable(),
);

// -- Table registration ------------------------------------------------------

/** The pages a client currently holds and the snapshot they reflect. */
export const DatabaseTableRegistrationSchema = Schema.object({
    watermark: Schema.integer,
    heldPages: BitsetSchema,
});

export type DatabaseTableRegistration = SchemaType<typeof DatabaseTableRegistrationSchema>;

/** Catch-up state returned while establishing a table subscription. */
export const DatabaseTableRegistrationResultSchema = Schema.object({
    watermark: Schema.integer,
    fileSizeInPages: Schema.integer,
    catchUp: Schema.unionWithKey("type", {
        current: Schema.object({type: Schema.value("current")}),
        pages: Schema.object({
            type: Schema.value("pages"),
            pages: DatabaseTablePagesSchema,
        }),
        stale: Schema.object({
            type: Schema.value("stale"),
            pageIndexes: BitsetSchema,
        }),
    }),
});

export type DatabaseTableRegistrationResult = SchemaType<
    typeof DatabaseTableRegistrationResultSchema
>;

export const DatabaseTableRegistrationsSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    DatabaseTableRegistrationSchema,
);

export type DatabaseTableRegistrations = SchemaType<typeof DatabaseTableRegistrationsSchema>;

export const DatabaseTableRegistrationResultsSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    DatabaseTableRegistrationResultSchema,
);

export type DatabaseTableRegistrationResults = SchemaType<
    typeof DatabaseTableRegistrationResultsSchema
>;

/** Shared response shape for explicit and action-piggybacked registration. */
export const DatabaseRegisterTablesResultConfig = {
    tables: DatabaseTableRegistrationResultsSchema,
    tableAccess: DatabaseTableAccessLevelsSchema,
};

export type DatabaseRegisterTablesResult = ObjectSchemaConfigType<
    typeof DatabaseRegisterTablesResultConfig
>;

/**
 * Result config for `ensureCacheIsUpToDate`.
 *
 * Keyed by {@link DatabaseTableId}: each table is its own SQLite database
 * (attached together on the client) and the cache is validated independently per
 * table.
 *
 * Within each per-table entry, empty states represent different modes:
 *
 * - Both empty — that table's cache is up to date.
 * - `updatedPages` non-empty — server inlined page data for a small number of
 *   stale pages.
 * - `stalePageIndexes` non-empty, `updatedPages` empty — too many stale pages;
 *   client deletes them and re-fetches on demand.
 */
export const DatabaseEnsureCacheIsUpToDateResultConfig = {
    tables: Schema.map(
        Schema.id<DatabaseTableId>(),
        Schema.object({
            updatedPages: DatabaseTablePagesSchema,
            stalePageIndexes: Schema.array(Schema.integer),
            fileSizeInPages: Schema.integer,
        }),
    ),
    /**
     * The access map for the tables the client asked about (the request's
     * `pageVersionsByIndex` keys), plus — for join files among them — the joined
     * sides, whose levels the client needs to render relations ("exists but no
     * access"). Withheld and unknown tables report `null`. Empty for trusted internal
     * connections, which are unrestricted.
     */
    tableAccess: DatabaseTableAccessLevelsSchema,
};

export type DatabaseEnsureCacheIsUpToDateResult = ObjectSchemaConfigType<
    typeof DatabaseEnsureCacheIsUpToDateResultConfig
>;

// -- Page acknowledgments -----------------------------------------------------

/**
 * Map a client sends to acknowledge that it received the named pages: per table,
 * the page indexes confirmed.
 */
export const DatabasePageIndexesSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    Schema.array(Schema.integer),
);

export type DatabasePageIndexes = SchemaType<typeof DatabasePageIndexesSchema>;

// -- Action invocation --------------------------------------------------------

/**
 * Input config for invoking a database action against the canonical server. Used
 * by both the WebSocket procedure and the worker-to-tab `executeActionServer` RPC.
 *
 * `returnResult` / `returnPages` let the caller skip fields it doesn't need — e.g.
 * fire-and-forget mutations.
 */
export const DatabaseExecuteActionInputConfig = {
    action: DatabaseActionObjectSchema,
    mutationId: Schema.id<DatabaseMutationId>(),
    returnResult: Schema.boolean.default(true),
    returnPages: Schema.boolean.default(true),
    registerTables: DatabaseTableRegistrationsSchema.default(emptyMap),
};

/**
 * Output config for {@link DatabaseExecuteActionInputConfig}: the action result
 * and any pages the server read while computing it. Both are nullable so the
 * server can honor the caller's `returnResult` / `returnPages` flags.
 *
 * `fileSizesInPages` carries the canonical SQLite file size for every table in
 * `readPages` (null exactly when `readPages` is null). The client needs it to
 * serve a correct file size from a sparse page cache — without it, SQLite sees a
 * file shorter than the header claims and reports corruption.
 */
export const DatabaseExecuteActionOutputConfig = {
    result: DatabaseActionResultSchema.nullable(),
    readPages: DatabasePagesSchema.nullable(),
    fileSizesInPages: Schema.map(Schema.id<DatabaseTableId>(), Schema.integer).nullable(),
    registeredTables: Schema.object(DatabaseRegisterTablesResultConfig),
    readPagesSnapshotVersion: Schema.map(Schema.id<DatabaseTableId>(), Schema.integer),
};

export type DatabaseExecuteActionResponse = ObjectSchemaConfigType<
    typeof DatabaseExecuteActionOutputConfig
>;

// -- Loader-passed action result ---------------------------------------------

/**
 * Per-action schemas for loader-serialized action results. Use a specific variant
 * (e.g. `LoaderDatabaseActionResultSchemas.getViewRowsPage`) when the action name
 * is known at compile time to get a narrower type without casting.
 */
export const LoaderDatabaseActionResultSchemas = Object.fromEntries(
    Object.entries(databaseActions).map(([name, def]) => [
        name,
        Schema.object({
            name: Schema.value(name),
            input: def.input,
            output: def.output,
        }),
    ]),
) as {
    [K in DatabaseActionName]: ObjectSchema<LoaderDatabaseActionResult<K>>;
};

/**
 * Schema for loader-serialized action results. Includes the action name, input,
 * and output used to seed client-side reactive action hooks.
 */
export const LoaderDatabaseActionResultSchema = Schema.unionWithKey(
    "name",
    LoaderDatabaseActionResultSchemas,
);

export type LoaderDatabaseActionResult<N extends DatabaseActionName = DatabaseActionName> = {
    [K in DatabaseActionName]: {
        name: K;
        input: DatabaseActionInput<K>;
        output: DatabaseActionOutput<K>;
    };
}[N];
