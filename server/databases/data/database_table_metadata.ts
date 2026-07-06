import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {
    DatabaseTableItem,
    DatabaseTablesTable,
} from "~/server/databases/data/internal/database_tables_table.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import {type AccessPolicy, AccessPolicySchema} from "~/shared/access/access_policy.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {NotFoundError} from "~/shared/error/error.js";
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
): Promise<{
    name: string | null;
    accessPolicy: AccessPolicy;
    isDeleted: boolean;
}> {
    const databaseGroupId = await getDatabaseGroupIdForSpace(context, spaceId);
    const item = (await DatabaseTablesTable.getItemIfExists(context, {
        partitionType: "DatabaseGroup",
        sortRangeType: "Table",
        databaseGroupId,
        tableId,
    })) as DatabaseTableItem | null;

    if (item === null) {
        throw new NotFoundError(`Database table ${tableId} not found`);
    }

    const accessPolicy = await resolveDatabaseTableAccessPolicy(context, item.accessPolicy);
    if (!item.isDeleted && item.name !== null) {
        await syncDatabaseTableMetadataToDurableObject(context, {
            databaseGroupId,
            tableId,
            name: item.name,
            accessPolicy,
        });
    }

    return {
        name: item.name,
        accessPolicy,
        isDeleted: item.isDeleted,
    };
}

async function syncDatabaseTableMetadataToDurableObject(
    context: ServerActionContext,
    {
        databaseGroupId,
        tableId,
        name,
        accessPolicy,
    }: {
        databaseGroupId: DatabaseGroupId;
        tableId: DatabaseTableId;
        name: string;
        accessPolicy: AccessPolicy;
    },
): Promise<void> {
    await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "syncTableMetadata",
        input: {tableId, name, accessPolicy},
    });
}

async function resolveDatabaseTableAccessPolicy(
    context: ServerActionContext,
    accessPolicy: AccessPolicy,
): Promise<AccessPolicy> {
    const effectiveAccessPolicy = await intoEffectiveAccessPolicy(context, accessPolicy, {
        consistency: "StrongWithinCache",
    });

    return AccessPolicySchema.deserialize(
        AccessPolicySchema.serialize({
            type: "Local",
            accountGrantById: effectiveAccessPolicy.accountGrantById,
            defaultGrant: effectiveAccessPolicy.defaultGrant,
            urlGrant: effectiveAccessPolicy.urlGrant,
        } as AccessPolicy),
    );
}
