import {addMinutes} from "date-fns";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {attachFileAsUploader, getFileFromAttachment} from "~/server/files/data/files_table.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {
    FilePostAuthorizer,
    addAccountGrantsToChannelAccessPolicy,
    authorizeChannelAccess,
    authorizeChannelAccessIfPossible,
    authorizePostAccess,
    authorizePostAccessIfPossible,
    authorizePostDraftAccess,
    backfillChannelAndMetadata,
    backfillChannelPosts,
    createChannel,
    createOrReplacePostDraft,
    createPost,
    deletePostComment,
    getChannel,
    getChannelAndMetadata,
    getChannelContributors,
    getChannelContributorsKey,
    getChannelIfPossible,
    getChannelNameAndDescriptionContentAndContributors,
    getChannelNotificationSubscribers,
    getChannelPosts,
    getChannelPreview,
    getPost,
    getPostAndInitialComments,
    getPostAuthorAndChannelPreviewIfPossible,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    getPostContentAndChannelPreview,
    getPostDraftIfExists,
    getPostIfPossible,
    getPostNotificationSubscribers,
    isSubscribedToChannel,
    sendChannelShareNotification,
    subscribeToChannel,
    unsubscribeFromChannel,
    updateChannelAccessPolicy,
    updateChannelDescription,
    updateChannelName,
    updateChannelNameAndDescription,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_table.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {addSpaceAccount} from "~/server/spaces/add_account/add_space_account.js";
import {getOurAccountSpaceIds} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelPostFilesModel,
} from "~/shared/forum/channel_model.js";
import {
    PostContentProsemirrorSchema,
    PostContentWithReferences,
    assertPostContent,
    createSimplePostContent,
} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, PostDraftId, PostId} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
    emptyMessageContent,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";

const context = createTestContext();

const testContent1 = createSimplePostContent("test1");
const testContent2 = createSimplePostContent("test2");
const testContent3 = createSimplePostContent("test3");

const testContent1WithReferences: PostContentWithReferences = {
    doc: testContent1,
    references: emptyContentReferences,
};
const testContent2WithReferences: PostContentWithReferences = {
    doc: testContent2,
    references: emptyContentReferences,
};
const testContent3WithReferences: PostContentWithReferences = {
    doc: testContent3,
    references: emptyContentReferences,
};

const testMessageContent1 = createSimpleMessageContent("test1");
const testMessageContent2 = createSimpleMessageContent("test2");

