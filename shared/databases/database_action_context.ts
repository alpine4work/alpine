import type {AccessLevel, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import type {DatabaseTableAccessPolicyRevision} from "~/shared/databases/database_table_access_policy_revision.js";
import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import type {SqliteDatabase} from "~/shared/databases/sqlite.js";
import type {AccountId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

/**
 * A table's registration in the server's durable-object table store — everything
 * the server must know about a per-table file without attaching it: its kind, its
 * plaintext SQLite `table_name` (backing the name-uniqueness probe), and its
 * access metadata (a policy for user tables, the joined table ids for join files,
 * whose access derives from their sides).
 */
export type DatabaseServerTableRegistration =
    | {kind: "Table"; tableName: string; accessPolicy: LocalAccessPolicy}
    | {
          kind: "Join";
          tableName: string;
          sourceTableId: DatabaseTableId;
          targetTableId: DatabaseTableId;
      };

/**
 * Server-side store of per-table metadata, backed by the durable object's own
 * storage — never replicated to clients, which is what lets it hold plaintext
 * table names and policy copies. Writes participate in the surrounding action's
 * storage transaction, so they roll back with the action.
 */
export interface DatabaseServerTableStore {
    /**
     * Record a newly created table. Create flows call this before attaching +
     * migrating the file, so the authorizer can resolve the new schema's access from
     * the moment any statement can touch it.
     */
    registerTable(tableId: DatabaseTableId, registration: DatabaseServerTableRegistration): void;
    /**
     * Record a rename's resolved SQLite `table_name`, keeping the uniqueness probe
     * current.
     */
    setTableName(tableId: DatabaseTableId, tableName: string): void;
    /** Overwrite a user table's resolved policy copy (see `syncTableMetadata`). */
    setTableAccessPolicy(
        tableId: DatabaseTableId,
        accessPolicy: LocalAccessPolicy,
        revision: DatabaseTableAccessPolicyRevision,
    ): boolean;
    /**
     * Whether any registered table's SQLite `table_name` equals `tableName`. Backs
     * `formatUniqueTableName`'s uniqueness probe; pass `excludeTableId` when renaming
     * so the table's own row doesn't count.
     */
    isTableNameTaken(tableName: string, excludeTableId?: DatabaseTableId): boolean;
}

/**
 * Server-only capabilities. Accessing these on the client causes the action to
 * fall back to the server.
 */
export interface DatabaseActionServerContext {
    /**
     * Attach a per-table database file (no-op if already attached) so the action can
     * create or write to it. Used by server-only schema actions like `createTable`.
     */
    attach(tableId: DatabaseTableId): void;
    getCurrentAccountId(): AccountId | null;
    /**
     * The durable object's table store. Server-only because the store holds plaintext
     * table names and policy copies that must never replicate to clients.
     */
    tables: DatabaseServerTableStore;
}

/**
 * Context handed to a database action's `run()`. Also available as `ctx` on {@link
 * DatabaseModel} (and every model child), so model code can reach server-only
 * capabilities without them being threaded through call chains.
 */
export interface DatabaseActionContext {
    /** The SQLite handle the action runs against. */
    db: SqliteDatabase;
    /**
     * Server-only capabilities. Calling this on the client will throw a
     * `DatabaseActionRequiresServerError`, causing the action to be executed on the
     * server instead.
     */
    server: () => DatabaseActionServerContext;
    /** The database schema */
    model: DatabaseModel;
    /**
     * The current execution's access level on `tableId` — the same value the SQLite
     * authorizer enforces per statement. Everything is granted when the execution runs
     * unrestricted (internal server code, service actors). Action code uses this to
     * _plan around_ denials the authorizer would otherwise hard- error on, e.g.
     * relation fields emitting an ids-only projection instead of joining into a linked
     * table the account can't read.
     */
    getTableAccessLevel: (tableId: DatabaseTableId) => AccessLevel | null;
}
