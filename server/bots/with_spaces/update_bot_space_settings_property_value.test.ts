import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";

const context = createTestContext();

test("creates space settings item when none exists", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    const result = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "my-api-key",
    });

    expect(result.values.get("apiKey")).toEqual("my-api-key");
    expect(result.valuesVersion).toEqual(1);
    expect(result.values.size).toEqual(1);
});

test("updates existing property value", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    // Set initial value
    await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "initial-value",
    });

    // Update to new value
    const result = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "updated-value",
    });

    expect(result.values.get("apiKey")).toEqual("updated-value");
    expect(result.valuesVersion).toEqual(2);
    expect(result.values.size).toEqual(1);
});

test("throws PermissionDeniedError when non-admin calls", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    await expect(
        updateBotSpaceSettingsPropertyValue(memberSession.action(), {
            spaceId: space.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: "my-value",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("throws FailedPreconditionError when bot is not installed in the space", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await expect(
        updateBotSpaceSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: "my-api-key",
        }),
    ).rejects.toThrow("Bot is not installed in the space");
});

test("throws FailedPreconditionError for undefined property", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "validProperty",
                    {
                        type: "String",
                        level: "Space",
                        label: "Valid",
                        hint: null,
                        placeholder: "...",
                        isCode: false,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            botId: bot.id,
            propertyKey: "invalidProperty",
            propertyValue: "some-value",
        }),
    ).rejects.toThrow("Property not found in bot settings schema");
});

test("throws FailedPreconditionError for account-level property", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "accountApiKey",
                    {
                        type: "String",
                        level: "SpaceAccount",
                        label: "Account API Key",
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

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            botId: bot.id,
            propertyKey: "accountApiKey",
            propertyValue: "account-key",
        }),
    ).rejects.toThrow("Property is not a space-level bot setting");
});

test("throws FailedPreconditionError for non-string value", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: 123,
        }),
    ).rejects.toThrow("Property value must be a string according to bot settings schema");
});

test("correctly calculates secretPropertyKeysWithValues after update", async () => {
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
                        level: "Space",
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

    await bot.instantiate(adminSession);

    // Set non-empty secret value
    const resultWithValue = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "secretKey",
        propertyValue: "my-secret-value",
    });

    expect(resultWithValue.secretPropertyKeysWithValues.has("secretKey")).toEqual(true);

    // Set empty string value (treated as not configured)
    const resultWithEmpty = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "secretKey",
        propertyValue: "",
    });

    expect(resultWithEmpty.secretPropertyKeysWithValues.has("secretKey")).toEqual(false);
});

test("valuesVersion is 1 after first update", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    const result = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "my-value",
    });

    expect(result.valuesVersion).toEqual(1);
});

test("valuesVersion increments on subsequent updates", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

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
                        level: "Space",
                        label: "API Key",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    // First update
    const result1 = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "value-1",
    });
    expect(result1.valuesVersion).toEqual(1);

    // Second update
    const result2 = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "value-2",
    });
    expect(result2.valuesVersion).toEqual(2);

    // Third update
    const result3 = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "value-3",
    });
    expect(result3.valuesVersion).toEqual(3);
});

test("returns all updated values in response", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "property1",
                    {
                        type: "String",
                        level: "Space",
                        label: "Property 1",
                        hint: null,
                        placeholder: "...",
                        isCode: false,
                        isSecret: false,
                    },
                ],
                [
                    "property2",
                    {
                        type: "String",
                        level: "Space",
                        label: "Property 2",
                        hint: null,
                        placeholder: "...",
                        isCode: false,
                        isSecret: false,
                    },
                ],
                [
                    "property3",
                    {
                        type: "String",
                        level: "Space",
                        label: "Property 3",
                        hint: null,
                        placeholder: "...",
                        isCode: false,
                        isSecret: false,
                    },
                ],
            ]),
        },
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    // Update first property
    const result1 = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "property1",
        propertyValue: "value1",
    });
    expect(result1.values.size).toEqual(1);
    expect(result1.values.get("property1")).toEqual("value1");

    // Update second property
    const result2 = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "property2",
        propertyValue: "value2",
    });
    expect(result2.values.size).toEqual(2);
    expect(result2.values.get("property1")).toEqual("value1");
    expect(result2.values.get("property2")).toEqual("value2");

    // Update third property
    const result3 = await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "property3",
        propertyValue: "value3",
    });
    expect(result3.values.size).toEqual(3);
    expect(result3.values.get("property1")).toEqual("value1");
    expect(result3.values.get("property2")).toEqual("value2");
    expect(result3.values.get("property3")).toEqual("value3");
});
