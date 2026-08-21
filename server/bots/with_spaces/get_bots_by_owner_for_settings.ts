import {BotsByOwnerIndex} from "~/server/bots/internal/bots_table.js";
import {getBotWithAvatarItemIfExists} from "~/server/bots/internal/get_bot_with_avatar_item.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {hasBotOperationAccess} from "~/server/spaces/authorize_bot_operation.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {BotOwnerEntity, intoBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get all bots owned by the given entity that the actor may manage. Uses a GSI so
 * it is always eventually consistent.
 *
 * If a `spaceId` is provided then only bots currently installed in that space are
 * returned. Throws if you don't have access to the space.
 */
export async function getBotsByOwnerForSettings(
    context: ServerAuthenticatedActionContext,
    ownerEntity: BotOwnerEntity,
    spaceId?: SpaceId,
): Promise<
    Array<{id: BotId; name: string; description: string | null; avatar: AvatarModel | null}>
> {
    // Authorize the space once up front instead of once per bot below.
    if (spaceId !== undefined) await authorizeSpaceAccess(context, spaceId);

    const botKeys = await arrayFromAsyncIterable(
        BotsByOwnerIndex.query(context, {
            partitionKey: {ownerEntity: intoBotOwnerEntityId(ownerEntity)},
            limit: "All",
        }),
    );

    const bots = await runAllPromises(
        botKeys.map(async botKey => {
            // The index only projects keys, so read the bot itself. This is a single query for
            // the bot's attributes, avatar, and description, and it's also what tells us
            // whether the bot was deleted between reading the index and reading the item.
            const botItem = await getBotWithAvatarItemIfExists(context, botKey.botId);
            if (!botItem) return null;

            // Reads the bot's attributes item out of the cache seeded by the query above
            // instead of making another dependent round trip.
            if (!(await hasBotOperationAccess(context, botKey.botId, {type: "Manage"}))) {
                return null;
            }

            return {
                id: botItem.id,
                name: botItem.name,
                description: botItem.description,
                avatar: createAvatarModelFromItem(botItem.avatar),
            };
        }),
    );

    return bots.filter(bot => bot !== null);
}
