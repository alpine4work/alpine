import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {deletePostReaction} from "~/server/forum/data/delete_post_reaction.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    notificationsInjection: {
        archiveInboxPostCommentsEntryAfterSetPostCommentReaction: async () => {},
    },
});

test("can add a reaction to post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    expect((await post.get()).reactions.get()).toEqual(new Map());

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );
});

test("can add a default reaction to post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    expect((await post.get()).reactions.get()).toEqual(new Map());

    await post.setReaction(session2, "GenericLike");

    expect((await post.get()).reactions.get()).toEqual(
        new Map([[session2.account.id, "GenericLike"]]),
    );
});

test("can update a reaction to post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Lolsob",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"}],
        ]),
    );
});

test("can update a reaction to post to default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await post.setReaction(session2, "GenericLike");

    expect((await post.get()).reactions.get()).toEqual(
        new Map([[session2.account.id, "GenericLike"]]),
    );
});

test("can update a reaction to post from default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, "GenericLike");

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Lolsob",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"}],
        ]),
    );
});

test("multiple accounts can react to post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await post.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "Yes",
    });

    await post.setReaction(session4, {
        character: {type: "Cat", variant: "Yellow"},
        emotion: "Celebrate",
    });

    // Use `Array.from()` to make sure we're asserting they're in the right order.
    expect(Array.from((await post.get()).reactions.get())).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "Yes"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);
});

test("updating a reaction preserves the account’s order in the post’s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await post.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "Yes",
    });

    await post.setReaction(session4, {
        character: {type: "Cat", variant: "Yellow"},
        emotion: "Celebrate",
    });

    await post.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "No",
    });

    // Use `Array.from()` to make sure we're asserting they're in the right order.
    expect(Array.from((await post.get()).reactions.get())).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);
});

test("deleting a reaction then adding a new one changes the account’s order in the post’s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await post.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await post.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "Yes",
    });

    await post.setReaction(session4, {
        character: {type: "Cat", variant: "Yellow"},
        emotion: "Celebrate",
    });

    await deletePostReaction(session3.action(), post.id);

    // Use `Array.from()` to make sure we're asserting they're in the right order.
    expect(Array.from((await post.get()).reactions.get())).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);

    await post.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "No",
    });

    // Use `Array.from()` to make sure we're asserting they're in the right order.
    expect(Array.from((await post.get()).reactions.get())).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
    ]);
});

test("can’t react to post actor doesn’t have access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {access: "Private"});
    const post = await channel.createPost(session1);

    expect((await post.get()).reactions.get()).toEqual(new Map());

    await expect(
        post.setReaction(session2, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");

    expect((await post.get()).reactions.get()).toEqual(new Map());
});

test("can react to post in private channel if actor has access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    const post = await channel.createPost(session1);

    await channel.access.grant(session1, session3, "Manage");

    await expect(
        post.setReaction(session2, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");

    await post.setReaction(session3, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session3.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );
});

test("can’t react to post in private channel if actor has view access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    const post = await channel.createPost(session1);

    await channel.access.grant(session1, session3, "View");

    await expect(
        post.setReaction(session2, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");

    await expect(
        post.setReaction(session3, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");

    expect((await post.get()).reactions.get()).toEqual(new Map());
});

test("can react to post in private channel if actor has comment access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    const post = await channel.createPost(session1);

    await channel.access.grant(session1, session3, "Comment");

    await expect(
        post.setReaction(session2, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");

    await post.setReaction(session3, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session3.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );
});

test("can react to own post", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session);

    await post.setReaction(session, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    expect((await post.get()).reactions.get()).toEqual(
        new Map([
            [session.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        ]),
    );
});
