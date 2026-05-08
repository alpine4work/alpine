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
        agentServiceLocalPort: string | number;
        chatGptLocalUnscopedApiKey: string | null;
        chatGptLocalScopedApiKey: string | null;
        cursorLocalUnscopedApiKey: string | null;
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
        agentServiceLocalPort: string | number;
        chatGptLocalUnscopedApiKey: string | null;
        chatGptLocalScopedApiKey: string | null;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {adminAccountId, defaultSpaceId, chatGptBotId, chatGptBotAccountIdForDefaultSpace} =
        getDynamoSeedConstants();

    const currentTime = new Date();

    const promises: Array<Promise<unknown>> = [
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
    ];

    if (chatGptLocalUnscopedApiKey !== null) {
        promises.push(
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
        );
    }

    if (chatGptLocalScopedApiKey !== null) {
        promises.push(
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
        );
    }

    await runAllPromises(promises);
}

async function seedTestCursorBot(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        cursorLocalUnscopedApiKey,
    }: {
        agentServiceLocalPort: string | number;
        cursorLocalUnscopedApiKey: string | null;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {cursorBotId} = getDynamoSeedConstants();

    const currentTime = new Date();

    const promises: Array<Promise<unknown>> = [
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
    ];

    if (cursorLocalUnscopedApiKey !== null) {
        promises.push(
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
        );
    }

    await runAllPromises(promises);
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
