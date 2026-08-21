import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

test("space account hydration omits another account\u2019s personal bot", async () => {
    const space = await TestSpace.create(context);
    const owner = await space.createSession({role: "Member"});
    const otherMember = await space.createSession({role: "Member"});
    const {id: botId} = await createBotForTest(context, {
        name: "Personal Bot",
        webhook: null,
        ownerEntity: {type: "Account", accountId: owner.account.id},
    });
    await installBotInSpace(owner.action(), {spaceId: space.id, botId});

    const accounts = await expensivelyGetAllSpaceAccounts(otherMember.action(), space.id, {
        consistency: "Strong",
    });

    expect(accounts.some(account => account.botId === botId)).toBe(false);
});

test("space account hydration includes a personal bot for its impersonated owner", async () => {
    const space = await TestSpace.create(context);
    const owner = await space.createSession({role: "Member"});
    const {id: botId} = await createBotForTest(context, {
        name: "Personal Bot",
        webhook: null,
        ownerEntity: {type: "Account", accountId: owner.account.id},
    });
    await installBotInSpace(owner.action(), {spaceId: space.id, botId});

    const accounts = await expensivelyGetAllSpaceAccounts(
        context.impersonatedAccountAction(space.id, owner.account.id),
        space.id,
        {consistency: "Strong"},
    );

    expect(accounts.some(account => account.botId === botId)).toBe(true);
});
