import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

test("stores bot-created channel creator as an actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);
    const botContext = botAccount.action();

    const channel = await createChannel(botContext, {
        spaceId: space.id,
        creatorId: session.account.id,
        name: "Channel created by bot",
        accessPolicy: await createAccessPolicyForContentCreatedByBot(botContext, space.id, {
            consistency: "StrongWithinCache",
        }),
    });

    const channelItem = await ForumRealtimeTable.getItem(
        space.systemAction(),
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId: channel.id,
        },
        {consistency: "StrongWithinCache"},
    );

    expect(channelItem.creator).toEqual({
        accountId: session.account.id,
        from: {type: "Bot", accountId: botAccount.id},
    });
});
