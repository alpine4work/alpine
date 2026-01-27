import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {getBotSpaceSettingsValues} from "~/server/bots/with_spaces/get_bot_space_settings_values.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext();

test("returns empty values when no space settings exist", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    // Set up bot settings schema
    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "apiKey",
                    {
                        type: "String",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const settings = await getBotSpaceSettingsValues(adminSession.action(), space.id, bot.id);

    expect(settings.values.size).toEqual(0);
    expect(settings.valuesVersion).toEqual(0);
    expect(settings.schema.properties.size).toEqual(1);
    expect(settings.secretPropertyKeysWithValues.size).toEqual(0);
});

test("returns all values for admin user", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
                [
                    "publicUrl",
                    {
                        type: "String",
                        label: "Public URL",
                        hint: null,
                        placeholder: "",
                        isCode: false,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    // Set values using updateBotSpaceSettingsPropertyValue
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "my-secret-value",
    );
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "publicUrl",
        "https://example.com",
    );

    const settings = await getBotSpaceSettingsValues(adminSession.action(), space.id, bot.id);

    expect(settings.valuesVersion).toEqual(2);
    expect(settings.values.size).toEqual(2);
    expect(settings.values.get("secretKey")).toEqual("my-secret-value");
    expect(settings.values.get("publicUrl")).toEqual("https://example.com");
});

test("hides secret property values from non-admin members", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
                [
                    "publicUrl",
                    {
                        type: "String",
                        label: "Public URL",
                        hint: null,
                        placeholder: "",
                        isCode: false,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    // Admin sets secret and public values
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "my-secret-value",
    );
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "publicUrl",
        "https://example.com",
    );

    // Member fetches settings
    const settings = await getBotSpaceSettingsValues(memberSession.action(), space.id, bot.id);

    expect(settings.valuesVersion).toEqual(2);
    expect(settings.values.size).toEqual(1);

    // Member should NOT see secret value
    expect(settings.values.has("secretKey")).toEqual(false);

    // Member CAN see non-secret value
    expect(settings.values.get("publicUrl")).toEqual("https://example.com");

    // Member CAN see which secrets have values
    expect(settings.secretPropertyKeysWithValues.has("secretKey")).toEqual(true);
});

test("bot can see its own secret settings", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    // Set secret value as admin
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "my-secret-value",
    );

    // Instantiate the bot in the space
    const botAccount = await bot.instantiate(adminSession);

    // Get settings as the bot itself
    const settings = await getBotSpaceSettingsValues(botAccount.action(), space.id, bot.id);

    expect(settings.valuesVersion).toEqual(1);
    expect(settings.values.size).toEqual(1);

    // Bot CAN see its own secret value
    expect(settings.values.get("secretKey")).toEqual("my-secret-value");
});

test("bot cannot see other bot’s secret settings", async () => {
    const botA = await TestBot.create(context, {name: "Bot A"});
    const botB = await TestBot.create(context, {name: "Bot B"});

    // Set up botA with secret
    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: botA.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
            ]),
        },
    });

    // Set up botB with its own schema (needed to instantiate)
    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: botB.id,
        description: emptySimpleContent,
        schema: {properties: new Map()},
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    // Set botA's secret value as admin
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        botA.id,
        "secretKey",
        "botA-secret-value",
    );

    // Instantiate both bots in the space
    await botA.instantiate(adminSession);
    const botBAccount = await botB.instantiate(adminSession);

    // Get botA's settings as botB
    const settings = await getBotSpaceSettingsValues(botBAccount.action(), space.id, botA.id);

    expect(settings.valuesVersion).toEqual(1);
    expect(settings.values.size).toEqual(0);

    // BotB should NOT see botA's secret value
    expect(settings.values.has("secretKey")).toEqual(false);

    // But CAN see which secrets have values
    expect(settings.secretPropertyKeysWithValues.has("secretKey")).toEqual(true);
});

test("members can see which secret properties have values without seeing values", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    // Set secret value as admin
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "my-secret-value",
    );

    // Get settings as member
    const settings = await getBotSpaceSettingsValues(memberSession.action(), space.id, bot.id);

    // secretPropertyKeysWithValues includes the key
    expect(settings.secretPropertyKeysWithValues.has("secretKey")).toEqual(true);

    // But values does NOT include the secret
    expect(settings.values.has("secretKey")).toEqual(false);
});

test("members can see which secret properties have values (excluding empty strings) without seeing values", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    // Set secret value as admin
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "my-secret-value",
    );

    // Set secret value as admin again
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "",
    );

    // Get settings as member
    const settings = await getBotSpaceSettingsValues(memberSession.action(), space.id, bot.id);

    // secretPropertyKeysWithValues doesn’t include the key
    expect(settings.secretPropertyKeysWithValues.has("secretKey")).toEqual(false);

    // But values does NOT include the secret
    expect(settings.values.has("secretKey")).toEqual(false);
});

test("throws PermissionDeniedError for non-members", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {properties: new Map()},
    });

    const spaceA = await TestSpace.create(context);
    const spaceB = await TestSpace.create(context);

    const sessionInSpaceA = await spaceA.createSession({role: "Member"});

    // Try to get bot settings for spaceB from a session in spaceA
    await expect(
        getBotSpaceSettingsValues(sessionInSpaceA.action(), spaceB.id, bot.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("returns non-secret values for members correctly", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "secretKey",
                    {
                        type: "String",
                        label: "Secret Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
                [
                    "publicUrl",
                    {
                        type: "String",
                        label: "Public URL",
                        hint: null,
                        placeholder: "",
                        isCode: false,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    // Set both values as admin
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "secretKey",
        "my-secret-value",
    );
    await updateBotSpaceSettingsPropertyValue(
        adminSession.action(),
        space.id,
        bot.id,
        "publicUrl",
        "https://example.com",
    );

    // Get as member
    const settings = await getBotSpaceSettingsValues(memberSession.action(), space.id, bot.id);

    // Non-secret is correctly returned
    expect(settings.values.get("publicUrl")).toEqual("https://example.com");
    expect(settings.values.size).toEqual(1);
});