test("can’t create a channel for a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        createChannel(session.action(), {
            spaceId: otherSpace.id,
            name: "Test",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can’t create a channel if the actor doesn’t have manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    await expect(
        createChannel(session1.action(), {
            spaceId: space.id,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([
                    [session2.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ).rejects.toThrow("Account actor must have `Manage` access level on channels they create");

    await createChannel(session1.action(), {
        spaceId: space.id,
        name: "Test",
        accessPolicy: {
            accountGrantById: new Map([[session2.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });
});

test("can’t create a channel with URL grant", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    await expect(
        createChannel(session1.action(), {
            spaceId: space.id,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([
                    [session2.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: {level: "View"},
            },
        }),
    ).rejects.toThrow("Channels don’t currently support `urlGrant`s");

    await createChannel(session1.action(), {
        spaceId: space.id,
        name: "Test",
        accessPolicy: {
            accountGrantById: new Map([[session2.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });
});

test("can create a channel", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test 1",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");
    expect((await getChannel(session.action(), channel.id)).model.description.doc.toJSON()).toEqual(
        emptyMessageContent.toJSON(),
    );
});

test("can create a channel with a description", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test 2",
        description: "This is a description",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 2");
    expect((await getChannel(session.action(), channel.id)).model.description.doc.toJSON()).toEqual(
        createSimpleMessageContent("This is a description").toJSON(),
    );
});

test("can’t get a channel that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const badChannelId = generateId<ChannelId>();

    await expect(getChannel(session.action(), badChannelId)).rejects.toThrow(NotFoundError);
    await expect(getChannelIfPossible(session.action(), badChannelId)).resolves.toEqual(null);
    await expect(
        getChannelNameAndDescriptionContentAndContributors(session.action(), badChannelId),
    ).rejects.toThrow(NotFoundError);
    await expect(
        getChannelAndMetadata(session.action(), {channelId: badChannelId, postFilesLimit: 100}),
    ).rejects.toThrow(NotFoundError);
    await expect(
        getChannelAndMetadata(session.action(), {
            channelId: badChannelId,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(badChannelId),
        }),
    ).rejects.toThrow(NotFoundError);
    await expect(
        getChannelContributors(session.action(), badChannelId, {limit: 100}),
    ).rejects.toThrow(NotFoundError);
    await expect(
        backfillChannelAndMetadata(session.action(), {
            channelId: badChannelId,
            readTime: new Date(),
        }),
    ).rejects.toThrow(NotFoundError);
    await expect(authorizeChannelAccess(session.action(), badChannelId, "View")).rejects.toThrow(
        NotFoundError,
    );
    await expect(
        authorizeChannelAccessIfPossible(session.action(), badChannelId, "View"),
    ).rejects.toThrow(NotFoundError);
});

test("can’t get a channel for a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session);

    await expect(getChannel(otherSession.action(), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getChannelNameAndDescriptionContentAndContributors(otherSession.action(), channel.id),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(getChannelIfPossible(otherSession.action(), channel.id)).resolves.toEqual(
        expect.objectContaining({ok: false, error: expect.any(PermissionDeniedError)}),
    );
    await expect(
        getChannelAndMetadata(otherSession.action(), {channelId: channel.id, postFilesLimit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getChannelAndMetadata(otherSession.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(channel.id),
        }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getChannelContributors(otherSession.action(), channel.id, {limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        backfillChannelAndMetadata(otherSession.action(), {
            channelId: channel.id,
            readTime: new Date(),
        }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(authorizeChannelAccess(otherSession.action(), channel.id, "View")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect(
        (await authorizeChannelAccessIfPossible(otherSession.action(), channel.id, "View")).ok,
    ).toBe(false);
});

test("can’t get a private channel", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);

    await expect(getChannel(session3.action(), channel.id)).resolves.toBeTruthy();
    await expect(getChannelIfPossible(session3.action(), channel.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );
    await expect(
        getChannelNameAndDescriptionContentAndContributors(session3.action(), channel.id),
    ).resolves.toBeTruthy();
    await expect(
        getChannelAndMetadata(session3.action(), {channelId: channel.id, postFilesLimit: 100}),
    ).resolves.toBeTruthy();
    await expect(
        getChannelAndMetadata(session3.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(channel.id),
        }),
    ).resolves.toBeTruthy();
    await expect(
        getChannelContributors(session3.action(), channel.id, {limit: 100}),
    ).resolves.toBeTruthy();
    await expect(
        backfillChannelAndMetadata(session3.action(), {
            channelId: channel.id,
            readTime: new Date(),
        }),
    ).resolves.toBeTruthy();
    await expect(
        authorizeChannelAccess(session3.action(), channel.id, "View"),
    ).resolves.toBeTruthy();
    expect((await authorizeChannelAccessIfPossible(session3.action(), channel.id, "View")).ok).toBe(
        true,
    );

    await channel.access.revokeDefault(session1);
    await channel.access.grant(session1, session2);

    await expect(getChannel(session1.action(), channel.id)).resolves.toBeTruthy();
    await expect(getChannelIfPossible(session1.action(), channel.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );
    await expect(
        getChannelNameAndDescriptionContentAndContributors(session1.action(), channel.id),
    ).resolves.toBeTruthy();
    await expect(
        getChannelAndMetadata(session1.action(), {channelId: channel.id, postFilesLimit: 100}),
    ).resolves.toBeTruthy();
    await expect(
        getChannelAndMetadata(session1.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(channel.id),
        }),
    ).resolves.toBeTruthy();
    await expect(
        getChannelContributors(session1.action(), channel.id, {limit: 100}),
    ).resolves.toBeTruthy();
    await expect(
        backfillChannelAndMetadata(session1.action(), {
            channelId: channel.id,
            readTime: new Date(),
        }),
    ).resolves.toBeTruthy();
    await expect(
        authorizeChannelAccess(session1.action(), channel.id, "View"),
    ).resolves.toBeTruthy();
    expect((await authorizeChannelAccessIfPossible(session1.action(), channel.id, "View")).ok).toBe(
        true,
    );

    await expect(getChannel(session2.action(), channel.id)).resolves.toBeTruthy();
    await expect(getChannelIfPossible(session2.action(), channel.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );
    await expect(
        getChannelNameAndDescriptionContentAndContributors(session2.action(), channel.id),
    ).resolves.toBeTruthy();
    await expect(
        getChannelAndMetadata(session2.action(), {channelId: channel.id, postFilesLimit: 100}),
    ).resolves.toBeTruthy();
    await expect(
        getChannelAndMetadata(session2.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(channel.id),
        }),
    ).resolves.toBeTruthy();
    await expect(
        getChannelContributors(session2.action(), channel.id, {limit: 100}),
    ).resolves.toBeTruthy();
    await expect(
        backfillChannelAndMetadata(session2.action(), {
            channelId: channel.id,
            readTime: new Date(),
        }),
    ).resolves.toBeTruthy();
    await expect(
        authorizeChannelAccess(session2.action(), channel.id, "View"),
    ).resolves.toBeTruthy();
    expect((await authorizeChannelAccessIfPossible(session2.action(), channel.id, "View")).ok).toBe(
        true,
    );

    await expect(getChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    await expect(getChannelIfPossible(session3.action(), channel.id)).resolves.toEqual(
        expect.objectContaining({
            ok: false,
            error: expect.objectContaining({
                message: "Actor doesn’t have `View` access level to channel",
            }),
        }),
    );
    await expect(
        getChannelNameAndDescriptionContentAndContributors(session3.action(), channel.id),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
    await expect(
        getChannelAndMetadata(session3.action(), {channelId: channel.id, postFilesLimit: 100}),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
    await expect(
        getChannelAndMetadata(session3.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(channel.id),
        }),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
    await expect(
        getChannelContributors(session3.action(), channel.id, {limit: 100}),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
    await expect(
        backfillChannelAndMetadata(session3.action(), {
            channelId: channel.id,
            readTime: new Date(),
        }),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
    await expect(authorizeChannelAccess(session3.action(), channel.id, "View")).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    expect((await authorizeChannelAccessIfPossible(session3.action(), channel.id, "View")).ok).toBe(
        false,
    );
});

test("can get a channel", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test");
    expect((await getChannelIfPossible(session.action(), channel.id))?.value?.model.name).toEqual(
        "Test",
    );
    expect(
        (await getChannelNameAndDescriptionContentAndContributors(session.action(), channel.id))
            .name,
    ).toEqual("Test");
    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }).then(result => (result.items[0]?.model as any).name),
    ).toEqual("Test");
    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: getChannelContributorsKey(channel.id),
        }),
    ).not.toBeNull();
    expect(await getChannelContributors(session.action(), channel.id, {limit: 100})).not.toBeNull();
    await expect(
        backfillChannelAndMetadata(session.action(), {
            channelId: channel.id,
            readTime: new Date(),
        }),
    ).resolves.toBeTruthy();
    await expect(
        authorizeChannelAccess(session.action(), channel.id, "View"),
    ).resolves.toBeTruthy();
    expect((await authorizeChannelAccessIfPossible(session.action(), channel.id, "View")).ok).toBe(
        true,
    );
});

test("can update a channel’s name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test 1",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");
    expect(
        (await getChannelNameAndDescriptionContentAndContributors(session.action(), channel.id))
            .name,
    ).toEqual("Test 1");
    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }).then(result => (result.items[0]?.model as any).name),
    ).toEqual("Test 1");

    await updateChannelName(session.action(), {
        channelId: channel.id,
        name: "Test 2",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 2");
    expect(
        (await getChannelNameAndDescriptionContentAndContributors(session.action(), channel.id))
            .name,
    ).toEqual("Test 2");
    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }).then(result => (result.items[0]?.model as any).name),
    ).toEqual("Test 2");
});

test("can’t update a channel’s name if the name is too long", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test 1",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");

    await expect(
        updateChannelName(session.action(), {
            channelId: channel.id,
            name: "x".repeat(513),
        }),
    ).rejects.toThrow("Expected string to have a length less than or equal to 50");

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");
});

test("can’t update a channel’s name from a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test 1",
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");

    await expect(
        updateChannelName(otherSession.action(), {
            channelId: channel.id,
            name: "Test 2",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");
});

test("can’t update a channel’s name without manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test 1",
    });

    await channel.access.revokeDefault(session1);

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1");

    await expect(
        updateChannelName(session2.action(), {
            channelId: channel.id,
            name: "Test 2",
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1");

    await channel.access.grantDefault(session1, "View");

    await expect(
        updateChannelName(session2.action(), {
            channelId: channel.id,
            name: "Test 3",
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1");

    await channel.access.grantDefault(session1, "Comment");

    await expect(
        updateChannelName(session2.action(), {
            channelId: channel.id,
            name: "Test 4",
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1");

    await channel.access.grantDefault(session1, "Edit");

    await expect(
        updateChannelName(session2.action(), {
            channelId: channel.id,
            name: "Test 5",
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1");

    await channel.access.grantDefault(session1, "Manage");

    await updateChannelName(session2.action(), {
        channelId: channel.id,
        name: "Test 6",
    });

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 6");
});

test("can’t update the name of a channel that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        updateChannelName(session.action(), {
            channelId: generateId(),
            name: "Test 2",
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can update a channel’s description", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelDescription(session.action(), {
        channelId: channel.id,
        description: testMessageContent1,
    });

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        testMessageContent1,
    );

    await updateChannelDescription(session.action(), {
        channelId: channel.id,
        description: testMessageContent2,
    });

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        testMessageContent2,
    );
});

test("can’t update a channel’s description from a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session);

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await expect(
        updateChannelDescription(otherSession.action(), {
            channelId: channel.id,
            description: testMessageContent1,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );
});

test("can’t update the description of a channel that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        updateChannelDescription(session.action(), {
            channelId: generateId(),
            description: testMessageContent1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can’t update a channel’s description with invalid content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelDescription(session.action(), {
        channelId: channel.id,
        description: testMessageContent1,
    });

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        testMessageContent1,
    );

    await expect(
        updateChannelDescription(session.action(), {
            channelId: channel.id,
            description: assertMessageContent(
                MessageContentProsemirrorSchema.nodes.doc.create({}, [
                    MessageContentProsemirrorSchema.nodes.unorderedListItem.create({}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        }),
    ).rejects.toThrow(InvalidArgumentError);

    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        testMessageContent1,
    );
});

test("can’t update a channel’s description without manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        description: "Test 1",
    });

    await channel.access.revokeDefault(session1);

    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1"))');

    await expect(
        updateChannelDescription(session2.action(), {
            channelId: channel.id,
            description: createSimpleMessageContent("Test 2"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1"))');

    await channel.access.grantDefault(session1, "View");

    await expect(
        updateChannelDescription(session2.action(), {
            channelId: channel.id,
            description: createSimpleMessageContent("Test 3"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1"))');

    await channel.access.grantDefault(session1, "Comment");

    await expect(
        updateChannelDescription(session2.action(), {
            channelId: channel.id,
            description: createSimpleMessageContent("Test 4"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1"))');

    await channel.access.grantDefault(session1, "Edit");

    await expect(
        updateChannelDescription(session2.action(), {
            channelId: channel.id,
            description: createSimpleMessageContent("Test 5"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1"))');

    await channel.access.grantDefault(session1, "Manage");

    await updateChannelDescription(session2.action(), {
        channelId: channel.id,
        description: createSimpleMessageContent("Test 6"),
    });

    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 6"))');
});

test("can update a channel’s name and description", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {name: "Test 1"});

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");
    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelNameAndDescription(session.action(), {
        channelId: channel.id,
        name: "Test 2",
        description: testMessageContent1,
    });

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 2");
    expect((await getChannel(session.action(), channel.id)).model.description.doc).toEqual(
        testMessageContent1,
    );
});

test("can’t update a channel’s name and description from a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session, {name: "Test 1"});

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");

    await expect(
        updateChannelNameAndDescription(otherSession.action(), {
            channelId: channel.id,
            name: "Test 2",
            description: emptyMessageContent,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(session.action(), channel.id)).model.name).toEqual("Test 1");
});

test("can’t update the name and description of a channel that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        updateChannelNameAndDescription(session.action(), {
            channelId: generateId(),
            name: "Test 2",
            description: emptyMessageContent,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can’t update a channel’s name and description without manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test 1a",
        description: "Test 1b",
    });

    await channel.access.revokeDefault(session1);

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1a");
    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1b"))');

    await expect(
        updateChannelNameAndDescription(session2.action(), {
            channelId: channel.id,
            name: "Test 2a",
            description: createSimpleMessageContent("Test 2b"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1a");
    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1b"))');

    await channel.access.grantDefault(session1, "View");

    await expect(
        updateChannelNameAndDescription(session2.action(), {
            channelId: channel.id,
            name: "Test 3a",
            description: createSimpleMessageContent("Test 3b"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1a");
    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1b"))');

    await channel.access.grantDefault(session1, "Comment");

    await expect(
        updateChannelNameAndDescription(session2.action(), {
            channelId: channel.id,
            name: "Test 4a",
            description: createSimpleMessageContent("Test 4b"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1a");
    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1b"))');

    await channel.access.grantDefault(session1, "Edit");

    await expect(
        updateChannelNameAndDescription(session2.action(), {
            channelId: channel.id,
            name: "Test 5a",
            description: createSimpleMessageContent("Test 5b"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 1a");
    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 1b"))');

    await channel.access.grantDefault(session1, "Manage");

    await updateChannelNameAndDescription(session2.action(), {
        channelId: channel.id,
        name: "Test 6a",
        description: createSimpleMessageContent("Test 6b"),
    });

    expect((await getChannel(session1.action(), channel.id)).model.name).toEqual("Test 6a");
    expect(
        (await getChannel(session1.action(), channel.id)).model.description.doc.toString(),
        // eslint-disable-next-line string-quotes
    ).toEqual('doc(paragraph("Test 6b"))');
});

test("can’t update channel access policy without manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);
    const channel = await TestChannel.create(session1);

    await channel.access.revokeDefault(session1);

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 2}],
                    [session3.account.id, {level: "Manage", generation: 3}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "View");

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 2}],
                    [session3.account.id, {level: "Manage", generation: 3}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "Comment");

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 2}],
                    [session3.account.id, {level: "Manage", generation: 3}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "Edit");

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 2}],
                    [session3.account.id, {level: "Manage", generation: 3}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "Manage");

    expect(await channel.access.get()).toEqual({
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Manage", generation: 1},
        urlGrant: null,
    });

    await updateChannelAccessPolicy(session2.action(), {
        channelId: channel.id,
        accessPolicy: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Manage", generation: 2}],
                [session3.account.id, {level: "Manage", generation: 3}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
        notification: null,
    });

    expect(await channel.access.get()).toEqual({
        accountGrantById: new Map([
            [session1.account.id, {level: "Manage", generation: 0}],
            [session2.account.id, {level: "Manage", generation: 2}],
            [session3.account.id, {level: "Manage", generation: 3}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });
});

test("can’t update channel access policy (with add account grants function) without manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);
    const channel = await TestChannel.create(session1);

    await channel.access.revokeDefault(session1);

    await expect(
        addAccountGrantsToChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
            ]),
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "View");

    await expect(
        addAccountGrantsToChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
            ]),
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "Comment");

    await expect(
        addAccountGrantsToChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
            ]),
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "Edit");

    await expect(
        addAccountGrantsToChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
            ]),
            notification: null,
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to channel");

    await channel.access.grantDefault(session1, "Manage");

    expect(await channel.access.get()).toEqual({
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Manage", generation: 1},
        urlGrant: null,
    });

    await addAccountGrantsToChannelAccessPolicy(session2.action(), {
        channelId: channel.id,
        accountGrantById: new Map([
            [session2.account.id, {level: "Manage"}],
            [session3.account.id, {level: "Manage"}],
        ]),
        notification: null,
    });

    expect(await channel.access.get()).toEqual({
        accountGrantById: new Map([
            [session1.account.id, {level: "Manage", generation: 0}],
            [session2.account.id, {level: "Manage", generation: 2}],
            [session3.account.id, {level: "Manage", generation: 2}],
        ]),
        defaultGrant: {level: "Manage", generation: 1},
        urlGrant: null,
    });
});

test("can’t update channel access policy with invalid update", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const channel = await TestChannel.create(session1);

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow(
        "Can’t set new account grant manage generation to be less than or equal to our actor’s manage generation",
    );

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session2.account.id, {level: "Manage", generation: 2}],
                ]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );

    await expect(
        updateChannelAccessPolicy(session2.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 2}],
                ]),
                defaultGrant: {level: "Manage", generation: 3},
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow("Can’t change default grant manage generation");
});

test("can’t update channel access policy with `urlGrant``", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);

    await expect(
        updateChannelAccessPolicy(session.action(), {
            channelId: channel.id,
            accessPolicy: {
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: {level: "View"},
            },
            notification: null,
        }),
    ).rejects.toThrow("Channels don’t currently support `urlGrant`s");

    expect((await channel.access.get()).urlGrant).toEqual(null);
});

test("can create a post", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);

    await channel.createPost(session);
});

test("can’t create a post for a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();
    const channel = await TestChannel.create(session);

    await expect(channel.createPost(otherSession)).rejects.toThrow(PermissionDeniedError);
});

test("can’t create a post with invalid content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const channel = await TestChannel.create(session);

    await expect(
        channel.createPost(
            session,
            assertPostContent(
                PostContentProsemirrorSchema.nodes.doc.create({}, [
                    PostContentProsemirrorSchema.nodes.unorderedListItem.create({}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        ),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can’t create a post without edit access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);

    await channel.access.revokeDefault(session1);

    await expect(
        createPost(session2.action(), {
            channelId: channel.id,
            content: createSimplePostContent("Test post 1"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to channel");

    await channel.access.grantDefault(session1, "View");

    await expect(
        createPost(session2.action(), {
            channelId: channel.id,
            content: createSimplePostContent("Test post 2"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to channel");

    await channel.access.grantDefault(session1, "Comment");

    await expect(
        createPost(session2.action(), {
            channelId: channel.id,
            content: createSimplePostContent("Test post 3"),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to channel");

    await channel.access.grantDefault(session1, "Edit");

    await createPost(session2.action(), {
        channelId: channel.id,
        content: createSimplePostContent("Test post 4"),
    });

    await channel.access.grantDefault(session1, "Manage");

    await createPost(session2.action(), {
        channelId: channel.id,
        content: createSimplePostContent("Test post 5"),
    });
});

test("can’t get a post that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(getPost(session.action(), generateId())).rejects.toThrow(NotFoundError);
    await expect(getPostIfPossible(session.action(), generateId())).rejects.toThrow(NotFoundError);
    await expect(getPostContentAndChannelPreview(session.action(), generateId())).rejects.toThrow(
        NotFoundError,
    );
    expect(await getPostAuthorAndChannelPreviewIfPossible(session.action(), generateId())).toBe(
        null,
    );
    await expect(
        getPostAndInitialComments(session.action(), {postId: generateId(), commentLimit: 100}),
    ).rejects.toThrow(NotFoundError);
});

test("can’t get a post for a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session);

    const post = await channel.createPost(session);

    await expect(getPost(otherSession.action(), post.id)).rejects.toThrow(PermissionDeniedError);
    expect((await getPostIfPossible(otherSession.action(), post.id)).error).toBeInstanceOf(
        PermissionDeniedError,
    );
    await expect(getPostContentAndChannelPreview(otherSession.action(), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    expect(
        (await getPostAuthorAndChannelPreviewIfPossible(otherSession.action(), post.id))?.error,
    ).toBeInstanceOf(PermissionDeniedError);
    await expect(
        getPostAndInitialComments(otherSession.action(), {postId: post.id, commentLimit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can’t get a post from channel actor doesn’t have view access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.access.revokeDefault(session1);

    const post = await channel.createPost(session1);

    await expect(getPost(session2.action(), post.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    expect((await getPostIfPossible(session2.action(), post.id)).error).toEqual(
        new PermissionDeniedError("Actor doesn’t have `View` access level to channel"),
    );
    await expect(getPostContentAndChannelPreview(session2.action(), post.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    expect(
        (await getPostAuthorAndChannelPreviewIfPossible(session2.action(), post.id))?.error
            ?.message,
    ).toContain("Actor doesn’t have `View` access level to channel");
    await expect(
        getPostAndInitialComments(session2.action(), {postId: post.id, commentLimit: 100}),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");

    await channel.access.grantDefault(session1, "View");

    await expect(getPost(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostIfPossible(session2.action(), post.id)).ok).toEqual(true);
    await expect(getPostContentAndChannelPreview(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostAuthorAndChannelPreviewIfPossible(session2.action(), post.id))?.ok).toBe(
        true,
    );
    await expect(
        getPostAndInitialComments(session2.action(), {postId: post.id, commentLimit: 100}),
    ).resolves.toBeTruthy();

    await channel.access.grantDefault(session1, "Comment");

    await expect(getPost(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostIfPossible(session2.action(), post.id)).ok).toEqual(true);
    await expect(getPostContentAndChannelPreview(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostAuthorAndChannelPreviewIfPossible(session2.action(), post.id))?.ok).toBe(
        true,
    );
    await expect(
        getPostAndInitialComments(session2.action(), {postId: post.id, commentLimit: 100}),
    ).resolves.toBeTruthy();

    await channel.access.grantDefault(session1, "Edit");

    await expect(getPost(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostIfPossible(session2.action(), post.id)).ok).toEqual(true);
    await expect(getPostContentAndChannelPreview(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostAuthorAndChannelPreviewIfPossible(session2.action(), post.id))?.ok).toBe(
        true,
    );
    await expect(
        getPostAndInitialComments(session2.action(), {postId: post.id, commentLimit: 100}),
    ).resolves.toBeTruthy();

    await channel.access.grantDefault(session1, "Manage");

    await expect(getPost(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostIfPossible(session2.action(), post.id)).ok).toEqual(true);
    await expect(getPostContentAndChannelPreview(session2.action(), post.id)).resolves.toBeTruthy();
    expect((await getPostAuthorAndChannelPreviewIfPossible(session2.action(), post.id))?.ok).toBe(
        true,
    );
    await expect(
        getPostAndInitialComments(session2.action(), {postId: post.id, commentLimit: 100}),
    ).resolves.toBeTruthy();

    await channel.access.revokeDefault(session1);

    await expect(getPost(session2.action(), post.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    expect((await getPostIfPossible(session2.action(), post.id)).error).toEqual(
        new PermissionDeniedError("Actor doesn’t have `View` access level to channel"),
    );
    await expect(getPostContentAndChannelPreview(session2.action(), post.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    expect(
        (await getPostAuthorAndChannelPreviewIfPossible(session2.action(), post.id))?.error
            ?.message,
    ).toContain("Actor doesn’t have `View` access level to channel");
    await expect(
        getPostAndInitialComments(session2.action(), {postId: post.id, commentLimit: 100}),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
});

test("can get a post", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    const post = await channel.createPost(session, testContent1);

    expect((await getPost(session.action(), post.id)).model.content.doc.toJSON()).toEqual(
        testContent1.toJSON(),
    );
    expect(
        (await getPostIfPossible(session.action(), post.id)).value?.model.content.doc.toJSON(),
    ).toEqual(testContent1.toJSON());
    expect(
        (await getPostContentAndChannelPreview(session.action(), post.id)).content.toJSON(),
    ).toEqual(testContent1.toJSON());
    expect(await getPostAuthorAndChannelPreviewIfPossible(session.action(), post.id)).toBeTruthy();
    expect(
        (
            await getPostAndInitialComments(session.action(), {postId: post.id, commentLimit: 100})
        ).post.model.content.doc.toJSON(),
    ).toEqual(testContent1.toJSON());
});

test("can get the comment authors on a post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4, session5, session6, session7, session8] =
        await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    expect(await getPostCommentAuthors(session1.action(), {postId: post.id, limit: 100})).toEqual(
        [],
    );

    await post.createComment(session1, testMessageContent1);

    expect(await getPostCommentAuthors(session1.action(), {postId: post.id, limit: 100})).toEqual([
        await session1.get(),
    ]);

    await post.createComment(session2, testMessageContent1);
    await post.createComment(session3, testMessageContent1);

    expect(await getPostCommentAuthors(session1.action(), {postId: post.id, limit: 100})).toEqual(
        await runAllPromises([await session1.get(), await session2.get(), await session3.get()]),
    );

    await post.createComment(session4, testMessageContent1);
    await post.createComment(session5, testMessageContent1);
    await post.createComment(session6, testMessageContent1);
    await post.createComment(session7, testMessageContent1);
    await post.createComment(session8, testMessageContent1);

    expect(await getPostCommentAuthors(session1.action(), {postId: post.id, limit: 100})).toEqual(
        await runAllPromises([
            session1.get(),
            session2.get(),
            session3.get(),
            session4.get(),
            session5.get(),
            session6.get(),
            session7.get(),
            session8.get(),
        ]),
    );

    await deletePostComment(session3.action(), {
        postId: post.id,
        commentIndex: 2,
    });

    expect(await getPostCommentAuthors(session1.action(), {postId: post.id, limit: 100})).toEqual(
        await runAllPromises([
            session1.get(),
            session2.get(),
            session3.get(),
            session4.get(),
            session5.get(),
            session6.get(),
            session7.get(),
            session8.get(),
        ]),
    );

    expect(await getPostCommentAuthors(session1.action(), {postId: post.id, limit: 5})).toEqual(
        await runAllPromises([
            session1.get(),
            session2.get(),
            session3.get(),
            session4.get(),
            session5.get(),
        ]),
    );
});

test("can’t get the comment authors in another space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await expect(
        getPostCommentAuthors(otherSession.action(), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);

    await post.createComment(session2, testMessageContent1);

    await expect(
        getPostCommentAuthors(otherSession.action(), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can’t get the comment authors for a post in a channel you don’t have access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    await channel.access.revokeDefault(session1);
    await channel.access.grant(session1, session2, "Comment");

    await expect(
        getPostCommentAuthors(session3.action(), {postId: post.id, limit: 100}),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");

    await post.createComment(session2, testMessageContent1);

    await expect(
        getPostCommentAuthors(session3.action(), {postId: post.id, limit: 100}),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");

    await channel.access.grant(session1, session3, "View");

    expect(await getPostCommentAuthors(session3.action(), {postId: post.id, limit: 100})).toEqual([
        await session2.get(),
    ]);
});

test("can not get channel posts for a channel that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        getChannelPosts(session.action(), {
            channelId: generateId(),
            limit: 100,
            beforeCursor: null,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not get channel posts for a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session);

    await expect(
        getChannelPosts(otherSession.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not get channel posts for a different space when there are a few posts", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session1);

    await channel.createPost(session1, testContent1);
    await channel.createPost(session2, testContent2);
    await channel.createPost(session3, testContent3);

    await expect(
        getChannelPosts(otherSession.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get channel posts when there are none", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    await expect(
        getChannelPosts(session.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [],
    });
});

test("can get the first few posts in a channel", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const channel = await TestChannel.create(session1);

    const post1 = await channel.createPost(session1, testContent1);

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    const post2 = await channel.createPost(session2, testContent2);

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    const post3 = await channel.createPost(session3, testContent3);

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });
});

test("can get the first few posts in a channel with limit and cursor", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const channel = await TestChannel.create(session1);

    const post1 = await channel.createPost(session1, testContent1);

    const post2 = await channel.createPost(session2, testContent2);

    const post3 = await channel.createPost(session3, testContent3);

    const post4 = await channel.createPost(session1, testContent2);

    const post5 = await channel.createPost(session2, testContent1);

    const channelPostsResult = await getChannelPosts(session1.action(), {
        channelId: channel.id,
        limit: 100,
        beforeCursor: null,
    });

    expect(channelPostsResult).toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post4.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post5.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 3,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: true,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post4.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post5.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 4,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: true,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post4.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post5.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 5,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post4.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post5.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 2,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: true,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post3.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session3.get(),
                    content: testContent3WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });

    await expect(
        getChannelPosts(session1.action(), {
            channelId: channel.id,
            limit: 2,
            beforeCursor: channelPostsResult.items[2]!.cursor,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        partitionKey: expect.any(String),
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: channelPostsResult.items[2]!.cursor,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post1.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session1.get(),
                    content: testContent1WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
                    id: post2.id,
                    spaceId: space.id,
                    channel: {
                        id: channel.id,
                        createdTime: channel.createdTime,
                        name: channel.initialName,
                        spaceId: space.id,
                        accessPolicy: expect.any(Object),
                    },
                    createdTime: expect.any(Date),
                    author: await session2.get(),
                    content: testContent2WithReferences,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                },
            },
        ],
    });
});

test("can backfill realtime updates in a channel", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const readTime1 = new Date();

    const channel1 = await TestChannel.create(session);
    const channel2 = await TestChannel.create(session);

    const post1 = await channel1.createPost(session, testContent1);
    const post2 = await channel2.createPost(session, testContent2);
    const post3 = await channel1.createPost(session, testContent3);
    const post4 = await channel2.createPost(session, testContent2);

    await ProcessContextModule.waitForTestTasks();

    const readTime2 = addMinutes(
        new Date(),
        dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes,
    );

    const channel1PostsResult = await getChannelPosts(session.action(), {
        channelId: channel1.id,
        limit: 100,
        beforeCursor: null,
    });

    const channel2PostsResult = await getChannelPosts(session.action(), {
        channelId: channel2.id,
        limit: 100,
        beforeCursor: null,
    });

    await expect(
        backfillChannelPosts(otherSession.action(), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    const post1a = (await getPost(session.action(), post1.id)).model;
    const post2a = (await getPost(session.action(), post2.id)).model;
    const post3a = (await getPost(session.action(), post3.id)).model;
    const post4a = (await getPost(session.action(), post4.id)).model;

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 0,
                    model: post1a,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 0,
                    model: post4a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await updatePostContent(session.action(), {
        postId: post1.id,
        content: createSimplePostContent("Updated test content 1"),
    });

    const post1b = (await getPost(session.action(), post1.id)).model;

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 0,
                    model: post4a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await updatePostContent(session.action(), {
        postId: post4.id,
        content: createSimplePostContent("Updated test content 2"),
    });

    const post4b = (await getPost(session.action(), post4.id)).model;

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });

    const post5 = await channel1.createPost(session, testContent1);

    const post5a = (await getPost(session.action(), post5.id)).model;

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {partitionKey: expect.any(String), cursor: expect.any(String)},
                    ],
                ]),
                item: {
                    key: expect.any(String),
                    version: 0,
                    model: post5a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel1PostsResult.partitionKey,
                            cursor: channel1PostsResult.items[0]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {partitionKey: expect.any(String), cursor: expect.any(String)},
                    ],
                ]),
                item: {
                    key: expect.any(String),
                    version: 0,
                    model: post5a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {
                            partitionKey: channel2PostsResult.partitionKey,
                            cursor: channel2PostsResult.items[1]!.cursor,
                        },
                    ],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });
});

test("won’t backfill realtime updates when comment count changes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const readTime1 = new Date();

    const channel = await TestChannel.create(session);

    const post = await channel.createPost(session, testContent1);

    await ProcessContextModule.waitForTestTasks();

    const readTime2 = addMinutes(new Date(), 3);

    const post1a = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {partitionKey: expect.any(String), cursor: expect.any(String)},
                    ],
                ]),
                item: {
                    key: expect.any(String),
                    version: 0,
                    model: post1a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const comment1 = await post.createComment(session, "comment1");

    const post1b = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1b.commentCount).toEqual(1);
    expect(post1b.lastCommentChangeTime).toEqual(null);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {partitionKey: expect.any(String), cursor: expect.any(String)},
                    ],
                ]),
                item: {
                    key: expect.any(String),
                    version: 1,
                    model: post1b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const comment2 = await post.createComment(session, "comment2");

    const post1c = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1c.commentCount).toEqual(2);
    expect(post1c.lastCommentChangeTime).toEqual(null);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const {contentUpdatedTime: comment2ContentUpdatedTime} = await updatePostCommentContent(
        session.action(),
        {
            postId: post.id,
            commentIndex: comment2.index,
            content: createSimpleMessageContent("comment2 (updated)"),
        },
    );

    const post1d = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1d.commentCount).toEqual(2);
    expect(post1d.lastCommentChangeTime).toEqual(comment2ContentUpdatedTime);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const {deletedTime: comment1DeletedTime} = await deletePostComment(session.action(), {
        postId: post.id,
        commentIndex: comment1.index,
    });

    const post1e = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1e.commentCount).toEqual(2);
    expect(post1e.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await post.createComment(session, "comment3");

    const post1f = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1f.commentCount).toEqual(3);
    expect(post1f.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await updatePostContent(session.action(), {
        postId: post.id,
        content: createSimplePostContent("Updated test content"),
    });

    await ProcessContextModule.waitForTestTasks();

    const readTime3 = addMinutes(
        new Date(),
        dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes,
    );

    const post1g = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1g.commentCount).toEqual(3);
    expect(post1g.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                indexes: new Map([
                    [
                        "ChannelPosts",
                        {partitionKey: expect.any(String), cursor: expect.any(String)},
                    ],
                ]),
                item: {
                    key: expect.any(String),
                    version: 6,
                    model: post1g,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime3,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await post.createComment(session, "comment4");

    const post1h = (await getPost(session.action(), post.id)).model;

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1g.commentCount).toEqual(3);
    expect(post1g.lastCommentChangeTime).toEqual(comment1DeletedTime);
    expect(post1h.commentCount).toEqual(4);
    expect(post1h.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(session.action(), {
            channelId: channel.id,
            readTime: readTime3,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });
});

test("can update a post’s contents", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    const post = await channel.createPost(session, testContent1);

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const {contentUpdatedTime: contentUpdatedTime1} = await updatePostContent(session.action(), {
        postId: post.id,
        content: testContent2,
    });

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent2WithReferences,
        contentUpdatedTime: contentUpdatedTime1,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const {contentUpdatedTime: contentUpdatedTime2} = await updatePostContent(session.action(), {
        postId: post.id,
        content: testContent3,
    });

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent3WithReferences,
        contentUpdatedTime: contentUpdatedTime2,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can’t update another account’s post", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const channel = await TestChannel.create(session1);

    const post = await channel.createPost(session1, testContent1);

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session1.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await expect(
        updatePostContent(session2.action(), {
            postId: post.id,
            content: testContent2,
        }),
    ).rejects.toThrow("Can only update posts you authored");

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session1.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can’t update another space’s post", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel = await TestChannel.create(session);

    const post = await channel.createPost(session, testContent1);

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await expect(
        updatePostContent(otherSession.action(), {
            postId: post.id,
            content: testContent2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can’t update a post with invalid content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    const post = await channel.createPost(session, testContent1);

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await expect(
        updatePostContent(session.action(), {
            postId: post.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.nodes.doc.create({}, [
                    PostContentProsemirrorSchema.nodes.unorderedListItem.create({}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        }),
    ).rejects.toThrow(InvalidArgumentError);

    expect((await getPost(session.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: expect.any(Object),
        },
        createdTime: expect.any(Date),
        author: await session.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can’t update a post after losing channel access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const channel = await TestChannel.create(session1);

    const post = await channel.createPost(session2, testContent1);

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: await channel.access.get(),
        },
        createdTime: expect.any(Date),
        author: await session2.get(),
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await updatePostContent(session2.action(), {
        postId: post.id,
        content: testContent2,
    });

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: await channel.access.get(),
        },
        createdTime: expect.any(Date),
        author: await session2.get(),
        content: testContent2WithReferences,
        contentUpdatedTime: expect.any(Date),
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await channel.access.revokeDefault(session1);

    await expect(
        updatePostContent(session2.action(), {
            postId: post.id,
            content: testContent3,
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to channel");

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: await channel.access.get(),
        },
        createdTime: expect.any(Date),
        author: await session2.get(),
        content: testContent2WithReferences,
        contentUpdatedTime: expect.any(Date),
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await channel.access.grantDefault(session1, "View");

    await expect(
        updatePostContent(session2.action(), {
            postId: post.id,
            content: testContent3,
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to channel");

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: await channel.access.get(),
        },
        createdTime: expect.any(Date),
        author: await session2.get(),
        content: testContent2WithReferences,
        contentUpdatedTime: expect.any(Date),
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await channel.access.grantDefault(session1, "Edit");

    await updatePostContent(session2.action(), {
        postId: post.id,
        content: testContent3,
    });

    expect((await getPost(session1.action(), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: channel.initialName,
            spaceId: space.id,
            accessPolicy: await channel.access.get(),
        },
        createdTime: expect.any(Date),
        author: await session2.get(),
        content: testContent3WithReferences,
        contentUpdatedTime: expect.any(Date),
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("if time hasn’t moved forward updating a post will set it to +1ms of the last update time", async () => {
    const originalDateNow = Date.now;
    const mockTime = 1675809808692;
    Date.now = () => mockTime;

    try {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const channel = await TestChannel.create(session);

        const post = await channel.createPost(session, testContent1);

        await updatePostContent(session.action(), {
            postId: post.id,
            content: testContent2,
        });

        {
            const updatedPost = (await getPost(session.action(), post.id)).model;
            assert(updatedPost);
            expect(updatedPost.contentUpdatedTime).toEqual(new Date(mockTime));
        }

        await updatePostContent(session.action(), {
            postId: post.id,
            content: testContent3,
        });

        {
            const updatedPost = (await getPost(session.action(), post.id)).model;
            assert(updatedPost);
            expect(updatedPost.contentUpdatedTime).toEqual(new Date(mockTime + 1));
        }
    } finally {
        Date.now = originalDateNow;
    }
});

test("broadcasts channel realtime events to channel", async () => {
    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel1 = await TestChannel.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const channel2 = await TestChannel.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const otherChannel = await TestChannel.create(otherSession);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    await updateChannelName(session.action(), {
        channelId: channel2.id,
        name: "Test 2 (updated)",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);

    await updateChannelName(otherSession.action(), {
        channelId: otherChannel.id,
        name: "Test 3 (updated)",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
    ]);

    await updateChannelDescription(session.action(), {
        channelId: channel1.id,
        description: createSimpleMessageContent("A description"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
    ]);
});

test("broadcasts post realtime events to channel and post", async () => {
    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const channel1 = await TestChannel.create(session);
    const channel2 = await TestChannel.create(session);
    const otherChannel = await TestChannel.create(otherSession);

    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    await channel2.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);

    const post2 = await otherChannel.createPost(otherSession);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
    ]);

    const post3 = await channel1.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
    ]);

    await channel1.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
    ]);

    await channel2.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);

    await updatePostContent(otherSession.action(), {
        postId: post2.id,
        content: createSimplePostContent("Post 2 (updated)"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post2.id}/broadcast-realtime-event-transaction`,
    ]);

    await updatePostContent(session.action(), {
        postId: post3.id,
        content: createSimplePostContent("Post 3 (updated)"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post3.id}/broadcast-realtime-event-transaction`,
    ]);

    await channel2.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post3.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);
});

test("can add accounts to spaces as admin", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const adminSession = await space1.createSession({role: "Admin"});
    const session1 = await space1.createSession();
    const session2 = await space2.createSession();

    const session3 = await TestSession.create(await TestAccount.create(context));
    const session4 = await TestSession.create(await TestAccount.create(context));

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    await expect(
        addSpaceAccount(session3.action(), {
            spaceId: space1.id,
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        addSpaceAccount(session3.action(), {
            spaceId: space1.id,
            accountId: session4.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        addSpaceAccount(session3.action(), {
            spaceId: space1.id,
            accountId: session1.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        addSpaceAccount(session3.action(), {
            spaceId: space1.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        addSpaceAccount(session2.action(), {
            spaceId: space2.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        addSpaceAccount(session2.action(), {
            spaceId: space2.id,
            accountId: session1.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    const channel1 = await TestChannel.create(session1);

    await expect(getChannel(session3.action(), channel1.id)).rejects.toThrow(PermissionDeniedError);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    await expect(
        addSpaceAccount(adminSession.action(), {
            spaceId: space1.id,
            accountId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    await expect(
        addSpaceAccount(adminSession.action(), {
            spaceId: generateId(),
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await addSpaceAccount(adminSession.action(), {
        spaceId: space1.id,
        accountId: session3.account.id,
    });

    await getChannel(session3.action(), channel1.id);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    // admin is a member of space 1 so it can access channel1 which is in space 1
    await getChannel(adminSession.action(), channel1.id);

    // adminSession account is already a member of space1 so it can't be added again
    await expect(
        addSpaceAccount(adminSession.action(), {
            spaceId: space1.id,
            accountId: adminSession.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    await getChannel(adminSession.action(), channel1.id);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    await expect(
        addSpaceAccount(adminSession.action(), {
            spaceId: space1.id,
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    await expect(
        addSpaceAccount(adminSession.action(), {
            spaceId: space2.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    await expect(getChannel(session2.action(), channel1.id)).rejects.toThrow(PermissionDeniedError);

    await addSpaceAccount(adminSession.action(), {
        spaceId: space1.id,
        accountId: session2.account.id,
    });

    await getChannel(session2.action(), channel1.id);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(
        new Set([space2.id, space1.id]),
    );
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );
});

test("can authorize post access at different levels", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const [session1, session2, session3, session5, session6, session7, session8] =
        await space1.createSessions(7);
    const session4 = await space2.createSession();

    await space2.addAccount(session1);

    const channel = await TestChannel.create(session1);

    const post4 = await channel.createPost(session6);
    const post5 = await channel.createPost(session7);
    const post6 = await channel.createPost(session8);

    await channel.access.revokeDefault(session1);
    await channel.access.grant(session1, session2, "Manage");
    await channel.access.grant(session1, session3, "Manage");
    await channel.access.grant(session1, session6, "View");
    await channel.access.grant(session1, session7, "Comment");
    await channel.access.grant(session1, session8, "Edit");

    const post1 = await channel.createPost(session1);
    const post2 = await channel.createPost(session2);
    const post3 = await channel.createPost(session3);

    const impersonate = (space: TestSpace, session: TestSession) => {
        return context.impersonatedAccountAction(space.id, session.account.id);
    };

    const auth = async (
        context: ServerActionContext,
        id: PostId,
        expectedAccessLevel: "View" | "Edit",
    ) => {
        const result = await authorizePostAccessIfPossible(context, id, expectedAccessLevel);

        try {
            await authorizePostAccess(context, id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
            return null;
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                expect(result.ok).toEqual(false);
                expect(result.error).toBeInstanceOf(PermissionDeniedError);
                return "PermissionDenied";
            } else if (error instanceof UnauthenticatedError) {
                expect(result.ok).toEqual(false);
                expect(result.error).toBeInstanceOf(UnauthenticatedError);
                return "Unauthenticated";
            } else {
                throw error;
            }
        }
    };

    expect(await auth(space1.systemAction(), post1.id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), post1.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post1.id, "View")).toEqual(null);
    expect(await auth(session2.action(), post1.id, "View")).toEqual(null);
    expect(await auth(session3.action(), post1.id, "View")).toEqual(null);
    expect(await auth(session4.action(), post1.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post1.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post1.id, "View")).toEqual(null);
    expect(await auth(session7.action(), post1.id, "View")).toEqual(null);
    expect(await auth(session8.action(), post1.id, "View")).toEqual(null);
    expect(await auth(context.anonymousAction(), post1.id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post1.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post1.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post1.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post1.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post1.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post1.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session7), post1.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session8), post1.id, "View")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post1.id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post1.id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post1.id, "Edit")).toEqual(null);
    expect(await auth(session2.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session7.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session8.action(), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), post1.id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post1.id, "Edit")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session7), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session8), post1.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), post1.id, "Edit")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post2.id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), post2.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post2.id, "View")).toEqual(null);
    expect(await auth(session2.action(), post2.id, "View")).toEqual(null);
    expect(await auth(session3.action(), post2.id, "View")).toEqual(null);
    expect(await auth(session4.action(), post2.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post2.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post2.id, "View")).toEqual(null);
    expect(await auth(session7.action(), post2.id, "View")).toEqual(null);
    expect(await auth(session8.action(), post2.id, "View")).toEqual(null);
    expect(await auth(context.anonymousAction(), post2.id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post2.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post2.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post2.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post2.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post2.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post2.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session7), post2.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session8), post2.id, "View")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post2.id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post2.id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session2.action(), post2.id, "Edit")).toEqual(null);
    expect(await auth(session3.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session7.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session8.action(), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), post2.id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session2), post2.id, "Edit")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session7), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session8), post2.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), post2.id, "Edit")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post3.id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), post3.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post3.id, "View")).toEqual(null);
    expect(await auth(session2.action(), post3.id, "View")).toEqual(null);
    expect(await auth(session3.action(), post3.id, "View")).toEqual(null);
    expect(await auth(session4.action(), post3.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post3.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post3.id, "View")).toEqual(null);
    expect(await auth(session7.action(), post3.id, "View")).toEqual(null);
    expect(await auth(session8.action(), post3.id, "View")).toEqual(null);
    expect(await auth(context.anonymousAction(), post3.id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post3.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post3.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post3.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post3.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post3.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post3.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session7), post3.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session8), post3.id, "View")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post3.id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post3.id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session2.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), post3.id, "Edit")).toEqual(null);
    expect(await auth(session4.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session7.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session8.action(), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), post3.id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session2), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), post3.id, "Edit")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session7), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session8), post3.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), post3.id, "Edit")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post4.id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session2.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session3.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session4.action(), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session7.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session8.action(), post4.id, "View")).toEqual(null);
    expect(await auth(context.anonymousAction(), post4.id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session7), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session8), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post4.id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post4.id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session2.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session7.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session8.action(), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), post4.id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session2), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session7), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session8), post4.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), post4.id, "Edit")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post4.id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session2.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session3.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session4.action(), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session7.action(), post4.id, "View")).toEqual(null);
    expect(await auth(session8.action(), post4.id, "View")).toEqual(null);
    expect(await auth(context.anonymousAction(), post4.id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post4.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session7), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session8), post4.id, "View")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post4.id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post5.id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session2.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session7.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session8.action(), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), post5.id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session2), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session7), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session8), post5.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), post5.id, "Edit")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post6.id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), post6.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post6.id, "View")).toEqual(null);
    expect(await auth(session2.action(), post6.id, "View")).toEqual(null);
    expect(await auth(session3.action(), post6.id, "View")).toEqual(null);
    expect(await auth(session4.action(), post6.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post6.id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post6.id, "View")).toEqual(null);
    expect(await auth(session7.action(), post6.id, "View")).toEqual(null);
    expect(await auth(session8.action(), post6.id, "View")).toEqual(null);
    expect(await auth(context.anonymousAction(), post6.id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post6.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), post6.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), post6.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), post6.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post6.id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post6.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session7), post6.id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session8), post6.id, "View")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post6.id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), post6.id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session2.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session7.action(), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session8.action(), post6.id, "Edit")).toEqual(null);
    expect(await auth(context.anonymousAction(), post6.id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session2), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session7), post6.id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session8), post6.id, "Edit")).toEqual(null);
    expect(await auth(impersonate(space2, session1), post6.id, "Edit")).toEqual("PermissionDenied");
});

