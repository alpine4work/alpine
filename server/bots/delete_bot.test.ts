import {deleteBotIfExists} from "~/server/bots/delete_bot.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";

const context = createTestContext();

describe("deleteBot()", () => {
    test("deletes the bot", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExists(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: bot.id,
        });
        expect(item).toBeNull();
    });

    test("deletes the bot\u2019s avatar item", async () => {
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

        await deleteBotIfExists(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId: bot.id,
        });
        expect(item).toBeNull();
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

        await deleteBotIfExists(session.action(), {botId: bot.id});

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

        await deleteBotIfExists(session.action(), {botId: bot.id});

        const item = await BotsTable.getItemIfExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey,
        });
        expect(item).toBeNull();
    });

    test("is idempotent when the bot has already been deleted", async () => {
        const bot = await TestBot.create(context);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        await deleteBotIfExists(session.action(), {botId: bot.id});

        await expect(deleteBotIfExists(session.action(), {botId: bot.id})).resolves.toBeUndefined();
    });
});
