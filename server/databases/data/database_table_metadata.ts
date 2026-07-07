import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {DatabaseTablesTable} from "~/server/databases/data/internal/database_tables_table.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    getDatabaseGroupIdForSpace,
    getExistingDatabaseGroupIdForSpace,
} from "~/server/spaces/get_database_group_id_for_space.js";
import {type AccessPolicy, type LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseGroupId,
    DatabaseTableId,
    DatabaseViewId,
    SpaceId,
} from "~/shared/id/types/id_types.js";

export async function createDatabaseTable(
    context: ServerActionContext,
    {spaceId, name}: {spaceId: SpaceId; name: string},
): Promise<{tableId: DatabaseTableId; viewId: DatabaseViewId}> {
    const sessionContext = context.actor.authorizeSession();
    await authorizeSpaceAccess(sessionContext, spaceId, "Member");

    const databaseGroupId = await getDatabaseGroupIdForSpace(sessionContext, spaceId);
    const tableId = generateChronologicalId<DatabaseTableId>();
    const accessPolicy = databaseTableAccessPolicyForCreator(sessionContext.actor.getAccountId());

    await DatabaseTablesTable.updateItem(
        context,
        {partitionType: "DatabaseGroup", sortRangeType: "Table", databaseGroupId, tableId},
        item =>
            DynamoItem.createOrUpdate(item, {
                partitionType: "DatabaseGroup",
                sortRangeType: "Table",
                databaseGroupId,
                tableId,
                spaceId,
                name,
                isDeleted: false,
                accessPolicy,
            }),
    );

    const {result} = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "createTable",
        input: {tableId, name, accessPolicy},
    });

    context.process.waitUntil(
        context.jobs.sendAndWait({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "DatabaseTable",
                tableId,
                updatedTraits: {type: "Any"},
            },
        }),
    );

    return {tableId, viewId: result.viewId};
}

export async function getDatabaseTableMetadataForSearchIndex(
    context: ServerActionContext,
    {spaceId, tableId}: {spaceId: SpaceId; tableId: DatabaseTableId},
): Promise<DatabaseTableMetadataModel> {
    const databaseGroupId = await getExistingDatabaseGroupIdForSpace(context, spaceId);
    const item = await DatabaseTablesTable.getRealtimeItemIfExists(
        context,
        {
            partitionType: "DatabaseGroup",
            sortRangeType: "Table",
            databaseGroupId,
            tableId,
        },
        {consistency: "Strong"},
    );

    if (item === null) {
        throw new NotFoundError(`Database table ${tableId} not found`);
    }

    return item.model;
}

export async function syncDatabaseTableMetadataToDurableObject(
    context: ServerActionContext,
    {
        spaceId,
        tableId,
        name,
        accessPolicy,
    }: {
        spaceId: SpaceId;
        tableId: DatabaseTableId;
        name: string;
        accessPolicy: AccessPolicy;
    },
): Promise<void> {
    const databaseGroupId = await getExistingDatabaseGroupIdForSpace(context, spaceId);
    const localAccessPolicy = await resolveDatabaseTableAccessPolicyForDurableObjectSync(
        context,
        accessPolicy,
    );

    await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "syncTableMetadata",
        input: {tableId, name, accessPolicy: localAccessPolicy},
    });
}

export async function createDatabaseTableMetadataForTest(
    context: ServerActionContext,
    {
        databaseGroupId,
        tableId,
        spaceId,
        name,
        isDeleted = false,
        accessPolicy,
    }: {
        databaseGroupId: DatabaseGroupId;
        tableId: DatabaseTableId;
        spaceId: SpaceId;
        name: string | null;
        isDeleted?: boolean;
        accessPolicy: AccessPolicy;
    },
): Promise<void> {
    assert(process.env.NODE_ENV === "test");

    await DatabaseTablesTable.updateItem(
        context,
        {partitionType: "DatabaseGroup", sortRangeType: "Table", databaseGroupId, tableId},
        item =>
            DynamoItem.createOrUpdate(item, {
                partitionType: "DatabaseGroup",
                sortRangeType: "Table",
                databaseGroupId,
                tableId,
                spaceId,
                name,
                isDeleted,
                accessPolicy,
            }),
    );
}

async function resolveDatabaseTableAccessPolicyForDurableObjectSync(
    context: ServerActionContext,
    accessPolicy: AccessPolicy,
): Promise<LocalAccessPolicy> {
    switch (accessPolicy.type) {
        case "Local": {
            const localAccessPolicy: LocalAccessPolicy = accessPolicy;
            return localAccessPolicy;
        }
        case "Site": {
            const localAccessPolicy: LocalAccessPolicy =
                await context.sitesInjection.dangerouslyGetSiteAccessPolicyWithoutAuthorization(
                    accessPolicy.siteId,
                    {consistency: "StrongWithinCache"},
                );
            return localAccessPolicy;
        }
        default:
            throw exhaustive(accessPolicy);
    }
}
