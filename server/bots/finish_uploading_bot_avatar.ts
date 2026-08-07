import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {createBotFromItem} from "~/server/bots/internal/create_bot_from_item.js";
import {getBotWithAvatarItem} from "~/server/bots/internal/get_bot_with_avatar_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {AvatarId, BotId} from "~/shared/id/types/id_types.open_source.js";

export async function finishUploadingBotAvatar(
    context: ServerSessionActionContext,
    {botId, avatarContent, avatarId}: {botId: BotId; avatarContent: Uint8Array; avatarId: AvatarId},
): Promise<Bot> {
    await authorizeInternalAccess(context);

    return await context.dynamo.retryTransaction(async context => {
        const oldBotItem = await getBotWithAvatarItem(context, botId);
        const oldBotAvatar = oldBotItem.avatar;

        // NOTE(ifitzsimmons, #2025-12-15): When we update a Bot's avatar, we create an
        // async job to update the `Account#Avatar` item for each Account associated with
        // the bot. This operation needs to be idempotent. When the job runs, it fetches
        // the most recent Avatar from the `Bot#Avatar` item and copies it into the
        // `Account#Avatar` item for every bot `Account`. If a user were to change the
        // bot's avatar twice in quick succession, we would end up with two async jobs
        // running in parallel. Without this check, it's possible that the job associated
        // with the second update runs first for some or all accounts. This would result in
        // the second update being lost.
        //
        // Since we guarantee idempotency when copying a bot's avatar into the
        // `Account#Avatar` item, we need to make sure that we don't overwrite new bot
        // avatars with old ones.
        if (oldBotAvatar?.avatarId && oldBotAvatar.avatarId >= avatarId) {
            return createBotFromItem(oldBotItem);
        }

        const botAvatarItem = await BotsTable.directlyUpdateItem(context, {
            ...oldBotAvatar,
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId,
            avatarId,
            content: avatarContent,
        });

        await context.jobs.dangerouslySendMaintenance({
            type: "UpdateBotAccounts",
            botId,
            update: {
                type: "Avatar",
            },
        });

        return createBotFromItem({
            ...oldBotItem,
            avatar: botAvatarItem,
        });
    });
}
