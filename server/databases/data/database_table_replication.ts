import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {DatabaseTablesTable} from "~/server/databases/data/internal/database_tables_table.js";
import type {ReplicateDatabaseTableChangesJobDescription} from "~/server/jobs/core/job_description.js";
import {indexDatabaseTableSearchEntity} from "~/server/search/data/index/index_database_table_search_entity.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import type {
    DatabaseFieldId,
    DatabaseGroupId,
    DatabaseTableId,
    SpaceId,
} from "~/shared/id/types/id_types.js";

const defaultDatabaseTableAccessPolicy: LocalAccessPolicy = {
    type: "Local",
    accountGrantById: emptyMap,
    defaultGrant: null,
    urlGrant: null,
};

export async function processReplicateDatabaseTableChangesJob(
    context: ServerActionContext,
    job: ReplicateDatabaseTableChangesJobDescription,
): Promise<void> {
    await replicateDatabaseTableChanges(context, job);
}

export async function replicateDatabaseTableChanges(
    context: ServerActionContext,
    {
        databaseGroupId,
        spaceId,
        storageVersion,
        tableIds,
    }: {
        databaseGroupId: DatabaseGroupId;
        spaceId: SpaceId;
        storageVersion: number;
        tableIds: ReadonlySet<DatabaseTableId>;
    },
): Promise<void> {
    const uniqueTableIds = [...tableIds];
    await runAllPromises(
        uniqueTableIds.map(tableId =>
            replicateDatabaseTableChange(context, {
                databaseGroupId,
                spaceId,
                storageVersion,
                tableId,
            }),
        ),
    );
}

async function replicateDatabaseTableChange(
    context: ServerActionContext,
    {
        databaseGroupId,
        spaceId,
        storageVersion,
        tableId,
    }: {
        databaseGroupId: DatabaseGroupId;
        spaceId: SpaceId;
        storageVersion: number;
        tableId: DatabaseTableId;
    },
): Promise<void> {
    const {result} = await fetchDatabaseGroupAction(context, spaceId, databaseGroupId, {
        name: "getTableMetadata",
        input: {tableId},
    });

    const table = result.table;
    const updatedItem = await updateDatabaseTableDynamoItem(context, {
        databaseGroupId,
        spaceId,
        storageVersion,
        tableId,
        table,
    });

    await indexDatabaseTableSearchEntity(context, {
        spaceId,
        tableId,
        name: updatedItem.name,
        tableName: updatedItem.tableName,
        accessPolicy: updatedItem.accessPolicy,
        isDeleted: updatedItem.isDeleted,
    });
}

async function updateDatabaseTableDynamoItem(
    context: ServerActionContext,
    {
        databaseGroupId,
        spaceId,
        storageVersion,
        tableId,
        table,
    }: {
        databaseGroupId: DatabaseGroupId;
        spaceId: SpaceId;
        storageVersion: number;
        tableId: DatabaseTableId;
        table: DatabaseTableMetadata | null;
    },
): Promise<NonNullable<Awaited<ReturnType<typeof DatabaseTablesTable.updateItem>>>> {
    return await DatabaseTablesTable.updateItem(
        context,
        {
            partitionType: "DatabaseGroup",
            sortRangeType: "Table",
            databaseGroupId,
            tableId,
        },
        item => ({
            ...(item ?? {}),
            partitionType: "DatabaseGroup",
            sortRangeType: "Table",
            databaseGroupId,
            tableId,
            spaceId,
            name: table?.name ?? null,
            tableName: table?.tableName ?? null,
            nameFieldId: table?.nameFieldId ?? null,
            isDeleted: table === null,
            lastReplicatedStorageVersion: Math.max(
                item?.lastReplicatedStorageVersion ?? 0,
                storageVersion,
            ),
            accessPolicy: item?.accessPolicy ?? defaultDatabaseTableAccessPolicy,
        }),
    );
}

type DatabaseTableMetadata = {
    readonly id: DatabaseTableId;
    readonly name: string;
    readonly tableName: string;
    readonly nameFieldId: DatabaseFieldId;
};
