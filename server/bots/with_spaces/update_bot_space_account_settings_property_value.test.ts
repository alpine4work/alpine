import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {updateBotSpaceAccountSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_account_settings_property_value.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";

const context = createTestContext();

function createAccountSettingsProperty({
    label = "API Key",
    isSecret = true,
}: {
    label?: string;
    isSecret?: boolean;
} = {}) {
    return {
        type: "String",
        level: "SpaceAccount",
        label,
        hint: null,
        placeholder: "",
        isCode: true,
        isSecret,
    } as const;
}

function createSpaceSettingsProperty({label = "Space Key"}: {label?: string} = {}) {
    return {
        type: "String",
        level: "Space",
        label,
        hint: null,
        placeholder: "",
        isCode: true,
        isSecret: false,
    } as const;
}

async function createBotWithSchema(properties: Map<string, any>) {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties,
        },
    });

    return bot;
}

test("allows an admin to update their own account settings", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    const result = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "admin-api-key",
    });

    expect(result.values).toEqual(new Map([["apiKey", "admin-api-key"]]));
    expect(result.valuesVersion).toEqual(1);
});

test("allows a member to update their own account settings", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    await bot.instantiate(adminSession);

    const result = await updateBotSpaceAccountSettingsPropertyValue(memberSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "member-api-key",
    });

    expect(result.values).toEqual(new Map([["apiKey", "member-api-key"]]));
});

test("throws PermissionDeniedError when a member updates another account\u2019s settings", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});
    const otherSession = await space.createSession({role: "Member"});

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(memberSession.action(), {
            spaceId: space.id,
            accountId: otherSession.account.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: "other-api-key",
        }),
    ).rejects.toThrow("Can\u2019t access account that\u2019s not the actor\u2019s");
});

test("throws PermissionDeniedError when an admin updates another account\u2019s settings", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);
    const memberSession = await space.createSession({role: "Member"});

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: "other-api-key",
        }),
    ).rejects.toThrow("Can\u2019t access account that\u2019s not the actor\u2019s");
});

test("throws PermissionDeniedError when a bot updates account settings", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await bot.instantiate(session);

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(botAccount.action(), {
            spaceId: space.id,
            accountId: botAccount.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: "bot-api-key",
        }),
    ).rejects.toThrow("Bot accounts don\u2019t have space account settings");
});

test("throws FailedPreconditionError when bot is not installed in the space", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: "admin-api-key",
        }),
    ).rejects.toThrow("Bot is not installed in the space");
});

test("throws FailedPreconditionError for undefined property", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            botId: bot.id,
            propertyKey: "unknownProperty",
            propertyValue: "value",
        }),
    ).rejects.toThrow("Property not found in bot settings schema");
});

test("throws FailedPreconditionError for space-level property", async () => {
    const bot = await createBotWithSchema(new Map([["spaceKey", createSpaceSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            botId: bot.id,
            propertyKey: "spaceKey",
            propertyValue: "space-value",
        }),
    ).rejects.toThrow("Property is not an account-level bot setting");
});

test("throws FailedPreconditionError for non-string value", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await expect(
        updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            botId: bot.id,
            propertyKey: "apiKey",
            propertyValue: 123,
        }),
    ).rejects.toThrow("Property value must be a string according to bot settings schema");
});

test("creates account settings item when none exists", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    const result = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "initial-key",
    });

    expect(result.values).toEqual(new Map([["apiKey", "initial-key"]]));
    expect(result.valuesVersion).toEqual(1);
});

test("updates existing property value", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "initial-key",
    });

    const result = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "updated-key",
    });

    expect(result.values).toEqual(new Map([["apiKey", "updated-key"]]));
    expect(result.valuesVersion).toEqual(2);
});

test("valuesVersion increments on subsequent updates", async () => {
    const bot = await createBotWithSchema(new Map([["apiKey", createAccountSettingsProperty()]]));
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    const result1 = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "value-1",
    });
    expect(result1.valuesVersion).toEqual(1);

    const result2 = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "value-2",
    });
    expect(result2.valuesVersion).toEqual(2);

    const result3 = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "apiKey",
        propertyValue: "value-3",
    });
    expect(result3.valuesVersion).toEqual(3);
});

test("returns all updated values in response", async () => {
    const bot = await createBotWithSchema(
        new Map([
            ["property1", createAccountSettingsProperty({label: "Property 1"})],
            ["property2", createAccountSettingsProperty({label: "Property 2"})],
            ["property3", createAccountSettingsProperty({label: "Property 3"})],
        ]),
    );
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    const result1 = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "property1",
        propertyValue: "value1",
    });
    expect(result1.values).toEqual(new Map([["property1", "value1"]]));

    const result2 = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "property2",
        propertyValue: "value2",
    });
    expect(result2.values).toEqual(
        new Map([
            ["property1", "value1"],
            ["property2", "value2"],
        ]),
    );

    const result3 = await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "property3",
        propertyValue: "value3",
    });
    expect(result3.values).toEqual(
        new Map([
            ["property1", "value1"],
            ["property2", "value2"],
            ["property3", "value3"],
        ]),
    );
});
