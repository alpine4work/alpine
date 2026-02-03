import {apiSpacesPaths} from "~/server/api/internal/spaces/api_spaces_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
// eslint-disable-next-line cyberworlds/no-internal-imports
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext({shouldStartOpensearch: true});

const server = createTestApiServer(context, apiSpacesPaths);

test("can read account information", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Test Account", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/accounts/${session.account.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            account: expect.objectContaining({
                id: session.account.id,
                name: "Test Account",
            }),
        }),
    });
});

test("can\u2019t read account information for non-existent account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/accounts/${generateId<AccountId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

test("can read space information", async () => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${space.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            space: expect.objectContaining({
                id: space.id,
                name: "Test Space",
            }),
        }),
    });
});

test("can\u2019t read space information for non-existent space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${generateId<SpaceId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

test("can\u2019t read space information for space bot doesn\u2019t have access to", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${otherSpace.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You don\u2019t have access"),
            }),
        },
    });
});

test("can read account information in specific space", async () => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession({name: "Space Member", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${space.id}/accounts/${session.account.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            account: expect.objectContaining({
                id: session.account.id,
                name: "Space Member",
                space: expect.objectContaining({
                    role: "Admin",
                }),
            }),
        }),
    });
});

test("can\u2019t read account information in non-existent space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${generateId<SpaceId>()}/accounts/${session.account.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You don\u2019t have access"),
            }),
        },
    });
});

test("can\u2019t read non-existent account information in space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/spaces/${space.id}/accounts/${generateId<AccountId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

test("can\u2019t read account information without proper access to space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session1 = await space1.createSession({role: "Admin"});
    const session2 = await space2.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    expect(
        await server.GET(`/spaces/${space2.id}/accounts/${session2.account.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You don\u2019t have access"),
            }),
        },
    });
});

test("can read own bot settings", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: botAccount.bot.id,
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

    await updateBotSpaceSettingsPropertyValue(
        session.action(),
        space.id,
        botAccount.bot.id,
        "apiKey",
        "test-api-key-value",
    );
    await updateBotSpaceSettingsPropertyValue(
        session.action(),
        space.id,
        botAccount.bot.id,
        "publicUrl",
        "https://example.com",
    );

    const apiKey = await botAccount.createApiKey(session);

    expect(
        await server.GET(`/spaces/${space.id}/bots/${botAccount.bot.id}/settings`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            settings: {
                values: {
                    apiKey: "test-api-key-value",
                    publicUrl: "https://example.com",
                },
            },
        },
    });
});

test("can read other bot settings (which hides secrets)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot1Account = await TestBot.createAndInstantiate(session);
    const bot2Account = await TestBot.createAndInstantiate(session);

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: bot1Account.bot.id,
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

    await updateBotSpaceSettingsPropertyValue(
        session.action(),
        space.id,
        bot1Account.bot.id,
        "apiKey",
        "test-api-key-value",
    );
    await updateBotSpaceSettingsPropertyValue(
        session.action(),
        space.id,
        bot1Account.bot.id,
        "publicUrl",
        "https://example.com",
    );

    const apiKey = await bot2Account.createApiKey(session);

    expect(
        await server.GET(`/spaces/${space.id}/bots/${bot1Account.bot.id}/settings`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            settings: {
                values: {
                    publicUrl: "https://example.com",
                },
            },
        },
    });
});

test("can\u2019t read bot settings for space bot doesn\u2019t have access to", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "SettingsSchema",
        botId: botAccount.bot.id,
        description: emptySimpleContent,
        schema: {properties: new Map()},
    });

    const apiKey = await botAccount.createApiKey(session);

    const response = await server.GET(
        `/spaces/${otherSpace.id}/bots/${botAccount.bot.id}/settings`,
        {
            headers: {authorization: `bearer ${apiKey}`},
        },
    );

    expect(response.status).toEqual(403);
    expect(response.body.error.message).toContain("have access");
});
