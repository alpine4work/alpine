import {getApiKeyAttributesIfExists} from "~/server/bots/get_api_key_attributes_if_exists.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {
    deleteBotBeforeExecuteTransactionTestCheckpoint,
    deleteBotIfExistsWithoutAuthorization,
} from "~/server/bots/internal/delete_bot_if_exists_without_authorization.js";
import {getBotItemForAuthorizationIfExists} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {getBotWithAvatarItemIfExists} from "~/server/bots/internal/get_bot_with_avatar_item.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/with_spaces/create_unscoped_api_key_for_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";

const context = createTestContext();

describe("deleteBotIfExistsWithoutAuthorization()", () => {
    test("soft-deletes the bot and clears its webhook", async () => {
        const bot = await TestBot.create(context, {webhookSecret: "secret"});
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});
        const action = session.action();

        await expect(getBotItemForAuthorizationIfExists(action, bot.id)).resolves.not.toBeNull();

        await deleteBotIfExistsWithoutAuthorization(action, {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: bot.id,
        });
        expect(item).toMatchObject({
            botId: bot.id,
            createdTime: expect.any(Date),
            deleted: {
                time: expect.any(Date),
                deletor: {id: session.account.id, from: null},
            },
            isDeleted: expect.any(Date),
            name: bot.initialName,
            webhook: null,
        });
        await expect(getBotItemForAuthorizationIfExists(action, bot.id)).resolves.toBeNull();
    });

    test("retains the bot\u2019s avatar item", async () => {
        const bot = await TestBot.create(context);
        await BotsTable.createItem(context, {
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId: bot.id,
            avatarId: null,
            content: null,
        });
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId: bot.id,
        });
        expect(item).toMatchObject({
            botId: bot.id,
            avatarId: null,
            content: null,
        });
        await expect(getBotWithAvatarItemIfExists(context.withCache(), bot.id)).resolves.toBeNull();
    });

    test("deletes the bot\u2019s settings schema item", async () => {
        const bot = await TestBot.create(context);
        await BotsTable.createItem(context, {
            partitionType: "Bot",
            sortRangeType: "SettingsSchema",
            botId: bot.id,
            description: emptySimpleContent,
            schema: {properties: new Map()},
        });
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "SettingsSchema",
            botId: bot.id,
        });
        expect(item).toBeNull();
    });

    test("deletes the bot\u2019s API keys", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).toBeNull();
    });

    test("resets the bot\u2019s API key count", async () => {
        const bot = await TestBot.create(context);
        await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        await expect(bot.getItem()).resolves.toMatchObject({apiKeyCount: 0});
    });

    test("does not authenticate an API key left behind by eventual consistency", async () => {
        const bot = await TestBot.create(context);
        const apiKey = await bot.createUnscopedApiKey();
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        // Simulate a recently-created API key that wasn't visible in `BotApiKeysIndex`
        // when the deletion queried it.
        await BotsTable.createItem(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
            botId: bot.id,
            spaceId: null,
            space: null,
            createdTime: new Date(),
            name: null,
        });

        await expect(
            getApiKeyAttributesIfExists(context, apiKey, {consistency: "Strong"}),
        ).resolves.toBeNull();
    });

    test("deletes an API key created while the bot is being deleted", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const pausePromise = deleteBotBeforeExecuteTransactionTestCheckpoint.pauseForTest(bot.id);
        const deletePromise = deleteBotIfExistsWithoutAuthorization(session.action(), {
            botId: bot.id,
        });
        const {unpause} = await pausePromise;

        // Created after the deletion read the bot's API keys, so it's only deleted if the
        // deletion notices it lost the race and retries.
        const apiKey = await createUnscopedApiKeyForBot(session.action(), {
            botId: bot.id,
            name: null,
        });

        unpause();
        await deletePromise;

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).toBeNull();
        await expect(
            getBotItemForAuthorizationIfExists(session.action(), bot.id),
        ).resolves.toBeNull();
    });

    test("deletes API keys left behind by a previous deletion", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});
        const firstDeletedItem = await BotsTable.getItem(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: bot.id,
        });

        // Simulate a key the previous deletion didn't see, e.g. because it was absent from
        // the eventually consistent `BotApiKeysIndex`.
        const apiKey = await bot.createUnscopedApiKey();

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).toBeNull();
        const secondDeletedItem = await BotsTable.getItem(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: bot.id,
        });
        expect(secondDeletedItem.deleted?.time).toEqual(firstDeletedItem.deleted?.time);
    });

    test("prevents new API keys from being created for the deleted bot", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});

        await expect(
            createUnscopedApiKeyForBot(session.action(), {botId: bot.id, name: null}),
        ).rejects.toThrow(new NotFoundError("Bot not found"));
    });

    test("is idempotent and retains the original deletion timestamp", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id});
        const firstDeletedItem = await BotsTable.getItem(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: bot.id,
        });

        await expect(
            deleteBotIfExistsWithoutAuthorization(session.action(), {botId: bot.id}),
        ).resolves.toBeUndefined();

        const secondDeletedItem = await BotsTable.getItem(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: bot.id,
        });
        expect(secondDeletedItem.deleted?.time).toEqual(firstDeletedItem.deleted?.time);
    });
});
