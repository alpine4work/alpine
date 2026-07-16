import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    SpaceDatabaseGroupItem,
    SpaceItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseGroupId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Return the database group assigned to a space, or `null` if the space has no
 * databases yet.
 *
 * This is intentionally read-only. Database groups are assigned by {@link
 * assignDatabaseGroupIdForSpace} when the first database is created.
 */
export async function getDatabaseGroupIdForSpaceIfExists(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<DatabaseGroupId | null> {
    let item = (await SpacesTable.getItemIfExists(
        context,
        {partitionType: "Space", sortRangeType: "Attributes", spaceId},
        {consistency: "Eventual", allowsEventualReadConsistency: true},
    )) as SpaceItem | null;

    // A database group assignment is immutable, so an eventually consistent value is
    // sufficient once present. A missing assignment may have just been created,
    // however, so confirm absence with a strong read.
    if (item === null || item.databaseGroupId === undefined) {
        item = (await SpacesTable.getItemIfExists(
            context,
            {partitionType: "Space", sortRangeType: "Attributes", spaceId},
            {consistency: "Strong"},
        )) as SpaceItem | null;

        if (item === null) {
            throw new NotFoundError(`Space ${spaceId} not found`);
        }
    }

    return item.databaseGroupId ?? null;
}

export async function getDatabaseGroupIdForSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<DatabaseGroupId> {
    const databaseGroupId = await getDatabaseGroupIdForSpaceIfExists(context, spaceId);
    if (databaseGroupId === null) {
        throw new NotFoundError(`Database group for space ${spaceId} not found`);
    }
    return databaseGroupId;
}

/** Assign a database group to a space if it does not already have one. */
export async function assignDatabaseGroupIdForSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<DatabaseGroupId> {
    return await context.dynamo.retryTransaction(async context => {
        const item = (await SpacesTable.getItemIfExists(
            context,
            {partitionType: "Space", sortRangeType: "Attributes", spaceId},
            {consistency: "Strong"},
        )) as SpaceItem | null;

        if (item === null) {
            throw new NotFoundError(`Space ${spaceId} not found`);
        }
        if (item.databaseGroupId !== undefined) {
            return item.databaseGroupId;
        }

        const databaseGroupId = generateId<DatabaseGroupId>();
        await DynamoTableSchema.executeTransaction(context, [
            SpacesTable.transactionDirectlyUpdateItem({...item, databaseGroupId}),
            SpacesTable.transactionCreateItem({
                partitionType: "DatabaseGroup",
                sortRangeType: "Space",
                databaseGroupId,
                spaceId,
            }),
        ]);

        return databaseGroupId;
    });
}

export async function getSpaceIdForDatabaseGroupId(
    context: ServerActionContext,
    databaseGroupId: DatabaseGroupId,
): Promise<SpaceId> {
    let item = (await SpacesTable.getItemIfExists(
        context,
        {
            partitionType: "DatabaseGroup",
            sortRangeType: "Space",
            databaseGroupId,
        },
        {consistency: "Eventual", allowsEventualReadConsistency: true},
    )) as SpaceDatabaseGroupItem | null;

    // This mapping is immutable. An eventual hit is therefore authoritative, while a
    // miss needs a strong retry to distinguish absence from replication lag.
    if (item === null) {
        item = (await SpacesTable.getItemIfExists(
            context,
            {
                partitionType: "DatabaseGroup",
                sortRangeType: "Space",
                databaseGroupId,
            },
            {consistency: "Strong"},
        )) as SpaceDatabaseGroupItem | null;

        if (item === null) {
            throw new NotFoundError(`Database group ${databaseGroupId} not found`);
        }
    }
    return item.spaceId;
}
