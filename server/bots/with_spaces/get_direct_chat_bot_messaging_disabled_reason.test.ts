import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {getDirectChatBotMessagingDisabledReason} from "~/server/bots/with_spaces/get_direct_chat_bot_messaging_disabled_reason.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

const webhookUrl = "https://bot.test.cyberworlds.dev/webhook";

function directChatWithBot(spaceId: SpaceId, actorAccountId: AccountId, botId: BotId): ChatModel {
    return {
        spaceId,
        definition: {
            type: "Direct",
            accounts: [{id: actorAccountId}, {id: generateId<AccountId>(), botId}],
        },
    } as unknown as ChatModel;
}

describe("getDirectChatBotMessagingDisabledReason()", () => {
    test("links to the bot settings for a manageable custom bot with no webhook", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const {id: botId} = await createBotForTest(context, {
            name: "Test Bot",
            webhook: null,
            ownerEntity: {type: "Account", accountId: session.account.id},
        });

        await expect(
            getDirectChatBotMessagingDisabledReason(
                session.action(),
                directChatWithBot(space.id, session.account.id, botId),
            ),
        ).resolves.toMatchObject({
            link: {url: `/settings/${space.id}/bots/${botId}`},
        });
    });

    test("returns null for a custom bot that already has a webhook", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const {id: botId} = await createBotForTest(context, {
            name: "Test Bot",
            webhook: {url: webhookUrl, secret: null},
            ownerEntity: {type: "Account", accountId: session.account.id},
        });

        await expect(
            getDirectChatBotMessagingDisabledReason(
                session.action(),
                directChatWithBot(space.id, session.account.id, botId),
            ),
        ).resolves.toBeNull();
    });

    test("disables messaging without a link for a personal bot owned by someone else", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const {id: botId} = await createBotForTest(context, {
            name: "Test Bot",
            webhook: null,
            ownerEntity: {type: "Account", accountId: generateId<AccountId>()},
        });

        await expect(
            getDirectChatBotMessagingDisabledReason(
                session.action(),
                directChatWithBot(space.id, session.account.id, botId),
            ),
        ).resolves.toMatchObject({link: null});
    });
});
