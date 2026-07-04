import type {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";
import {replicateDatabaseTableChanges} from "~/shared/rpc/database_replication_rpc_definitions.js";

export function initializeDatabaseTableReplicationOutbox(sql: SqlStorage): void {
    sql.exec(
        `CREATE TABLE IF NOT EXISTS database_table_replication_outbox (
            storage_version INTEGER PRIMARY KEY,
            table_ids TEXT NOT NULL
        )`,
    );
}

export function enqueueDatabaseTableReplication(
    sql: SqlStorage,
    {
        storageVersion,
        tableIds,
    }: {
        storageVersion: number;
        tableIds: ReadonlySet<DatabaseTableId>;
    },
): void {
    if (storageVersion === 0 || tableIds.size === 0) return;

    const serializedTableIds = JSON.stringify([...tableIds].sort());
    sql.exec(
        `INSERT INTO database_table_replication_outbox (storage_version, table_ids)
         VALUES (?, ?)
         ON CONFLICT (storage_version) DO UPDATE SET
             table_ids = excluded.table_ids`,
        storageVersion,
        serializedTableIds,
    );
}

export async function drainDatabaseTableReplicationOutbox(
    context: WorkerActionContext | WorkerSessionActionContext,
    sql: SqlStorage,
    spaceId: SpaceId,
    databaseGroupId: DatabaseGroupId,
): Promise<void> {
    for (const row of sql.exec<{
        storage_version: number;
        table_ids: string;
    }>(
        `SELECT storage_version, table_ids
         FROM database_table_replication_outbox
         ORDER BY storage_version
         LIMIT 10`,
    )) {
        const tableIds = JSON.parse(row.table_ids) as Array<DatabaseTableId>;
        await replicateDatabaseTableChanges(context, {
            databaseGroupId,
            spaceId,
            storageVersion: row.storage_version,
            tableIds,
        });
        sql.exec(
            "DELETE FROM database_table_replication_outbox WHERE storage_version = ?",
            row.storage_version,
        );
    }
}