test("can authorize channel access at different levels", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const [session1, session2, session3, session4, session5] = await space1.createSessions(7);
    const session6 = await space2.createSession();

    await space2.addAccount(session1);

    const channel = await TestChannel.create(session1);
    const {id} = channel;

    await channel.access.revokeDefault(session1);
    await channel.access.grant(session1, session2, "View");
    await channel.access.grant(session1, session3, "Comment");
    await channel.access.grant(session1, session4, "Edit");

    const impersonate = (space: TestSpace, session: TestSession) => {
        return context.impersonatedAccountAction(space.id, session.account.id);
    };

    const auth = async (
        context: ServerActionContext,
        id: ChannelId,
        expectedAccessLevel: AccessLevel,
    ) => {
        const result = await authorizeChannelAccessIfPossible(context, id, expectedAccessLevel);

        try {
            await authorizeChannelAccess(context, id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
            return null;
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                expect(result.ok).toEqual(false);
                expect(result.error).toBeInstanceOf(PermissionDeniedError);
                return "PermissionDenied";
            } else if (error instanceof UnauthenticatedError) {
                expect(result.ok).toEqual(false);
                expect(result.error).toBeInstanceOf(UnauthenticatedError);
                return "Unauthenticated";
            } else {
                throw error;
            }
        }
    };

    expect(await auth(space1.systemAction(), id, "View")).toEqual(null);
    expect(await auth(space2.systemAction(), id, "View")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), id, "View")).toEqual(null);
    expect(await auth(session2.action(), id, "View")).toEqual(null);
    expect(await auth(session3.action(), id, "View")).toEqual(null);
    expect(await auth(session4.action(), id, "View")).toEqual(null);
    expect(await auth(session5.action(), id, "View")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), id, "View")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), id, "View")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session2), id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session3), id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session4), id, "View")).toEqual(null);
    expect(await auth(impersonate(space1, session5), id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), id, "View")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), id, "View")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), id, "Comment")).toEqual(null);
    expect(await auth(space2.systemAction(), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), id, "Comment")).toEqual(null);
    expect(await auth(session2.action(), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), id, "Comment")).toEqual(null);
    expect(await auth(session4.action(), id, "Comment")).toEqual(null);
    expect(await auth(session5.action(), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), id, "Comment")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), id, "Comment")).toEqual(null);
    expect(await auth(impersonate(space1, session2), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), id, "Comment")).toEqual(null);
    expect(await auth(impersonate(space1, session4), id, "Comment")).toEqual(null);
    expect(await auth(impersonate(space1, session5), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), id, "Comment")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), id, "Comment")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), id, "Edit")).toEqual(null);
    expect(await auth(space2.systemAction(), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), id, "Edit")).toEqual(null);
    expect(await auth(session2.action(), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), id, "Edit")).toEqual(null);
    expect(await auth(session5.action(), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), id, "Edit")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), id, "Edit")).toEqual(null);
    expect(await auth(impersonate(space1, session2), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), id, "Edit")).toEqual(null);
    expect(await auth(impersonate(space1, session5), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), id, "Edit")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), id, "Edit")).toEqual("PermissionDenied");

    expect(await auth(space1.systemAction(), id, "Manage")).toEqual(null);
    expect(await auth(space2.systemAction(), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(session1.action(), id, "Manage")).toEqual(null);
    expect(await auth(session2.action(), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(session3.action(), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(session4.action(), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(session5.action(), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(session6.action(), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(context.anonymousAction(), id, "Manage")).toEqual("Unauthenticated");
    expect(await auth(impersonate(space1, session1), id, "Manage")).toEqual(null);
    expect(await auth(impersonate(space1, session2), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session3), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session4), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session5), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space1, session6), id, "Manage")).toEqual("PermissionDenied");
    expect(await auth(impersonate(space2, session1), id, "Manage")).toEqual("PermissionDenied");
});

