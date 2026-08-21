import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {removeAllSpaceAccountsForBot} from "~/server/spaces/remove_all_space_accounts_for_bot.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

async function createAndInstantiateBot(space: TestSpace) {
    const session = await space.createSession({role: "Owner"});
    const {id: botId} = await createBotForTest(context, {
        name: "Test Bot",
        webhook: {url: "https://bot.test.cyberworlds.dev/webhook", secret: null},
        ownerEntity: {type: "Space", spaceId: space.id},
    });
    const account = await installBotInSpace(session.action(), {spaceId: space.id, botId});
    return {botId, accountId: account.id};
}

test("removes the space account for an instantiated bot", async () => {
    const space = await TestSpace.create(context);
    const {botId, accountId} = await createAndInstantiateBot(space);

    await removeAllSpaceAccountsForBot(space.systemAction(), botId);

    const spaceAccountItem = await getSpaceAccountItemIfExists(
        space.systemAction(),
        space.id,
        accountId,
        {consistency: "Strong"},
    );
    expect(spaceAccountItem?.state.type).toEqual("Removed");
});

test("is idempotent when the space account was already removed", async () => {
    const space = await TestSpace.create(context);
    const {botId} = await createAndInstantiateBot(space);

    await removeAllSpaceAccountsForBot(space.systemAction(), botId);

    // A second run (e.g. a job retry) should not throw now that the account is
    // removed.
    await expect(
        removeAllSpaceAccountsForBot(space.systemAction(), botId),
    ).resolves.toBeUndefined();
});
