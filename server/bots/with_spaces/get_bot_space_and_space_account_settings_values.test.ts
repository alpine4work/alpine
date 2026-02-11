import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {getBotSpaceAndSpaceAccountSettingsValues} from "~/server/bots/with_spaces/get_bot_space_and_space_account_settings_values.js";
import {updateBotSpaceAccountSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_account_settings_property_value.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";

const context = createTestContext();

async function createBotWithSettings() {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot.id,
        description: emptySimpleContent,
        schema: {
            properties: new Map([
                [
                    "spaceSecret",
                    {
                        type: "String",
                        level: "Space",
                        label: "Space Secret",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
                [
                    "spacePublic",
                    {
                        type: "String",
                        level: "Space",
                        label: "Space Public",
                        hint: null,
                        placeholder: "",
                        isCode: false,
                        isSecret: false,
                    },
                ],
                [
                    "accountSecret",
                    {
                        type: "String",
                        level: "SpaceAccount",
                        label: "Account Secret",
                        hint: null,
                        placeholder: "",
                        isCode: true,
                        isSecret: true,
                    },
                ],
            ]),
        },
    });

    return bot;
}

test("returns space and account settings for an admin account", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await bot.instantiate(adminSession);

    await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "spaceSecret",
        propertyValue: "space-secret",
    });
    await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "spacePublic",
        propertyValue: "space-public",
    });
    await updateBotSpaceAccountSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        botId: bot.id,
        propertyKey: "accountSecret",
        propertyValue: "account-secret",
    });

    const settings = await getBotSpaceAndSpaceAccountSettingsValues(
        adminSession.action(),
        space.id,
        adminSession.account.id,
        bot.id,
    );

    expect(settings.spaceValues).toEqual(
        new Map([
            ["spaceSecret", "space-secret"],
            ["spacePublic", "space-public"],
        ]),
    );
    expect(settings.spaceSecretPropertyKeysWithValues).toEqual(new Set(["spaceSecret"]));
    expect(settings.accountValues).toEqual(new Map([["accountSecret", "account-secret"]]));
});

test("filters space secrets for members but returns account settings", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    await bot.instantiate(adminSession);

    await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "spaceSecret",
        propertyValue: "space-secret",
    });
    await updateBotSpaceSettingsPropertyValue(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
        propertyKey: "spacePublic",
        propertyValue: "space-public",
    });
    await updateBotSpaceAccountSettingsPropertyValue(memberSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
        botId: bot.id,
        propertyKey: "accountSecret",
        propertyValue: "account-secret",
    });

    const settings = await getBotSpaceAndSpaceAccountSettingsValues(
        memberSession.action(),
        space.id,
        memberSession.account.id,
        bot.id,
    );

    expect(settings.spaceValues).toEqual(new Map([["spacePublic", "space-public"]]));
    expect(settings.spaceSecretPropertyKeysWithValues).toEqual(new Set(["spaceSecret"]));
    expect(settings.accountValues).toEqual(new Map([["accountSecret", "account-secret"]]));
});

test("throws PermissionDeniedError when accessing another account\u2019s settings", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});
    const otherSession = await space.createSession({role: "Member"});

    await bot.instantiate(adminSession);

    await updateBotSpaceAccountSettingsPropertyValue(otherSession.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
        botId: bot.id,
        propertyKey: "accountSecret",
        propertyValue: "other-secret",
    });

    await expect(
        getBotSpaceAndSpaceAccountSettingsValues(
            memberSession.action(),
            space.id,
            otherSession.account.id,
            bot.id,
        ),
    ).rejects.toThrow("Can\u2019t access account that\u2019s not the actor\u2019s");
});

test("throws PermissionDeniedError when an admin accesses another account\u2019s settings", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    await bot.instantiate(adminSession);

    await updateBotSpaceAccountSettingsPropertyValue(memberSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
        botId: bot.id,
        propertyKey: "accountSecret",
        propertyValue: "member-secret",
    });

    await expect(
        getBotSpaceAndSpaceAccountSettingsValues(
            adminSession.action(),
            space.id,
            memberSession.account.id,
            bot.id,
        ),
    ).rejects.toThrow("Can\u2019t access account that\u2019s not the actor\u2019s");
});

test("throws PermissionDeniedError when account is outside the space", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const otherSession = await otherSpace.createSession({role: "Member"});

    const botAccount = await bot.instantiate(adminSession);

    await expect(
        getBotSpaceAndSpaceAccountSettingsValues(
            botAccount.action(),
            space.id,
            otherSession.account.id,
            bot.id,
        ),
    ).rejects.toThrow("Account is not a member of the space");
});

test("allows a bot to access another account\u2019s settings", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});
    const otherSession = await space.createSession({role: "Member"});

    const botAccount = await bot.instantiate(adminSession);

    await updateBotSpaceAccountSettingsPropertyValue(otherSession.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
        botId: bot.id,
        propertyKey: "accountSecret",
        propertyValue: "account-secret",
    });

    const settings = await getBotSpaceAndSpaceAccountSettingsValues(
        botAccount.action(memberSession),
        space.id,
        otherSession.account.id,
        bot.id,
    );

    expect(settings.accountValues).toEqual(new Map([["accountSecret", "account-secret"]]));
});

test("allows a bot to access any account\u2019s settings with space scope", async () => {
    const bot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const otherSession = await space.createSession({role: "Member"});

    const botAccount = await bot.instantiate(adminSession);

    await updateBotSpaceAccountSettingsPropertyValue(otherSession.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
        botId: bot.id,
        propertyKey: "accountSecret",
        propertyValue: "account-secret",
    });

    const settings = await getBotSpaceAndSpaceAccountSettingsValues(
        botAccount.action({type: "Space"}),
        space.id,
        otherSession.account.id,
        bot.id,
    );

    expect(settings.accountValues).toEqual(new Map([["accountSecret", "account-secret"]]));
});

test("throws PermissionDeniedError when a bot accesses another bot\u2019s settings", async () => {
    const bot = await createBotWithSettings();
    const otherBot = await createBotWithSettings();
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    const botAccount = await bot.instantiate(adminSession);

    await expect(
        getBotSpaceAndSpaceAccountSettingsValues(
            botAccount.action(),
            space.id,
            memberSession.account.id,
            otherBot.id,
        ),
    ).rejects.toThrow("Bot can only access account settings for its own bot");
});
