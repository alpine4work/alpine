import {Node} from "prosemirror-model";
import {
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {
    FilePostAuthorizer,
    createOrReplacePostDraft,
    createPost,
    createPostComment,
    deletePostComment,
    getPost,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_actions.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestCommentRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    PostContent,
    PostContentProsemirrorSchema,
    assertPostContent,
    createSimplePostContent,
    emptyPostContent,
} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId, PostDraftId, PostId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";

let testPostCount = 1;

export type TestPostCreateOptions = {
    id?: PostId;
    files?: ReadonlyArray<TestFile>;
    attachFiles?: ReadonlyArray<TestFile>;
};

export class TestPost extends TestCommentRoomBase {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: PostId;
    public readonly createdTime: Date;
    // NOTE(calebmer, 2024-11-01): We haven't implemented moving a post between
    // channels but we intend to. Which is why this is called `initialChannel`
    // instead of `channel`.
    public readonly initialChannel: TestChannel;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: PostId,
        createdTime: Date,
        initialChannel: TestChannel,
    ) {
        super();
        this.context = context;
        this.space = space;
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
            content = createSimplePostContent(content);
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
            draftId,
            content: assertPostContent(content),
        });

        return new TestPost(session.context, session.space, post.id, post.createdTime, channel);
    }

    protected override _getRoomKey() {
        return this.id;
    }

    protected override _createMessage(
        context: TestSessionActionContext,
        {
            parentMessageIndex,
            content,
            fileIds,
        }: {
            parentMessageIndex: number | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
        },
    ) {
        return createPostComment(context, {
            postId: this.id,
            parentCommentIndex: parentMessageIndex,
            content,
            fileIds,
        });
    }

    public override _updateMessageContent(
        context: TestSessionActionContext,
        {messageIndex, content}: {messageIndex: number; content: MessageContent},
    ) {
        return updatePostCommentContent(context, {
            postId: this.id,
            commentIndex: messageIndex,
            content,
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

    public async get(): Promise<PostModel> {
        return (await getPost(this.space.systemAction(), this.id)).model;
    }

    public async getRealtime(): Promise<DynamoGeneralRealtimeItem<PostModel>> {
        return await getPost(this.space.systemAction(), this.id);
    }

    public async updateContent(
        session: TestSpaceSession,
        {
            content,
            files = emptyArray,
            attachFiles: originalAttachFiles = emptyArray,
        }: {
            content: PostContent | string;
            files?: ReadonlyArray<TestFile>;
            attachFiles?: ReadonlyArray<TestFile>;
        },
    ) {
        if (typeof content === "string") {
            content = createSimplePostContent(content);
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
            content,
        });
    }
}
