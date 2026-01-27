import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/instantiate_bot_space_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

test("returns account ID when bot is instantiated in space", async () => {
    const bot = await TestBot.create(context);
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const account = await instantiateBotSpaceAccount(session.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect(await getBotAccountIdForSpaceIfExists(session.action(), bot.id, space.id)).toEqual(
        account.id,
    );
});

test("returns null when bot is not instantiated in space", async () => {
    const bot = await TestBot.create(context);
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    expect(await getBotAccountIdForSpaceIfExists(session.action(), bot.id, space.id)).toEqual(null);
});

test("throws when account doesn’t have access to space", async () => {
    const bot = await TestBot.create(context);
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    await expect(
        getBotAccountIdForSpaceIfExists(otherSession.action(), bot.id, space.id),
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("works with system context", async () => {
    const bot = await TestBot.create(context);
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const account = await instantiateBotSpaceAccount(session.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect(await getBotAccountIdForSpaceIfExists(space.systemAction(), bot.id, space.id)).toEqual(
        account.id,
    );
});
