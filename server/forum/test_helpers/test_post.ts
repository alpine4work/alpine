import {Node, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {createOrReplacePostDraft} from "~/server/forum/data/create_or_replace_post_draft.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {deletePostReaction} from "~/server/forum/data/delete_post_reaction.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getPost} from "~/server/forum/data/get_post.js";
import {getPostContentAndChannelPreview} from "~/server/forum/data/get_post_content_and_channel_preview.js";
import {
    completePostCommentStream,
    createPostComment,
    deletePostComment,
    deletePostCommentReaction,
    getPostComment,
    putPostCommentStreamPart,
    setPostCommentReaction,
    updatePostCommentContent,
} from "~/server/forum/data/post_messaging.js";
import {setPostReaction} from "~/server/forum/data/set_post_reaction.js";
import {updatePostContent} from "~/server/forum/data/update_post_content.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestCommentRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {
    TestAccountActionContext,
    TestBotActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    PostContent,
    PostContentProsemirrorSchema,
    assertPostContent,
    emptyPostContent,
} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId, PostDraftId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    MessageContentPayloadParent,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {Reaction, ReactionEmotion} from "~/shared/reactions/reaction.js";

let testPostCount = 1;

export type TestPostCreateOptions = {
    id?: PostId;
    files?: ReadonlyArray<TestFile>;
    attachFiles?: ReadonlyArray<TestFile>;
    overrideCreatedTime?: Date;
};

export class TestPost extends TestCommentRoomBase {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly author: TestAccount;
    public readonly id: PostId;
    public readonly createdTime: Date;
    // NOTE(calebmer, 2024-11-01): We haven't implemented moving a post between
    // channels but we intend to. Which is why this is called `initialChannel`
    // instead of `channel`.
    public readonly initialChannel: TestChannel;

    private constructor(
        context: TestContext,
        space: TestSpace,
        author: TestAccount,
        id: PostId,
        createdTime: Date,
        initialChannel: TestChannel,
    ) {
        super();
        this.context = context;
        this.space = space;
        this.author = author;
        this.id = id;
        this.createdTime = createdTime;
        this.initialChannel = initialChannel;
    }

    // Starts with an underscore since you should prefer calling
    // `channel.createPost()` to `TestPost._create()`.
    public static async _create(
        session: TestSpaceSession,
        channel: TestChannel,
        content: Node | string,
        options?: TestPostCreateOptions,
    ): Promise<TestPost>;
    public static async _create(
        session: TestSpaceSession,
        channel: TestChannel,
        options?: TestPostCreateOptions,
    ): Promise<TestPost>;
    public static async _create(
        session: TestSpaceSession,
        channel: TestChannel,
        contentOrOptions?: Node | string | TestPostCreateOptions,
        options?: TestPostCreateOptions,
    ): Promise<TestPost> {
        let content: Node | string =
            typeof contentOrOptions === "string" || contentOrOptions instanceof Node
                ? contentOrOptions
                : `Test Post ${testPostCount++}`;

        const {
            id: postId,
            files = emptyArray,
            attachFiles: originalAttachFiles = emptyArray,
        } = options ??
        (typeof contentOrOptions !== "string" && !(contentOrOptions instanceof Node)
            ? contentOrOptions
            : null) ??
        {};

        if (typeof content === "string") {
            content = parsePostTestContent(session.space.id, content);
        }

        const attachFiles =
            files.length !== 0
                ? originalAttachFiles.length !== 0
                    ? [...files, ...originalAttachFiles]
                    : files
                : originalAttachFiles;

        // Add any `files` to the end of our post content.
        if (files.length > 0) {
            const fileIdsByRow: Array<Array<FileId>> = [[]];

            for (const file of files) {
                if (fileIdsByRow[fileIdsByRow.length - 1]!.length < 3) {
                    fileIdsByRow[fileIdsByRow.length - 1]!.push(file.id);
                } else {
                    fileIdsByRow.push([file.id]);
                }
            }

            content = assertPostContent(
                PostContentProsemirrorSchema.node("doc", content.attrs, [
                    ...content.content.content,
                    ...fileIdsByRow.map(fileIds =>
                        PostContentProsemirrorSchema.node(
                            "fileRow",
                            {},
                            fileIds.map(fileId =>
                                PostContentProsemirrorSchema.node("file", {fileId}),
                            ),
                        ),
                    ),
                ]),
            );
        }

        // To create a post with files we first need to create a draft and attach all
        // files to that draft. Then we create the post using the draft which will move
        // any attachments from the draft to the post.
        let draftId: PostDraftId | null = null;
        if (attachFiles.length > 0) {
            draftId = generateChronologicalId<PostDraftId>();

            await createOrReplacePostDraft(
                session.action(),
                session.space.id,
                session.account.id,
                draftId,
                {
                    channelId: channel.id,
                    content: emptyPostContent,
                },
            );

            await runAllPromises(
                attachFiles.map(file =>
                    file.attach(
                        session,
                        FilePostAuthorizer.bind({
                            type: "PostDraft",
                            accountId: session.account.id,
                            draftId: draftId!,
                        }),
                    ),
                ),
            );
        }

        const post = await createPost(session.action(), {
            id: postId,
            channelId: channel.id,
            createdTimeZone: defaultTimeZone,
            draftId,
            content: assertPostContent(content),
            overrideCreatedTimeForTest: options?.overrideCreatedTime,
        });

        return new TestPost(
            session.context,
            session.space,
            session.account,
            post.id,
            post.createdTime,
            channel,
        );
    }

    protected override _getRoomKey() {
        return this.id;
    }

    public override getBotScope(): BotTokenPayloadScope {
        return {type: "Post", postId: this.id};
    }

