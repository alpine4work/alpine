import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

const context = createTestContext();

test("stores bot-created post author as an actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);
    const channel = await TestChannel.create(session, {access: "Public"});

    const post = await createPost(botAccount.action(), {
        channelId: channel.id,
        creatorId: session.account.id,
        content: createSimplePostContent("Created on behalf of a human."),
        createdTimeZone: defaultTimeZone,
        consistency: "StrongWithinCache",
    });

    const postItem = await ForumRealtimeTable.getItem(
        space.systemAction(),
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: post.id,
        },
        {consistency: "StrongWithinCache"},
    );

    expect(postItem.author).toEqual({
        accountId: session.account.id,
        from: {type: "Bot", accountId: botAccount.id},
    });
});
