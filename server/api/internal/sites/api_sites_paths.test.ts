import {apiSitesPaths} from "~/server/api/internal/sites/api_sites_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";

const context = createTestContext({});

const server = createTestApiServer(context, apiSitesPaths);

describe("/sites/{id}/reference", () => {
    test("can read site reference", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const site = await TestSite.create(session, {
            name: "Test Site Name",
            access: "Public",
        });

        expect(
            await server.GET(`/sites/${site.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Site",
                    id: site.id,
                    title: "Test Site Name",
                },
            },
        });
    });

    test("can\u2019t read site reference without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const site = await TestSite.create(session2, {access: "Private"});

        expect(
            await server.GET(`/sites/${site.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("You aren\u2019t allowed to access this site."),
                }),
            },
        });
    });

    test("can\u2019t read site reference for non-existent site", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.GET(`/sites/${generateId<SiteId>()}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This site doesn\u2019t exist"),
                }),
            },
        });
    });
});
