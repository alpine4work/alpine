import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SpaceItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export async function getSpaceItem(
    context: DynamoContext,
    spaceId: SpaceId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SpaceItem> {
    const item = await getSpaceItemIfExists(context, spaceId, options);
    if (!item) throw createSpaceNotFoundError(spaceId);
    return item;
}

export async function getSpaceItemIfExists(
    context: DynamoContext,
    spaceId: SpaceId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<SpaceItem | null> {
    const items = await arrayFromAsyncIterable(
        SpacesTable.query(context, {
            limit: 3,
            partitionKey: {
                partitionType: "Space",
                spaceId,
            },
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "AvatarDarkTheme"},
            consistency,
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );
    if (!attributesItem) return null;

    const darkTheme = findMapIterable(items, item =>
        item.sortRangeType === "AvatarDarkTheme" ? item : undefined,
    );
    const lightTheme = findMapIterable(items, item =>
        item.sortRangeType === "AvatarLightTheme" ? item : undefined,
    );

    return {
        avatars: {
            darkTheme: darkTheme ?? null,
            lightTheme: lightTheme ?? null,
        },
        ...attributesItem,
    };
}

function createSpaceNotFoundError(spaceId: SpaceId) {
    return new NotFoundError("Space not found", {
        aggregateDedupeKey: spaceId,
        displayMessage: errorDisplayMessage`This space doesn\u2019t exist.`,
    });
}
