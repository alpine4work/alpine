import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {initialBotSettingsItem} from "~/server/bots/internal/initial_bot_settings_item.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {authorizeBotCreation} from "~/server/spaces/authorize_bot_operation.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {BotWebhook} from "~/shared/bots/bot_schema.js";
import {BotOwnerEntity, intoBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {createSimpleContent, emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Create a new bot. If a spaceId is provided, the bot will also be installed in
 * that space.
 */
export async function createBot(
    context: ServerAccountActionContext,
    {
        name,
        description,
        webhook,
        ownerEntity,
        spaceId,
    }: {
        name: string;
        // `undefined` leaves the existing description untouched, `null` clears it, a
        // string sets it.
        description?: string | null;
        webhook: BotWebhook | null;
        ownerEntity: BotOwnerEntity;
        spaceId?: SpaceId;
    },
): Promise<{botId: BotId}> {
    context.actor.authorizeAccount();

    await authorizeBotCreation(context, {ownerEntity, installSpaceId: spaceId});

    const currentDate = new Date();

    const botId = generateId<BotId>();

    const transactionEntries: Array<DynamoTransactionEntry> = [
        BotsTable.transactionCreateItem({
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId,
            createdTime: currentDate,
            createdByAccount: context.actor.getPossiblyBotAccountId(),
            deleted: null,
            isDeleted: null,
            name,
            ownerEntity: intoBotOwnerEntityId(ownerEntity),
            webhook,
            apiKeyCount: 0,
        }),
    ];

    // The description lives on the `SettingsSchema` item (the single home for every
    // bot's description). Owners author it as plain text, which we store as simple
    // content.
    if (description !== undefined) {
        transactionEntries.push(
            BotsTable.transactionCreateItem({
                partitionType: "Bot",
                sortRangeType: "SettingsSchema",
                botId,
                ...initialBotSettingsItem,
                description:
                    description !== null ? createSimpleContent(description) : emptySimpleContent,
            }),
        );
    }

    await DynamoTableSchema.executeTransaction(context, transactionEntries);

    if (spaceId) {
        await installBotInSpace(context, {spaceId, botId});
    }

    return {botId};
}
