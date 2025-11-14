import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {deletePostReaction} from "~/server/forum/data/delete_post_reaction.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    notificationsInjection: {
        archiveInboxPostCommentsEntryAfterSetPostCommentReaction: async () => {},
    },
});

test("can remove a reaction from a post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );

    await deletePostReaction(session2.action(), post.id);

    expect((await post.get()).reactions.get()).toEqual(new Map());
});

test("can’t remove a reaction from a post actor has lost access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );

    await channel.access.revokeDefault(session1);

    await expect(deletePostReaction(session2.action(), post.id)).rejects.toThrow(
        "Actor doesn’t have `Comment` access level",
    );

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );
});

test("can remove a reaction from a post where actor only has comment access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {access: "Private"});
    const post = await channel.createPost(session1);

    await channel.access.grant(session1, session2, "Comment");

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );

    await deletePostReaction(session2.action(), post.id);

    expect((await post.get()).reactions.get()).toEqual(new Map());
});

test("can’t remove a reaction from a post where actor has been downgraded to view access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {access: "Private"});
    const post = await channel.createPost(session1);

    await channel.access.grant(session1, session2, "Comment");

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );

    await channel.access.grant(session1, session2, "View");

    await expect(deletePostReaction(session2.action(), post.id)).rejects.toThrow(
        "Actor doesn’t have `Comment` access level",
    );

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );
});
