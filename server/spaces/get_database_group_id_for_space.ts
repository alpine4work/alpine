import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    SpaceDatabaseGroupItem,
    SpaceItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseGroupId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Resolve the `databaseGroupId` for a given space, lazily instantiating it if the
 * space doesn't already have one.
 *
 * Every caller that needs to address a workspace's SQLite instance — route
 * loaders, RPC handlers, durable-object routing — should go through this helper.
 * Older spaces created before the refactor don't have a `databaseGroupId` on their
 * `SpaceItem`, so we generate one on-demand and write it back via `updateItem` so
 * concurrent callers converge on the same ID through the table's
 * optimistic-locking retry loop.
 *
 * The caller is responsible for authorizing access to the space.
 */
export async function getDatabaseGroupIdForSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<DatabaseGroupId> {
    const updatedItem = (await SpacesTable.updateItem(
        context,
        {partitionType: "Space", sortRangeType: "Attributes", spaceId},
        item => {
            if (item === null) return null;
            if (item.databaseGroupId !== undefined) return item;
            return {...item, databaseGroupId: generateId<DatabaseGroupId>()};
        },
    )) as SpaceItem | null;

    if (updatedItem === null || updatedItem.databaseGroupId === undefined) {
        throw new NotFoundError(`Space ${spaceId} not found`);
    }

    await SpacesTable.createOrReplaceItem(context, {
        partitionType: "DatabaseGroup",
        sortRangeType: "Space",
        databaseGroupId: updatedItem.databaseGroupId,
        spaceId,
    });

    return updatedItem.databaseGroupId;
}

export async function getExistingDatabaseGroupIdForSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<DatabaseGroupId> {
    const item = (await SpacesTable.getItemIfExists(
        context,
        {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
        },
        {consistency: "Strong"},
    )) as SpaceItem | null;

    if (item === null) {
        throw new NotFoundError(`Space ${spaceId} not found`);
    }

    if (item.databaseGroupId === undefined) {
        throw new NotFoundError(`Database group for space ${spaceId} not found`);
    }

    return item.databaseGroupId;
}

export async function getSpaceIdForDatabaseGroupId(
    context: ServerActionContext,
    databaseGroupId: DatabaseGroupId,
): Promise<SpaceId> {
    const item = (await SpacesTable.getItemIfExists(context, {
        partitionType: "DatabaseGroup",
        sortRangeType: "Space",
        databaseGroupId,
    })) as SpaceDatabaseGroupItem | null;

    if (item === null) {
        throw new NotFoundError(`Database group ${databaseGroupId} not found`);
    }
    return item.spaceId;
}
