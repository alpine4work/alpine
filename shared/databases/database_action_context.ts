import type {AccessLevel} from "~/shared/access/access_policy.js";
import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import type {SqliteDatabase} from "~/shared/databases/sqlite.js";
import type {AccountId, DatabaseTableId} from "~/shared/id/types/id_types.js";

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
     * HMAC of `value` keyed by the database group's private salt (see
     * `hashWithPrivateSalt` in `shared/databases`). Server-only because the salt never
     * leaves the group's durable object. Maintains the registry's `table_name_hash`
     * uniqueness index without disclosing table names to group members who lack access
     * to the table.
     */
    hashWithPrivateSalt(value: string): string;
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