test("authorizing channel access as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeChannelAccess(actionContext, channel.id, "View"),
            authorizeChannelAccess(actionContext, channel.id, "View"),
            authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
        ]);

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);
    }
});

test("authorizing channel access as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeChannelAccess(actionContext, channel.id, "View"),
            authorizeChannelAccess(actionContext, channel.id, "View"),
            authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
        ]);

        expect(getCount()).toEqual(1);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);
    }
});

test("authorizing channel access after getting channel as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChannel(actionContext, channel.id);

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChannelPreview(actionContext, channel.id);

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChannelAndMetadata(actionContext, {channelId: channel.id, postFilesLimit: 100});

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            getChannelAndMetadata(actionContext, {channelId: channel.id, postFilesLimit: 100}),
            authorizeChannelAccess(actionContext, channel.id, "View"),
        ]);

        expect(getCount()).toEqual(3);

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChannelContributors(actionContext, channel.id, {limit: 100});

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }
});

test("authorizing channel access after getting channel as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(1);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChannel(actionContext, channel.id);

        expect(getCount()).toEqual(1);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChannelPreview(actionContext, channel.id);

        expect(getCount()).toEqual(1);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChannelAndMetadata(actionContext, {channelId: channel.id, postFilesLimit: 100});

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            getChannelAndMetadata(actionContext, {channelId: channel.id, postFilesLimit: 100}),
            authorizeChannelAccess(actionContext, channel.id, "View"),
        ]);

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChannelContributors(actionContext, channel.id, {limit: 100});

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }
});

