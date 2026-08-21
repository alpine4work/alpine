import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {runUpdateKnownBotSettingsMigration} from "~/server/bots/run_update_known_bot_settings_migration.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {botOwnerEntityIdForSystem} from "~/shared/bots/owners/bot_owner_entity.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export async function seedTestBots(
    context: DynamoContext,
    options: {
        agentServiceLocalPort: string | number;
        chatGptLocalUnscopedApiKey: string | null;
        chatGptLocalScopedApiKey: string | null;
        chatGptWebhookSecret?: string | null;
        claudeLocalUnscopedApiKey: string | null;
        claudeWebhookSecret?: string | null;
        cursorLocalUnscopedApiKey: string | null;
        cursorWebhookSecret?: string | null;
        mockChatGptLocalUnscopedApiKey: string;
        mockChatGptWebhookSecret?: string | null;
    },
) {
    assert(process.env.NODE_ENV !== "production");

    await runAllPromises([
        // Update all bot settings to their latest values in dev.
        runUpdateKnownBotSettingsMigration(context),

        seedTestChatGptBot(context, options),
        seedTestClaudeBot(context, options),
        seedTestCursorBot(context, options),
        seedTestMockChatGptBot(context, options),
    ]);
}

async function seedTestClaudeBot(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        claudeLocalUnscopedApiKey,
        claudeWebhookSecret = null,
    }: {
        agentServiceLocalPort: string | number;
        claudeLocalUnscopedApiKey: string | null;
        claudeWebhookSecret?: string | null;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {claudeBotId} = getDynamoSeedConstants();

    const currentTime = new Date();

    const promises: Array<Promise<unknown>> = [
        BotsTable.updateItem(
            context,
            {
                partitionType: "Bot",
                sortRangeType: "Attributes",
                botId: claudeBotId,
            },
            item => {
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/claude/webhook`;
                const webhook = {url: webhookUrl, secret: claudeWebhookSecret};

                // Noop if the webhook configuration is correct.
                if (item?.webhook?.url === webhook.url && item.webhook?.secret === webhook.secret) {
                    return item;
                }

                if (item) {
                    return {...item, webhook};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: claudeBotId,
                        createdTime: currentTime,
                        // Matches the keys seeded below, which are only created alongside a bot item that
                        // didn't exist yet.
                        apiKeyCount: claudeLocalUnscopedApiKey !== null ? 1 : 0,
                        deleted: null,
                        isDeleted: null,
                        name: "Claude",
                        webhook,
                        description: null,
                        ownerEntity: botOwnerEntityIdForSystem(),
                        // We only use this field for auditing purposes, so it can be a random id in tests.
                        createdByAccount: generateId<AccountId>(),
                    };
                }
            },
        ),
    ];

    if (claudeLocalUnscopedApiKey !== null) {
        promises.push(
            BotsTable.createItemIfNoneExists(context, {
                partitionType: "ApiKey",
                sortRangeType: "Attributes",
                apiKey: assertApiKey(claudeLocalUnscopedApiKey),
                botId: claudeBotId,
                spaceId: null,
                space: null,
                createdTime: currentTime,
                name: "Unscoped API Key",
            }),
        );
    }

    await runAllPromises(promises);
}

async function seedTestChatGptBot(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        chatGptLocalUnscopedApiKey,
        chatGptLocalScopedApiKey,
        chatGptWebhookSecret = null,
    }: {
        agentServiceLocalPort: string | number;
        chatGptLocalUnscopedApiKey: string | null;
        chatGptLocalScopedApiKey: string | null;
        chatGptWebhookSecret?: string | null;
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
                const webhook = {url: webhookUrl, secret: chatGptWebhookSecret};

                // Noop if the webhook configuration is correct.
                if (item?.webhook?.url === webhook.url && item.webhook?.secret === webhook.secret) {
                    return item;
                }

                if (item) {
                    return {...item, webhook};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: chatGptBotId,
                        createdTime: currentTime,
                        // Matches the keys seeded below, which are only created alongside a bot item that
                        // didn't exist yet.
                        apiKeyCount:
                            (chatGptLocalUnscopedApiKey !== null ? 1 : 0) +
                            (chatGptLocalScopedApiKey !== null ? 1 : 0),
                        deleted: null,
                        isDeleted: null,
                        name: "ChatGPT",
                        webhook,
                        description: null,
                        ownerEntity: botOwnerEntityIdForSystem(),
                        // We only use this field for auditing purposes, so it can be a random id in tests.
                        createdByAccount: generateId<AccountId>(),
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
        cursorWebhookSecret = null,
    }: {
        agentServiceLocalPort: string | number;
        cursorLocalUnscopedApiKey: string | null;
        cursorWebhookSecret?: string | null;
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
                const webhook = {url: webhookUrl, secret: cursorWebhookSecret};

                // Noop if the webhook configuration is correct.
                if (item?.webhook?.url === webhook.url && item.webhook?.secret === webhook.secret) {
                    return item;
                }

                if (item) {
                    return {...item, webhook};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: cursorBotId,
                        createdTime: currentTime,
                        // Matches the keys seeded below, which are only created alongside a bot item that
                        // didn't exist yet.
                        apiKeyCount: cursorLocalUnscopedApiKey !== null ? 1 : 0,
                        deleted: null,
                        isDeleted: null,
                        name: "Cursor",
                        webhook,
                        description: null,
                        ownerEntity: botOwnerEntityIdForSystem(),
                        // We only use this field for auditing purposes, so it can be a random id in tests.
                        createdByAccount: generateId<AccountId>(),
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
        mockChatGptWebhookSecret = null,
    }: {
        agentServiceLocalPort: string | number;
        mockChatGptLocalUnscopedApiKey: string;
        mockChatGptWebhookSecret?: string | null;
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
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/mock/chat-gpt/webhook`;
                const webhook = {url: webhookUrl, secret: mockChatGptWebhookSecret};

                // Noop if the webhook configuration is correct.
                if (item?.webhook?.url === webhook.url && item.webhook?.secret === webhook.secret) {
                    return item;
                }

                if (item) {
                    return {...item, webhook};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: mockChatGptBotId,
                        createdTime: currentTime,
                        // Matches the key seeded below, which is only created alongside a bot item that
                        // didn't exist yet.
                        apiKeyCount: 1,
                        deleted: null,
                        isDeleted: null,
                        name: "ChatGPT",
                        description: null,
                        ownerEntity: botOwnerEntityIdForSystem(),
                        webhook,
                        // We only use this field for auditing purposes, so it can be a random id in tests.
                        createdByAccount: generateId<AccountId>(),
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
