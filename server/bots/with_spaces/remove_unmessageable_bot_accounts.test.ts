import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {removeUnmessageableBotAccounts} from "~/server/bots/with_spaces/remove_unmessageable_bot_accounts.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

test("a dangling account for a deleted bot is not messageable", async () => {
    const session = await (await TestSpace.create(context)).createSession();

    await expect(
        removeUnmessageableBotAccounts(session.action(), [{botId: generateId<BotId>()}]),
    ).resolves.toEqual([]);
});

test("a non-bot account is messageable", async () => {
    const session = await (await TestSpace.create(context)).createSession();
    const account = {botId: undefined};

    await expect(removeUnmessageableBotAccounts(session.action(), [account])).resolves.toEqual([
        account,
    ]);
});

test("a custom bot without a webhook is not messageable", async () => {
    const session = await (await TestSpace.create(context)).createSession();
    const {id: botId} = await createBotForTest(context, {
        name: "Test Bot",
        webhook: null,
        ownerEntity: {type: "Account", accountId: session.account.id},
    });

    await expect(removeUnmessageableBotAccounts(session.action(), [{botId}])).resolves.toEqual([]);
});

test("a custom bot with a webhook is messageable", async () => {
    const session = await (await TestSpace.create(context)).createSession();
    const {id: botId} = await createBotForTest(context, {
        name: "Test Bot",
        webhook: {url: "https://bot.test.cyberworlds.dev/webhook", secret: null},
        ownerEntity: {type: "Account", accountId: session.account.id},
    });
    const account = {botId};

    await expect(removeUnmessageableBotAccounts(session.action(), [account])).resolves.toEqual([
        account,
    ]);
});