test("authorizing channel access after getting channel notification subscribers is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(1);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChannelNotificationSubscribers(actionContext, channel.id);

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        await authorizeChannelAccess(actionContext, channel.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccess(actionContext, channel.id, "View"),
                authorizeChannelAccessIfPossible(actionContext, channel.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }
});

test("authorizing post access as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);

    const post = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session1.action();

        expect(getCount()).toEqual(0);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "Edit");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "Edit"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizePostAccess(actionContext, post.id, "View"),
            authorizePostAccess(actionContext, post.id, "View"),
            authorizePostAccessIfPossible(actionContext, post.id, "View"),
        ]);

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);
    }
});

test("authorizing post access as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizePostAccess(actionContext, post.id, "View"),
            authorizePostAccess(actionContext, post.id, "View"),
            authorizePostAccessIfPossible(actionContext, post.id, "View"),
        ]);

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(2);
    }
});

test("authorizing post access after getting post as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    // Warm up `Forum` table so we don't create it when we're counting actions.
    await getPostCommentsFromStart(session1.action(), {
        postId: post.id,
        limit: 100,
        afterCommentIndex: null,
        beforeCommentIndex: null,
    });

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getPost(actionContext, post.id);

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getPostContentAndChannelPreview(actionContext, post.id);

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getPostCommentsFromStart(actionContext, {
            postId: post.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(4);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(4);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getPostCommentsFromEnd(actionContext, {
            postId: post.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(4);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(4);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }
});

test("authorizing post access after getting post as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(1);

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    // Warm up `Forum` table so we don't create it when we're counting actions.
    await getPostCommentsFromStart(session1.action(), {
        postId: post.id,
        limit: 100,
        afterCommentIndex: null,
        beforeCommentIndex: null,
    });

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getPost(actionContext, post.id);

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getPostIfPossible(actionContext, post.id);

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getPostContentAndChannelPreview(actionContext, post.id);

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getPostNotificationSubscribers(actionContext, post.id);

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(2);

        await authorizePostAccess(actionContext, post.id, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getPostCommentsFromStart(actionContext, {
            postId: post.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getPostCommentsFromEnd(actionContext, {
            postId: post.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        await authorizePostAccess(actionContext, post.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccess(actionContext, post.id, "View"),
                authorizePostAccessIfPossible(actionContext, post.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }
});

test("can create, get, update, and authorize a post draft", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const otherSession = await otherSpace.createSession();

    const draftId = generateChronologicalId<PostDraftId>();

    await authorizePostDraftAccess(session1.action(), space.id, session1.account.id, draftId);

    expect(
        await getPostDraftIfExists(session1.action(), space.id, session1.account.id, draftId),
    ).toEqual(null);

    await createOrReplacePostDraft(session1.action(), space.id, session1.account.id, draftId, {
        channelId: null,
        content: createSimplePostContent("Test post content 1"),
    });

    await authorizePostDraftAccess(session1.action(), space.id, session1.account.id, draftId);

    expect(
        await getPostDraftIfExists(session1.action(), space.id, session1.account.id, draftId),
    ).toEqual({
        channel: null,
        content: {
            doc: createSimplePostContent("Test post content 1"),
            references: emptyContentReferences,
        },
    });

    await expect(
        authorizePostDraftAccess(session1.action(), space.id, session2.account.id, draftId),
    ).rejects.toThrow("Can’t access drafts from other accounts");

    await expect(
        authorizePostDraftAccess(space.systemAction(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("System actors can’t access post drafts");

    await expect(
        authorizePostDraftAccess(otherSession.action(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        authorizePostDraftAccess(otherSpace.systemAction(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("System actor doesn’t have access to space");

    await expect(
        authorizePostDraftAccess(context.anonymousAction(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("Unauthenticated session");

    await authorizePostDraftAccess(
        context.impersonatedAccountAction(space.id, session1.account.id),
        space.id,
        session1.account.id,
        draftId,
    );

    await expect(
        authorizePostDraftAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            space.id,
            session1.account.id,
            draftId,
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        createOrReplacePostDraft(session2.action(), space.id, session1.account.id, draftId, {
            channelId: null,
            content: createSimplePostContent("Test post content 2"),
        }),
    ).rejects.toThrow("Can’t access drafts from other accounts");

    await expect(
        createOrReplacePostDraft(space.systemAction(), space.id, session1.account.id, draftId, {
            channelId: null,
            content: createSimplePostContent("Test post content 2"),
        }),
    ).rejects.toThrow("System actors can’t access post drafts");

    await expect(
        createOrReplacePostDraft(otherSession.action(), space.id, session1.account.id, draftId, {
            channelId: null,
            content: createSimplePostContent("Test post content 2"),
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        createOrReplacePostDraft(
            otherSpace.systemAction(),
            space.id,
            session1.account.id,
            draftId,
            {
                channelId: null,
                content: createSimplePostContent("Test post content 2"),
            },
        ),
    ).rejects.toThrow("System actor doesn’t have access to space");

    await expect(
        createOrReplacePostDraft(
            context.anonymousAction(),
            space.id,
            session1.account.id,
            draftId,
            {
                channelId: null,
                content: createSimplePostContent("Test post content 2"),
            },
        ),
    ).rejects.toThrow("Unauthenticated session");

    expect(
        await getPostDraftIfExists(session1.action(), space.id, session1.account.id, draftId),
    ).toEqual({
        channel: null,
        content: {
            doc: createSimplePostContent("Test post content 1"),
            references: emptyContentReferences,
        },
    });

    await createOrReplacePostDraft(session1.action(), space.id, session1.account.id, draftId, {
        channelId: null,
        content: createSimplePostContent("Test post content 3"),
    });

    expect(
        await getPostDraftIfExists(session1.action(), space.id, session1.account.id, draftId),
    ).toEqual({
        channel: null,
        content: {
            doc: createSimplePostContent("Test post content 3"),
            references: emptyContentReferences,
        },
    });

    await expect(
        getPostDraftIfExists(session2.action(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("Can’t access drafts from other accounts");

    await expect(
        getPostDraftIfExists(space.systemAction(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("System actors can’t access post drafts");

    await expect(
        getPostDraftIfExists(otherSession.action(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        getPostDraftIfExists(otherSpace.systemAction(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("System actor doesn’t have access to space");

    await expect(
        getPostDraftIfExists(context.anonymousAction(), space.id, session1.account.id, draftId),
    ).rejects.toThrow("Unauthenticated session");
});

test("will delete draft when creating post", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    const draftId = generateChronologicalId<PostDraftId>();

    expect(
        await getPostDraftIfExists(session.action(), space.id, session.account.id, draftId),
    ).toBeNull();

    await createOrReplacePostDraft(session.action(), space.id, session.account.id, draftId, {
        channelId: channel.id,
        content: createSimplePostContent("Test post content 1"),
    });

    expect(
        await getPostDraftIfExists(session.action(), space.id, session.account.id, draftId),
    ).not.toBeNull();

    await createPost(session.action(), {
        channelId: channel.id,
        draftId,
        content: createSimplePostContent("Test post content 2"),
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        await getPostDraftIfExists(session.action(), space.id, session.account.id, draftId),
    ).toBeNull();
});

test("will attach referenced files to post when creating from draft", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    const draftId = generateChronologicalId<PostDraftId>();

    const file = await TestFile.create(session);

    const postContent = assertPostContent(
        PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node("paragraph", {}, [
                PostContentProsemirrorSchema.text("Hello, world!"),
            ]),
            PostContentProsemirrorSchema.node("fileRow", {}, [
                PostContentProsemirrorSchema.node("file", {fileId: file.id}),
            ]),
        ]),
    );

    await createOrReplacePostDraft(session.action(), space.id, session.account.id, draftId, {
        channelId: channel.id,
        content: postContent,
    });

    await expect(
        createPost(session.action(), {
            channelId: channel.id,
            draftId: null,
            content: postContent,
        }),
    ).rejects.toThrow(new FailedPreconditionError("Must create post from draft to attach files"));

    await expect(
        createPost(session.action(), {
            channelId: channel.id,
            draftId,
            content: postContent,
        }),
    ).rejects.toThrow(new PermissionDeniedError("File isn’t attached to target"));

    await attachFileAsUploader(
        session.action(),
        space.id,
        file.id,
        FilePostAuthorizer.bind({type: "PostDraft", accountId: session.account.id, draftId}),
    );

    const post = await createPost(session.action(), {
        channelId: channel.id,
        draftId,
        content: postContent,
    });

    expect(
        await getFileFromAttachment(
            session.action(),
            space.id,
            file.id,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).toEqual(
        new FileModel({
            id: file.id,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: expect.any(Object),
        }),
    );
});

test("can check if actor is subscribed to channel", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(false);
    expect(await isSubscribedToChannel(session3.action(), channel.id)).toEqual(false);

    // Session actors aren't allowed to get a list of channel subscribers.
    await expect(
        getChannelNotificationSubscribers(session1.action() as any, channel.id),
    ).rejects.toThrow("Session actor is not a system actor");
    await expect(
        getChannelNotificationSubscribers(session2.action() as any, channel.id),
    ).rejects.toThrow("Session actor is not a system actor");

    await expect(
        getChannelNotificationSubscribers(otherSpace.systemAction(), channel.id),
    ).rejects.toThrow("System actor doesn’t have access to channel’s space");

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session1.account.id,
    ]);

    await channel.access.revokeDefault(session1);
    await channel.access.grant(session1, session2);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session1.account.id,
    ]);

    await subscribeToChannel(session2.action(), channel.id);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(true);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual(
        [session1.account.id, session2.account.id].sort(),
    );

    await subscribeToChannel(session2.action(), channel.id);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(true);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual(
        [session1.account.id, session2.account.id].sort(),
    );

    await unsubscribeFromChannel(session2.action(), channel.id);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session1.account.id,
    ]);

    await unsubscribeFromChannel(session2.action(), channel.id);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session1.account.id,
    ]);

    await expect(subscribeToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    await expect(unsubscribeFromChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(true);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session1.account.id,
    ]);

    await unsubscribeFromChannel(session1.action(), channel.id);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(false);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([]);

    await subscribeToChannel(session2.action(), channel.id);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(false);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(true);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session2.account.id,
    ]);

    await channel.access.revoke(session1, session2);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session2.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([]);

    await expect(unsubscribeFromChannel(session2.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(false);
    await expect(isSubscribedToChannel(session2.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([]);

    await channel.access.grant(session1, session2);

    expect(await isSubscribedToChannel(session1.action(), channel.id)).toEqual(false);
    expect(await isSubscribedToChannel(session2.action(), channel.id)).toEqual(true);
    await expect(isSubscribedToChannel(session3.action(), channel.id)).rejects.toThrow(
        "Actor doesn’t have `View` access level to channel",
    );

    expect(await getChannelNotificationSubscribers(space.systemAction(), channel.id)).toEqual([
        session2.account.id,
    ]);
});

test("can only send share notification as a member of channel", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);

    await channel.access.revokeDefault(session1);
    await channel.access.grant(session1, session2);

    await expect(
        sendChannelShareNotification(session1.action(), channel.id, {
            accountIds: [session2.account.id],
            content: emptyMessageContent,
        }),
    ).resolves.toEqual(undefined);

    await expect(
        sendChannelShareNotification(session2.action(), channel.id, {
            accountIds: [session1.account.id],
            content: emptyMessageContent,
        }),
    ).resolves.toEqual(undefined);

    await expect(
        sendChannelShareNotification(session3.action(), channel.id, {
            accountIds: [session1.account.id],
            content: emptyMessageContent,
        }),
    ).rejects.toThrow("Actor doesn’t have `View` access level to channel");
});

describe("Notification subscribers", () => {
    test("throws when trying to access a post that doesn’t exist", async () => {
        const space = await TestSpace.create(context);

        await expect(
            getPostNotificationSubscribers(space.systemAction(), generateId()),
        ).rejects.toThrow(NotFoundError);
    });

    test("the post author is a subscriber of their own post", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session.account.id]));
    });

    test("can’t get notification subscribers for a post in a different space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();

        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, testContent1);

        await expect(
            getPostNotificationSubscribers(otherSpace.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("an account mentioned in the post’s content is subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(
            session1,
            assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));
    });

    test("an unknown account in the post’s content is not subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const missingAccountId = generateId<AccountId>();

        const channel = await TestChannel.create(session);
        const post = await channel.createPost(
            session,
            assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: missingAccountId,
                                isShort: false,
                            }),
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session.account.id, missingAccountId]));
    });

    test("a mentioned account from another space in the post’s content is not subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const [session1, otherSession] = await runAllPromises([
            space.createSession(),
            otherSpace.createSession(),
        ]);

        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(
            session1,
            assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: otherSession.account.id,
                                isShort: false,
                            }),
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, otherSession.account.id]));
    });

    test("an account mentioned in the post’s content is subscribed to notifications even if it is removed from the post’s content", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(
            session1,
            assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

        await updatePostContent(session1.action(), {
            postId: post.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));
    });

    test("an account mentioned in the post’s content after an update is subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(
            session1,
            assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await updatePostContent(session1.action(), {
            postId: post.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));
    });

    test("an account that comments on a post is subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(session3, testMessageContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

        await post.createComment(session3, testMessageContent2);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

        await post.createComment(session2, testMessageContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session2.account.id]));
    });

    test("an account that comments on a post is subscribed to notifications even if the comment is deleted", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(session2, testMessageContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

        await deletePostComment(session2.action(), {
            postId: post.id,
            commentIndex: 0,
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));
    });

    test("an account that is mentioned in a post comment is subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session3.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, session3.account.id]));
    });

    test("an unknown account that is mentioned in a post comment is not subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        const missingAccountId = generateId<AccountId>();

        await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: missingAccountId,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, missingAccountId]));
    });

    test("a mentioned account from another space in a post comment is not subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const [session1, session2, otherSession] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            otherSpace.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: otherSession.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, otherSession.account.id]));
    });

    test("an account that is mentioned in a post comment is subscribed to notifications even if the message is updated to remove the mention", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session3.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, session3.account.id]));

        await updatePostCommentContent(session2.action(), {
            postId: post.id,
            commentIndex: 0,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, session3.account.id]));
    });

    test("an account that is mentioned in a post comment is subscribed to notifications even if the message is deleted", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session3.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, session3.account.id]));

        await deletePostComment(session2.action(), {
            postId: post.id,
            commentIndex: 0,
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, session3.account.id]));
    });

    test("an account that is mentioned in a post comment after it is updated is subscribed to notifications", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(session1, testContent1);

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

        await updatePostCommentContent(session2.action(), {
            postId: post.id,
            commentIndex: 0,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session3.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id, session3.account.id]));
    });

    test("notification subscribers are not duplicated and can be added from many different sources", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3, session4, session5] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const channel = await TestChannel.create(session1);

        const post = await channel.createPost(
            session1,
            assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

        await post.createComment(
            session1,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

        await post.createComment(
            session3,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session1.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session2.account.id]));

        const comment = await post.createComment(
            session2,
            assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session4.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        );

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(
            new Set([
                session1.account.id,
                session3.account.id,
                session2.account.id,
                session4.account.id,
            ]),
        );

        await updatePostCommentContent(session2.action(), {
            postId: post.id,
            commentIndex: comment.index,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session5.account.id,
                                isShort: false,
                            }),
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(space.systemAction(), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(
            new Set([
                session1.account.id,
                session3.account.id,
                session2.account.id,
                session4.account.id,
                session5.account.id,
            ]),
        );
    });
});