    public override _getMessage(context: TestSessionActionContext, messageIndex: number) {
        return getPostComment(context, {
            postId: this.id,
            commentIndex: messageIndex,
        });
    }

    protected override _createMessage(
        context: TestAccountActionContext,
        {
            parent,
            content,
            fileIds,
            createdTimeZone,
            overrideCreatedTimeForTest,
            isStream,
        }: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
            createdTimeZone?: TimeZone;
            overrideCreatedTimeForTest?: Date;
            isStream?: boolean;
        },
    ) {
        return createPostComment(context, {
            postId: this.id,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
            overrideCreatedTimeForTest,
        });
    }

    public override _updateMessageContent(
        context: TestSessionActionContext,
        {
            messageIndex,
            contentVersion,
            steps,
        }: {
            messageIndex: number;
            contentVersion: number;
            steps: ReadonlyArray<Step>;
        },
    ) {
        return updatePostCommentContent(context, {
            postId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            steps,
        });
    }

    public override _deleteMessage(
        context: TestSessionActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        return deletePostComment(context, {
            postId: this.id,
            commentIndex: messageIndex,
        });
    }

    public override async _putMessageStreamPart(
        context: TestBotActionContext,
        {
            messageIndex,
            partIndex,
            payload,
        }: {
            messageIndex: number;
            partIndex: number;
            payload: MessageStreamPartPayload;
        },
    ) {
        await putPostCommentStreamPart(context, {
            postId: this.id,
            commentIndex: messageIndex,
            partIndex,
            payload,
        });
    }

    public override async _completeMessageStream(
        context: TestBotActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        await completePostCommentStream(context, {
            postId: this.id,
            commentIndex: messageIndex,
        });
    }

    public override async _setMessageReaction(
        context: ServerSessionActionContextWithPush,
        {
            messageIndex,
            contentVersion,
            pos,
            reaction,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
            reaction: Reaction | "GenericLike";
        },
    ) {
        await setPostCommentReaction(context, {
            postId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            pos,
            reaction,
        });
    }

    public override async _deleteMessageReaction(
        context: ServerSessionActionContext,
        {
            messageIndex,
            contentVersion,
            pos,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
        },
    ) {
        await deletePostCommentReaction(context, {
            postId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            pos,
        });
    }

    public async get(): Promise<PostModel> {
        return (await getPost(this.space.systemAction(), this.id)).model;
    }

    public async getRealtime(): Promise<DynamoGeneralRealtimeItem<PostModel>> {
        return await getPost(this.space.systemAction(), this.id);
    }

    public async updateContent(
        session: TestSpaceSession,
        options:
            | Node
            | string
            | {
                  content: Node | string;
                  files?: ReadonlyArray<TestFile>;
                  attachFiles?: ReadonlyArray<TestFile>;
              },
    ) {
        let {
            content,
            files,
            attachFiles: originalAttachFiles,
        } = typeof options === "string" || options instanceof Node ? {content: options} : options;

        files ??= emptyArray;
        originalAttachFiles ??= emptyArray;

        const post = await getPostContentAndChannelPreview(
            // Use a system action since if there's a `PermissionDeniedError` we want it
            // thrown from `updatePostContent()` instead of here.
            this.space.systemAction(),
            this.id,
        );

        if (typeof content === "string") {
            content = parsePostTestContent(this.space.id, content);
        }

        const attachFiles =
            files.length !== 0
                ? originalAttachFiles.length !== 0
                    ? [...files, ...originalAttachFiles]
                    : files
                : originalAttachFiles;

        // Add any `files` to the end of our post content.
        if (files.length > 0) {
            const fileIdsByRow: Array<Array<FileId>> = [[]];

            for (const file of files) {
                if (fileIdsByRow[fileIdsByRow.length - 1]!.length < 3) {
                    fileIdsByRow[fileIdsByRow.length - 1]!.push(file.id);
                } else {
                    fileIdsByRow.push([file.id]);
                }
            }

            content = assertPostContent(
                PostContentProsemirrorSchema.node("doc", content.attrs, [
                    ...content.content.content,
                    ...fileIdsByRow.map(fileIds =>
                        PostContentProsemirrorSchema.node(
                            "fileRow",
                            {},
                            fileIds.map(fileId =>
                                PostContentProsemirrorSchema.node("file", {fileId}),
                            ),
                        ),
                    ),
                ]),
            );
        }

        if (attachFiles.length > 0) {
            await runAllPromises(
                attachFiles.map(file =>
                    file.attach(
                        session,
                        FilePostAuthorizer.bind({
                            type: "Post",
                            postId: this.id,
                        }),
                    ),
                ),
            );
        }

        await updatePostContent(session.action(), {
            postId: this.id,
            contentVersion: post.contentUpdate?.mappings.length ?? 0,
            steps: [
                new ReplaceStep(0, post.content.content.size, new Slice(content.content, 0, 0)),
            ],
        });
    }

    public async setReaction(
        session: TestSession,
        reaction: Reaction | "GenericLike" | ReactionEmotion = "GenericLike",
    ) {
        return setPostReaction(
            session.action().clone({
                apns: new TestApnsContextModule(),
                webPush: new TestWebPushContextModule(),
            }),
            this.id,
            reaction === "GenericLike" || isObject(reaction)
                ? reaction
                : {
                      character: await session.getReactionCharacter(),
                      emotion: reaction,
                  },
        );
    }

    public async deleteReaction(session: TestSession) {
        return deletePostReaction(session.action(), this.id);
    }
}

function parsePostTestContent(spaceId: SpaceId, content: string): PostContent {
    const apiContent = parseApiContentFromMarkdown(content, {spaceId});
    return assertPostContent(fromApiContent(PostContentProsemirrorSchema, apiContent));
}
