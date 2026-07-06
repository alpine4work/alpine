import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {DatabaseTablesTable} from "~/server/databases/data/internal/database_tables_table.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import type {ReplicateDatabaseTableChangesJobDescription} from "~/server/jobs/core/job_description.js";
import {indexDatabaseTableSearchEntity} from "~/server/search/data/index/index_database_table_search_entity.js";
import {getSpaceIdForDatabaseGroupId} from "~/server/spaces/get_database_group_id_for_space.js";
import type {AccessPolicy} from "~/shared/access/access_policy.js";
import {emptyDatabaseTableAccessPolicy} from "~/shared/databases/database_table_access_policy.js";
import type {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";

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
        tableIds,
    }: {
        databaseGroupId: DatabaseGroupId;
        tableIds: ReadonlySet<DatabaseTableId>;
    },
): Promise<void> {
    const spaceId = await getSpaceIdForDatabaseGroupId(context, databaseGroupId);
    const uniqueTableIds = [...tableIds];
    await runAllPromises(
        uniqueTableIds.map(tableId =>
            replicateDatabaseTableChange(context, {
                databaseGroupId,
                spaceId,
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
        tableId,
    }: {
        databaseGroupId: DatabaseGroupId;
        spaceId: SpaceId;
        tableId: DatabaseTableId;
    },
): Promise<void> {
    const {result} = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getTableMetadata",
        input: {tableId},
    });

    const table = result.table;
    const tableMetadata = await updateDatabaseTableMetadataItem(context, {
        databaseGroupId,
        spaceId,
        tableId,
        table,
    });

    await indexDatabaseTableSearchEntity(context, {
        spaceId,
        tableId,
        name: tableMetadata.name,
        accessPolicy: tableMetadata.accessPolicy,
        isDeleted: tableMetadata.isDeleted,
    });
}

async function updateDatabaseTableMetadataItem(
    context: ServerActionContext,
    {
        databaseGroupId,
        spaceId,
        tableId,
        table,
    }: {
        databaseGroupId: DatabaseGroupId;
        spaceId: SpaceId;
        tableId: DatabaseTableId;
        table: DatabaseTableMetadata | null;
    },
): Promise<DatabaseTableMetadataModel> {
    const {getEvent} = await DatabaseTablesTable.updateItem(
        context,
        {
            partitionType: "DatabaseGroup",
            sortRangeType: "Table",
            databaseGroupId,
            tableId,
        },
        item =>
            DynamoItem.createOrUpdate(item, {
                partitionType: "DatabaseGroup",
                sortRangeType: "Table",
                databaseGroupId,
                tableId,
                spaceId,
                name: table?.name ?? null,
                isDeleted: table === null,
                accessPolicy:
                    table?.accessPolicy ?? item?.accessPolicy ?? emptyDatabaseTableAccessPolicy,
            }),
    );
    return (await getEvent(context)).item.model;
}

type DatabaseTableMetadata = {
    readonly id: DatabaseTableId;
    readonly name: string;
    readonly accessPolicy: AccessPolicy;
};