test("creating a post with files adds to the channel’s post files", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
        ],
    });

    await channel.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
        ],
    });

    const file1 = await TestFile.create(session);

    const post2 = await channel.createPost(session, {
        files: [file1],
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 2,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post2.id,
                    files: [await file1.get()].map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });

    const file2 = await TestFile.create(session);
    const file3 = await TestFile.create(session);
    const file4 = await TestFile.create(session);

    const post3 = await channel.createPost(session, {
        files: [file2, file3, file4],
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 3,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post3.id,
                    files: (await runAllPromises([file2.get(), file3.get(), file4.get()])).map(
                        file => ({
                            signedUrlSearch: expect.any(String),
                            file,
                        }),
                    ),
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post2.id,
                    files: [await file1.get()].map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });

    const file5 = await TestFile.create(session);

    const post4 = await channel.createPost(session, {
        files: [file5, file3],
    });
    await ProcessContextModule.waitForTestTasks();

    const lastResult = await getChannelAndMetadata(session.action(), {
        channelId: channel.id,
        postFilesLimit: 100,
    });

    expect(lastResult).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 4,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post4.id,
                    files: (await runAllPromises([file5.get(), file3.get()])).map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post3.id,
                    files: (await runAllPromises([file2.get(), file3.get(), file4.get()])).map(
                        file => ({
                            signedUrlSearch: expect.any(String),
                            file,
                        }),
                    ),
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post2.id,
                    files: [await file1.get()].map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
            afterItemKey: lastResult.items[2]?.key,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: lastResult.partitionKey,
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: lastResult.items[2]?.key,
            hasNextPage: false,
        },
        items: [
            {
                key: lastResult.items[3]?.key,
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post3.id,
                    files: (await runAllPromises([file2.get(), file3.get(), file4.get()])).map(
                        file => ({
                            signedUrlSearch: expect.any(String),
                            file,
                        }),
                    ),
                }),
            },
            {
                key: lastResult.items[4]?.key,
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post2.id,
                    files: [await file1.get()].map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });
});

