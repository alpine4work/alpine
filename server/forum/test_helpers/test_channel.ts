import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createChannel, getChannel, getChannelPreview} from "~/server/forum/data/forum_table.js";
import {TestPost, TestPostCreateOptions} from "~/server/forum/test_helpers/test_post.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";

let testChannelCount = 1;

export class TestChannel {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: ChannelId;
    public readonly createdTime: Date;
    public readonly initialName: string;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: ChannelId,
        createdTime: Date,
        initialName: string,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
        this.initialName = initialName;
    }

    public static async create(
        session: TestSpaceSession,
        {
            id = generateId<ChannelId>(),
            name = `Test Channel ${testChannelCount++}`,
            description,
        }: {
            id?: ChannelId;
            name?: string;
            description?: string | MessageContent;
        } = {},
    ): Promise<TestChannel> {
        const channel = await createChannel(session.action(), {
            spaceId: session.space.id,
            channelId: id,
            name,
            description:
                typeof description === "string"
                    ? createSimpleMessageContent(description)
                    : description,
        });

        return new TestChannel(
            session.context,
            session.space,
            channel.id,
            channel.createdTime,
            name,
        );
    }

    public async get(): Promise<ChannelModel> {
        return (await getChannel(this.space.systemAction(), this.id)).model;
    }

    public async getPreview(): Promise<ChannelPreviewModel> {
        return await getChannelPreview(this.space.systemAction(), this.id);
    }

    public createPost(
        session: TestSpaceSession,
        content: PostContent | string,
        options?: TestPostCreateOptions,
    ): Promise<TestPost>;
    public createPost(
        session: TestSpaceSession,
        options?: TestPostCreateOptions,
    ): Promise<TestPost>;
    public createPost(
        session: TestSpaceSession,
        contentOrOptions?: PostContent | string | TestPostCreateOptions,
        options?: TestPostCreateOptions,
    ): Promise<TestPost> {
        return TestPost._create(session, this, contentOrOptions as any, options);
    }
}
