import {validateApiActor} from "~/server/api/internal/tasks/internal/validate_api_actor.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext();

test("allows an omitted API actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    await expect(
        validateApiActor(bot.action(), {
            spaceId: space.id,
            actorId: undefined,
        }),
    ).resolves.toBeUndefined();
});

test("allows an API actor in the current space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const actorSession = await space.createSession();
    const bot = await TestBot.createAndInstantiate(session);

    await expect(
        validateApiActor(bot.action(), {
            spaceId: space.id,
            actorId: actorSession.account.id,
        }),
    ).resolves.toBeUndefined();
});

test("rejects an API actor outside the current space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const otherSession = await otherSpace.createSession();
    const bot = await TestBot.createAndInstantiate(session);

    await expect(
        validateApiActor(bot.action(), {
            spaceId: space.id,
            actorId: otherSession.account.id,
        }),
    ).rejects.toThrow(new PermissionDeniedError("API actor must be a member of the space"));
});