// eslint-disable-next-line string-quotes
test("updating a post with files changes the channel's post files", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const channel = await TestChannel.create(session);

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
        ],
    });

    const post = await channel.createPost(session, "Test");
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
        ],
    });

    const file1 = await TestFile.create(session);
    const file2 = await TestFile.create(session);

    await post.updateContent(session, {
        content: "Test",
        files: [file1, file2],
    });

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelPostFilesModel({
                    postId: post.id,
                    files: (await runAllPromises([file1.get(), file2.get()])).map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });

    const file3 = await TestFile.create(session);

    await post.updateContent(session, {
        content: "Test",
        files: [file1, file3, file2],
    });

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelPostFilesModel({
                    postId: post.id,
                    files: (await runAllPromises([file1.get(), file3.get(), file2.get()])).map(
                        file => ({
                            signedUrlSearch: expect.any(String),
                            file,
                        }),
                    ),
                }),
            },
        ],
    });

    await post.updateContent(session, {
        content: "Test",
        files: [file3, file2],
    });

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 2,
                model: new ChannelPostFilesModel({
                    postId: post.id,
                    files: (await runAllPromises([file3.get(), file2.get()])).map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });

    await post.updateContent(session, {
        content: "Test",
    });

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
        ],
    });

    const file4 = await TestFile.create(session);

    await post.updateContent(session, {
        content: "Test",
        files: [file4],
    });

    expect(
        await getChannelAndMetadata(session.action(), {
            channelId: channel.id,
            postFilesLimit: 100,
        }),
    ).toEqual({
        readTime: expect.any(Date),
        partitionKey: expect.any(String),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: expect.any(String),
                version: 0,
                model: new ChannelModel({
                    id: channel.id,
                    spaceId: space.id,
                    name: channel.initialName,
                    createdTime: expect.any(Date),
                    description: emptyMessageContentWithReferences,
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                }),
            },
            {
                key: expect.any(String),
                version: 1,
                model: new ChannelContributorsModel({
                    contributorCount: 1,
                    topContributors: [await session.get()],
                }),
            },
            {
                key: expect.any(String),
                version: 4,
                model: new ChannelPostFilesModel({
                    postId: post.id,
                    files: (await runAllPromises([file4.get()])).map(file => ({
                        signedUrlSearch: expect.any(String),
                        file,
                    })),
                }),
            },
        ],
    });
});

