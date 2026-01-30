import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {deletePostReaction} from "~/server/forum/data/delete_post_reaction.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
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

test("updating a reaction preserves the account\u2019s order in the post\u2019s reactions", async () => {
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

test("deleting a reaction then adding a new one changes the account\u2019s order in the post\u2019s reactions", async () => {
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

test("can\u2019t react to post actor doesn\u2019t have access to", async () => {
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
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");

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
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");

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

test("can\u2019t react to post in private channel if actor has view access", async () => {
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
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");

    await expect(
        post.setReaction(session3, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");

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
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");

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

test("can add a reaction to post comment file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        expect(Object.fromEntries(commentData.payload.filesReactions?.get() ?? new Map())).toEqual({
            [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"},
        });
    }
});

test("can add a default reaction to post comment file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(session2, "GenericLike", "Files");

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        expect(Object.fromEntries(commentData.payload.filesReactions?.get() ?? new Map())).toEqual({
            [session2.account.id]: "GenericLike",
        });
    }
});

test("can update a reaction to post comment file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Lolsob",
        },
        "Files",
    );

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        expect(Object.fromEntries(commentData.payload.filesReactions?.get() ?? new Map())).toEqual({
            [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"},
        });
    }
});

test("can update a reaction to post comment file to default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await comment.setReaction(session2, "GenericLike", "Files");

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        expect(Object.fromEntries(commentData.payload.filesReactions?.get() ?? new Map())).toEqual({
            [session2.account.id]: "GenericLike",
        });
    }
});

test("can update a reaction to post comment file from default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(session2, "GenericLike", "Files");

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Lolsob",
        },
        "Files",
    );

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        expect(Object.fromEntries(commentData.payload.filesReactions?.get() ?? new Map())).toEqual({
            [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"},
        });
    }
});

test("multiple accounts can react to post comment file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await comment.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "Yes",
        },
        "Files",
    );

    await comment.setReaction(
        session4,
        {
            character: {type: "Cat", variant: "Yellow"},
            emotion: "Celebrate",
        },
        "Files",
    );

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        const reactions = Object.fromEntries(
            commentData.payload.filesReactions?.get() ?? new Map(),
        );

        // Use Array.from() to make sure we're asserting they're in the right order.
        expect(Array.from(Object.entries(reactions))).toEqual([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
            [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "Yes"}],
            [
                session4.account.id,
                {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"},
            ],
        ]);
    }
});

test("updating a reaction preserves the account\u2019s order in the post comment file\u2019s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await comment.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "Yes",
        },
        "Files",
    );

    await comment.setReaction(
        session4,
        {
            character: {type: "Cat", variant: "Yellow"},
            emotion: "Celebrate",
        },
        "Files",
    );

    await comment.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "No",
        },
        "Files",
    );

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        const reactions = Object.fromEntries(
            commentData.payload.filesReactions?.get() ?? new Map(),
        );

        // Use Array.from() to make sure we're asserting they're in the right order.
        expect(Array.from(Object.entries(reactions))).toEqual([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
            [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
            [
                session4.account.id,
                {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"},
            ],
        ]);
    }
});

test("deleting a reaction then adding a new one changes the account\u2019s order in the post comment file\u2019s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await comment.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "Yes",
        },
        "Files",
    );

    await comment.setReaction(
        session4,
        {
            character: {type: "Cat", variant: "Yellow"},
            emotion: "Celebrate",
        },
        "Files",
    );

    await comment.deleteReaction(session3, "Files");

    let commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        const reactions = Object.fromEntries(
            commentData.payload.filesReactions?.get() ?? new Map(),
        );

        // Use Array.from() to make sure we're asserting they're in the right order.
        expect(Array.from(Object.entries(reactions))).toEqual([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
            [
                session4.account.id,
                {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"},
            ],
        ]);
    }

    await comment.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "No",
        },
        "Files",
    );

    commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        const reactions = Object.fromEntries(
            commentData.payload.filesReactions?.get() ?? new Map(),
        );

        // Use Array.from() to make sure we're asserting they're in the right order.
        expect(Array.from(Object.entries(reactions))).toEqual([
            [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
            [
                session4.account.id,
                {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"},
            ],
            [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
        ]);
    }
});

test("can delete a reaction from post comment file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    const file = await TestFile.create(session1);
    await file.attach(session1, FilePostAuthorizer.bind({type: "PostComments", postId: post.id}));
    const comment = await post.createComment(session1, "Test comment", {
        files: [file],
    });

    await comment.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await comment.deleteReaction(session2, "Files");

    const commentData = await comment.get();
    expect(commentData.payload.type).toBe("Content");

    if (commentData.payload.type === "Content") {
        expect(Object.fromEntries(commentData.payload.filesReactions?.get() ?? new Map())).toEqual(
            {},
        );
    }
});
