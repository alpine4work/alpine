import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {DatabaseTablesTable} from "~/server/databases/data/internal/database_tables_table.js";
import {resolveDatabaseTableAccessPolicyForDurableObject} from "~/server/databases/data/resolve_database_table_access_policy_for_durable_object.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {assignDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import type {AccessPolicy} from "~/shared/access/access_policy.js";
import type {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import type {RynamoEvent, RynamoEventStub, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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

    const databaseGroupId = await assignDatabaseGroupIdForSpace(sessionContext, spaceId);
    const tableId = generateChronologicalId<DatabaseTableId>();
    const accessPolicy = databaseTableAccessPolicyForCreator(sessionContext.actor.getAccountId());

    await DatabaseTablesTable.updateItem(
        context,
        {partitionType: "Table", sortRangeType: "Attributes", tableId},
        item =>
            DynamoItem.createOrUpdate(item, {
                partitionType: "Table",
                sortRangeType: "Attributes",
                tableId,
                databaseGroupId,
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

export async function updateDatabaseTableAccessPolicy(
    context: ServerActionContext,
    {
        tableId,
        accessPolicy,
    }: {
        tableId: DatabaseTableId;
        accessPolicy: CreateOrUpdateAccessPolicy;
    },
): Promise<{events: ReadonlyArray<RynamoEvent<DatabaseTableMetadataModel>>}> {
    const sessionContext = context.actor.authorizeSession();

    const {getEvent, spaceId} = await sessionContext.dynamo.retryTransaction(async context => {
        const item = await DatabaseTablesTable.getItemIfExists(
            context,
            {partitionType: "Table", sortRangeType: "Attributes", tableId},
            {consistency: "Strong"},
        );

        if (item === null || item.name === null) {
            throw new NotFoundError(`Database table ${tableId} not found`);
        }
        const {spaceId} = item;
        await authorizeSpaceAccess(context, spaceId, "Member");
        if (
            !(await evaluateAccessPolicy(context, spaceId, item.accessPolicy, "Manage", {
                consistency: "Strong",
            }))
        ) {
            throw new PermissionDeniedError(
                `Account does not have Manage access to database table ${tableId}`,
            );
        }

        const {transactionEntries} = await validateAccessPolicyUpdateForServer(
            context,
            spaceId,
            `DatabaseTable:${tableId}`,
            item.accessPolicy,
            accessPolicy,
            {consistency: "Strong"},
        );
        const storedAccessPolicy: AccessPolicy =
            accessPolicy.type === "Local"
                ? accessPolicy
                : {type: "Site", siteId: accessPolicy.siteId};
        const tableEntry = DatabaseTablesTable.transactionDirectlyUpdateItemWithEvent(
            item.update({accessPolicy: storedAccessPolicy}),
        );

        await RynamoTableSchema.executeTransaction(context, [
            tableEntry.transactionEntry,
            ...transactionEntries.map(entry => entry.transactionEntry),
        ]);

        return {getEvent: tableEntry.getEvent, spaceId};
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

    return {events: [await getEvent(context)]};
}

export async function getDatabaseTableMetadataItem(
    context: ServerActionContext,
    tableId: DatabaseTableId,
): Promise<RynamoItem<DatabaseTableMetadataModel>> {
    const item = await DatabaseTablesTable.getRealtimeItemIfExists(
        context,
        {
            partitionType: "Table",
            sortRangeType: "Attributes",
            tableId,
        },
        {consistency: "Strong"},
    );

    if (item === null) {
        throw new NotFoundError(`Database table ${tableId} not found`);
    }
    const {spaceId} = item.model;
    await authorizeSpaceAccess(context, spaceId);
    if (
        !(await evaluateAccessPolicy(context, spaceId, item.model.accessPolicy, "View", {
            consistency: "Strong",
        }))
    ) {
        throw new PermissionDeniedError(
            `Account does not have View access to database table ${tableId}`,
        );
    }

    return item;
}

export async function getDatabaseTableMetadata(
    context: ServerActionContext,
    tableId: DatabaseTableId,
): Promise<DatabaseTableMetadataModel> {
    return (await getDatabaseTableMetadataItem(context, tableId)).model;
}

export async function getDatabaseTableMetadataRealtimeEvent(
    context: ServerActionContext,
    databaseGroupId: DatabaseGroupId,
    events: ReadonlyArray<RynamoEventStub>,
): Promise<{
    events: ReadonlyArray<RynamoEvent<DatabaseTableMetadataModel>>;
    deniedTableIds: ReadonlyArray<DatabaseTableId>;
}> {
    const eventStubs = events.map(eventStub => {
        const itemKey = DatabaseTablesTable.deserializeOpaqueItemKey(eventStub.item.key);

        if (itemKey.partitionType === "Table" && itemKey.sortRangeType === "Attributes") {
            return {...eventStub, itemKey};
        }

        throw new PermissionDeniedError(
            "Can\u2019t get realtime event for item that\u2019s not associated with the designated database group",
        );
    });
    const actualEvents = (await DatabaseTablesTable.getRealtimeEvent(
        context,
        eventStubs,
    )) as ReadonlyArray<RynamoEvent<DatabaseTableMetadataModel>>;

    // Redact rather than reject: a database group mixes tables the actor can and can't
    // see, so a denied event must not tear down the actor's realtime connection.
    // Withheld table ids are returned so receivers can update their access maps (a
    // denial doubles as the revocation signal). Hard deletion is disabled for database
    // table metadata because a delete event doesn't contain the group ID required to
    // validate its routing.
    const visibleEvents: Array<RynamoEvent<DatabaseTableMetadataModel>> = [];
    const deniedTableIds: Array<DatabaseTableId> = [];

    await runAllPromises(
        actualEvents.map(async (event, index) => {
            let isAuthorized = false;
            switch (event.type) {
                case "PutItem": {
                    if (event.item.model.databaseGroupId !== databaseGroupId) {
                        throw new PermissionDeniedError(
                            "Can\u2019t get realtime event for a table outside the designated database group",
                        );
                    }
                    isAuthorized = await evaluateAccessPolicy(
                        context,
                        event.item.model.spaceId,
                        event.item.model.accessPolicy,
                        "View",
                        {consistency: "Strong"},
                    );
                    break;
                }
                case "DeleteItem":
                    throw new PermissionDeniedError(
                        "Can\u2019t validate a deleted database table against the designated database group",
                    );
                default:
                    throw exhaustive(event);
            }

            if (isAuthorized) {
                visibleEvents.push(event);
            } else {
                deniedTableIds.push(eventStubs[index]!.itemKey.tableId);
            }
        }),
    );

    return {events: visibleEvents, deniedTableIds};
}

export async function getDatabaseTableMetadataForSearchIndex(
    context: ServerActionContext,
    tableId: DatabaseTableId,
): Promise<DatabaseTableMetadataModel> {
    return await getDatabaseTableMetadata(context, tableId);
}

export async function syncDatabaseTableMetadataToDurableObject(
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
    const localAccessPolicy = await resolveDatabaseTableAccessPolicyForDurableObject(
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
        {partitionType: "Table", sortRangeType: "Attributes", tableId},
        item =>
            DynamoItem.createOrUpdate(item, {
                partitionType: "Table",
                sortRangeType: "Attributes",
                tableId,
                databaseGroupId,
                spaceId,
                name,
                isDeleted,
                accessPolicy,
            }),
    );
}