test("creating a channel, post, or post comment will add the actor to the contributor map", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const channel = await TestChannel.create(session1);

    const getContributors = async () => {
        const accounts = await getChannelContributors(session1.action(), channel.id, {limit: 100});
        return accounts.map(account => account.id);
    };

    expect(await getContributors()).toEqual([session1.account.id]);

    const post1 = await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([session1.account.id, session2.account.id]);

    const post2 = await channel.createPost(session3);
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session1.account.id,
        session2.account.id,
        session3.account.id,
    ]);

    await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session1.account.id,
        session3.account.id,
    ]);

    await post2.createComment(session4, "Message 1");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session1.account.id,
        session3.account.id,
        session4.account.id,
    ]);

    await post2.createComment(session4, "Message 2");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session1.account.id,
        session3.account.id,
        session4.account.id,
    ]);

    await post2.createComment(session4, "Message 3");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session1.account.id,
        session3.account.id,
        session4.account.id,
    ]);

    await post2.createComment(session4, "Message 4");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session1.account.id,
        session3.account.id,
        session4.account.id,
    ]);

    await post1.createComment(session4, "Message 5");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session4.account.id,
        session1.account.id,
        session3.account.id,
    ]);

    await post1.createComment(session4, "Message 6");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session4.account.id,
        session1.account.id,
        session3.account.id,
    ]);

    await post2.createComment(session3, "Message 7");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session4.account.id,
        session1.account.id,
        session3.account.id,
    ]);

    await post1.createComment(session3, "Message 8");
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session3.account.id,
        session4.account.id,
        session1.account.id,
    ]);

    await channel.createPost(session4);
    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session4.account.id,
        session2.account.id,
        session3.account.id,
        session1.account.id,
    ]);

    // Test that after we reach the max contribution count we don't increment the
    // contribution map anymore.
    for (let i = 0; i < 10; i++) {
        await channel.createPost(session2);
        await channel.createPost(session4);
    }

    await channel.createPost(session4);
    await channel.createPost(session4);
    await channel.createPost(session4);

    await ProcessContextModule.waitForTestTasks();

    expect(await getContributors()).toEqual([
        session2.account.id,
        session4.account.id,
        session3.account.id,
        session1.account.id,
    ]);
});
