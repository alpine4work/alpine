import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {initialBotSettingsItem} from "~/server/bots/internal/initial_bot_settings_item.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {BotWebhook} from "~/shared/bots/bot_schema.js";
import {
    BotOwnerEntity,
    botOwnerEntityIdForSystem,
    intoBotOwnerEntityId,
} from "~/shared/bots/owners/bot_owner_entity.js";
import {createSimpleContent} from "~/shared/content/simple_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";

export async function createBotForTest(
    context: DynamoContext,
    {
        id: botId = generateId<BotId>(),
        name,
        description = null,
        webhook,
        ownerEntity,
    }: {
        id?: BotId;
        name: string;
        description?: string | null;
        webhook: BotWebhook | null;
        ownerEntity?: BotOwnerEntity;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    // We only use this field for auditing purposes, so if the owner entity is an
    // account, use that account id, otherwise generate a random one.
    const createdByAccount =
        ownerEntity?.type === "Account" ? ownerEntity.accountId : generateId<AccountId>();

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
        createdTime: new Date(),
        deleted: null,
        isDeleted: null,
        name,
        webhook,
        ownerEntity: ownerEntity ? intoBotOwnerEntityId(ownerEntity) : botOwnerEntityIdForSystem(),
        createdByAccount,
        apiKeyCount: 0,
    });

    // The description lives on the `SettingsSchema` item. Only create one when a
    // description was requested — reads fall back to `initialBotSettingsItem`
    // otherwise.
    if (description !== null) {
        await BotsTable.createItem(context, {
            partitionType: "Bot",
            sortRangeType: "SettingsSchema",
            botId,
            ...initialBotSettingsItem,
            description: createSimpleContent(description),
        });
    }

    return {id: botId};
}
