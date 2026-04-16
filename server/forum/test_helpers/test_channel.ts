import {Node} from "prosemirror-model";
import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {getChannel} from "~/server/forum/data/get_channel.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {
    subscribeToChannel,
    unsubscribeFromChannel,
} from "~/server/forum/data/subscribe_to_channel.js";
import {updateChannelAccessPolicy} from "~/server/forum/data/update_channel_access_policy.js";
import {TestPost, TestPostCreateOptions} from "~/server/forum/test_helpers/test_post.js";
import {parseTestMessageContent} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

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
            access,
        }: {
            id?: ChannelId;
            name?: string;
            description?: string | MessageContent;
            access?: "Public" | "Private" | AccessPolicy;
        } = {},
    ): Promise<TestChannel> {
        let accessPolicy: AccessPolicy;
        if (access === "Public" || access === undefined) {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: null,
            };
        } else if (access === "Private") {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            };
        } else {
            accessPolicy = access;
        }

        const channel = await createChannel(session.action(), {
            spaceId: session.space.id,
            channelId: id,
            name,
            description:
                typeof description === "string"
                    ? parseTestMessageContent(session.space.id, description)
                    : description,
            accessPolicy,
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

    public readonly access = new TestAccessPolicy({
        get: async () => {
            const channel = await getChannelPreview(
                this.context.systemAction(this.space.id),
                this.id,
            );
            return channel.accessPolicy.intoAccessPolicy();
        },
        set: async (session, accessPolicy) => {
            await updateChannelAccessPolicy(session.action(), {
                channelId: this.id,
                accessPolicy,
                notification: null,
            });
        },
    });

    public createPost(
        session: TestSession | TestBotAccount,
        content: Node | string,
        options?: TestPostCreateOptions,
    ): Promise<TestPost>;
    public createPost(
        session: TestSession | TestBotAccount,
        options?: TestPostCreateOptions,
    ): Promise<TestPost>;
    public createPost(
        session: TestSession | TestBotAccount,
        contentOrOptions?: Node | string | TestPostCreateOptions,
        options?: TestPostCreateOptions,
    ): Promise<TestPost> {
        return TestPost._create(session, this, contentOrOptions as any, options);
    }

    public async subscribe(session: TestSpaceSession) {
        await subscribeToChannel(session.action(), this.id);
    }

    public async unsubscribe(session: TestSpaceSession) {
        await unsubscribeFromChannel(session.action(), this.id);
    }
}
