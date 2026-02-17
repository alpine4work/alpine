import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {runUpdateKnownBotSettingsMigration} from "~/server/bots/run_update_known_bot_settings_migration.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertApiKey} from "~/shared/id/api_key.js";

export async function seedTestBots(
    context: DynamoContext,
    options: {
        agentServiceLocalPort: string;
        chatGptLocalUnscopedApiKey: string;
        chatGptLocalScopedApiKey: string;
        cursorLocalUnscopedApiKey: string;
        mockChatGptLocalUnscopedApiKey: string;
    },
) {
    assert(process.env.NODE_ENV !== "production");

    await runAllPromises([
        // Update all bot settings to their latest values in dev.
        runUpdateKnownBotSettingsMigration(context),

        seedTestChatGptBot(context, options),
        seedTestCursorBot(context, options),
        seedTestMockChatGptBot(context, options),
    ]);
}

async function seedTestChatGptBot(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        chatGptLocalUnscopedApiKey,
        chatGptLocalScopedApiKey,
    }: {
        agentServiceLocalPort: string;
        chatGptLocalUnscopedApiKey: string;
        chatGptLocalScopedApiKey: string;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {adminAccountId, defaultSpaceId, chatGptBotId, chatGptBotAccountIdForDefaultSpace} =
        getDynamoSeedConstants();

    const currentTime = new Date();

    await runAllPromises([
        BotsTable.updateItem(
            context,
            {
                partitionType: "Bot",
                sortRangeType: "Attributes",
                botId: chatGptBotId,
            },
            item => {
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/chat-gpt/webhook`;

                // Noop if the webhook URL is correct.
                if (item?.webhookUrl === webhookUrl) return item;

                if (item) {
                    return {...item, webhookUrl};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: chatGptBotId,
                        createdTime: currentTime,
                        name: "ChatGPT",
                        webhookUrl,
                    };
                }
            },
        ),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(chatGptLocalUnscopedApiKey),
            botId: chatGptBotId,
            spaceId: null,
            space: null,
            createdTime: currentTime,
            name: "Unscoped API Key",
        }),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(chatGptLocalScopedApiKey),
            botId: chatGptBotId,
            spaceId: defaultSpaceId,
            space: {
                accountId: chatGptBotAccountIdForDefaultSpace,
                scope: {type: "Account", accountId: adminAccountId},
            },
            createdTime: currentTime,
            name: "Scoped API Key",
        }),
    ]);
}

async function seedTestCursorBot(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        cursorLocalUnscopedApiKey,
    }: {
        agentServiceLocalPort: string;
        cursorLocalUnscopedApiKey: string;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {cursorBotId} = getDynamoSeedConstants();

    const currentTime = new Date();

    await runAllPromises([
        BotsTable.updateItem(
            context,
            {
                partitionType: "Bot",
                sortRangeType: "Attributes",
                botId: cursorBotId,
            },
            item => {
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/cursor/webhook`;

                // Noop if the webhook URL is correct.
                if (item?.webhookUrl === webhookUrl) return item;

                if (item) {
                    return {...item, webhookUrl};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: cursorBotId,
                        createdTime: currentTime,
                        name: "Cursor",
                        webhookUrl,
                    };
                }
            },
        ),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(cursorLocalUnscopedApiKey),
            botId: cursorBotId,
            spaceId: null,
            space: null,
            createdTime: currentTime,
            name: "Unscoped API Key",
        }),
    ]);
}

export async function seedTestMockChatGptBot(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        mockChatGptLocalUnscopedApiKey,
    }: {
        agentServiceLocalPort: string | number;
        mockChatGptLocalUnscopedApiKey: string;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {mockChatGptBotId} = getDynamoSeedConstants();

    const currentTime = new Date();

    await runAllPromises([
        BotsTable.updateItem(
            context,
            {
                partitionType: "Bot",
                sortRangeType: "Attributes",
                botId: mockChatGptBotId,
            },
            item => {
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/mock/webhook`;

                // Noop if the webhook URL is correct.
                if (item?.webhookUrl === webhookUrl) return item;

                if (item) {
                    return {...item, webhookUrl};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: mockChatGptBotId,
                        createdTime: currentTime,
                        name: "ChatGPT",
                        webhookUrl,
                    };
                }
            },
        ),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(mockChatGptLocalUnscopedApiKey),
            botId: mockChatGptBotId,
            spaceId: null,
            space: null,
            createdTime: currentTime,
            name: "Unscoped API Key",
        }),
    ]);
}
