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
            space_id TEXT,
            table_ids TEXT NOT NULL
        )`,
    );
    const hasSpaceIdColumn = Array.from(
        sql.exec<{name: string}>("PRAGMA table_info(database_table_replication_outbox)"),
    ).some(column => column.name === "space_id");
    if (!hasSpaceIdColumn) {
        sql.exec("ALTER TABLE database_table_replication_outbox ADD COLUMN space_id TEXT");
    }
}

export function enqueueDatabaseTableReplication(
    sql: SqlStorage,
    {
        storageVersion,
        spaceId,
        tableIds,
    }: {
        storageVersion: number;
        spaceId: SpaceId;
        tableIds: ReadonlySet<DatabaseTableId>;
    },
): void {
    if (storageVersion === 0 || tableIds.size === 0) return;

    const serializedTableIds = JSON.stringify([...tableIds].sort());
    sql.exec(
        `INSERT INTO database_table_replication_outbox (storage_version, space_id, table_ids)
         VALUES (?, ?, ?)
         ON CONFLICT (storage_version) DO UPDATE SET
             space_id = excluded.space_id,
             table_ids = excluded.table_ids`,
        storageVersion,
        spaceId,
        serializedTableIds,
    );
}

export async function drainDatabaseTableReplicationOutbox(
    context: WorkerActionContext | WorkerSessionActionContext,
    sql: SqlStorage,
    databaseGroupId: DatabaseGroupId,
): Promise<void> {
    for (const row of sql.exec<{
        storage_version: number;
        space_id: string | null;
        table_ids: string;
    }>(
        `SELECT storage_version, space_id, table_ids
         FROM database_table_replication_outbox
         ORDER BY storage_version
         LIMIT 10`,
    )) {
        if (row.space_id === null) {
            sql.exec(
                "DELETE FROM database_table_replication_outbox WHERE storage_version = ?",
                row.storage_version,
            );
            continue;
        }
        const tableIds = JSON.parse(row.table_ids) as Array<DatabaseTableId>;
        await replicateDatabaseTableChanges(context, {
            databaseGroupId,
            spaceId: row.space_id as SpaceId,
            storageVersion: row.storage_version,
            tableIds,
        });
        sql.exec(
            "DELETE FROM database_table_replication_outbox WHERE storage_version = ?",
            row.storage_version,
        );
    }
}
