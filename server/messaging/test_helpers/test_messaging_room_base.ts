import {Node, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {
    TestAccountActionContext,
    TestActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
} from "~/shared/messaging/message_schema.js";

const testMessageCountByConstructor = new DefaultMap<
    typeof TestMessagingRoomBase,
    {current: number}
>(() => ({current: 1}));

type TestMessagingRoomCreateMessageOptions = {
    parent?: TestMessage;
    files?: Iterable<TestFile | FileId>;
};

export abstract class TestMessagingRoomBase {
    public abstract readonly context: TestContext;
    public abstract readonly space: TestSpace;

    protected static _getMessageNoun(): string {
        return "message";
    }

    protected abstract _getRoomKey(): string;

    /**
     * All messaging rooms must also have valid bot scopes. Since you should be
     * able to send/receive messages as a bot scoped to that room.
     */
    public abstract getBotScope(): BotTokenPayloadScope;

    protected abstract _createMessage(
        context: TestAccountActionContext,
        options: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
        },
    ): Promise<{index: number; createdTime: Date}>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _getMessage(
        context: TestActionContext,
        messageIndex: number,
    ): Promise<MessageModel>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _updateMessageContent(
        context: TestSessionActionContext,
        options: {
            messageIndex: number;
            version: number;
            steps: ReadonlyArray<Step>;
        },
    ): Promise<{
        content: MessageContent;
        contentUpdate: MessageContentPayloadContentUpdate;
    }>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _deleteMessage(
        context: TestSessionActionContext,
        options: {messageIndex: number},
    ): Promise<{deletedTime: Date}>;

    public static createDefaultMessageContent() {
        return `Test ${this._getMessageNoun()} ${testMessageCountByConstructor.getOrSetDefault(this)
            .current++}`;
    }

    // Static method so you can't call `post.createMessage()`, you must call
    // `post.createComment()`. However, for code working generically on any room
    // that code can call `TestMessagingRoomBase.createMessage(room)`.
    public static createMessage(
        room: TestMessagingRoomBase,
        session: TestSession | TestBotAccount | TestAccountActionContext,
        content?: string | Node,
        options?: TestMessagingRoomCreateMessageOptions,
    ) {
        return room._actuallyCreateMessage(session, content, options);
    }

    protected async _actuallyCreateMessage(
        session: TestSession | TestBotAccount | TestAccountActionContext,
        content: string | Node = (
            this.constructor as typeof TestMessagingRoomBase
        ).createDefaultMessageContent(),
        {parent, files}: TestMessagingRoomCreateMessageOptions = {},
    ): Promise<TestMessage<this>> {
        if (parent) {
            const roomKey = this._getRoomKey();
            const parentRoomKey = parent.room._getRoomKey();

            if (roomKey !== parentRoomKey) {
                throw new InternalError(
                    quote`Expected parent message to be in the messaging room ${roomKey} but it was actually in the messaging room ${parentRoomKey}`,
                );
            }
        }

        const {index, createdTime} = await this._createMessage(
            "action" in session ? session.action() : session,
            {
                parent: parent ? {type: "Message", index: parent.index} : null,
                content:
                    typeof content === "string"
                        ? createSimpleMessageContent(content)
                        : assertMessageContent(content),
                fileIds: files
                    ? Array.from(files, file => (typeof file === "string" ? file : file.id))
                    : [],
            },
        );

        return TestMessage._new(this.context, this.space, this, index, createdTime);
    }
}

export abstract class TestMessageRoomBase extends TestMessagingRoomBase {
    public sendMessage(
        session: TestSession | TestBotAccount | TestAccountActionContext,
        content?: string | Node,
        options?: TestMessagingRoomCreateMessageOptions,
    ) {
        return this._actuallyCreateMessage(session, content, options);
    }
}

export abstract class TestCommentRoomBase extends TestMessageRoomBase {
    protected static override _getMessageNoun(): string {
        return "comment";
    }

    public createComment(
        session: TestSession,
        content?: string | Node,
        options?: TestMessagingRoomCreateMessageOptions,
    ) {
        return this._actuallyCreateMessage(session, content, options);
    }
}

export class TestMessage<Room extends TestMessagingRoomBase = TestMessagingRoomBase> {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly room: Room;
    public readonly index: number;
    public readonly createdTime: Date;

    private constructor(
        context: TestContext,
        space: TestSpace,
        room: Room,
        index: number,
        createdTime: Date,
    ) {
        this.context = context;
        this.space = space;
        this.room = room;
        this.index = index;
        this.createdTime = createdTime;
    }

    // Public so we can call this function from `TestMessagingRoomBase`. Shouldn't
    // be called outside of this file.
    public static _new<Room extends TestMessagingRoomBase>(
        context: TestContext,
        space: TestSpace,
        room: Room,
        index: number,
        createdTime: Date,
    ) {
        return new TestMessage(context, space, room, index, createdTime);
    }

    public async updateContent(session: TestSession, content: string | Node) {
        const message = await this.room._getMessage(
            // Use a system action since if there's a `PermissionDeniedError` we want it
            // thrown from `_updateMessageContent()` instead of `_getMessage()`.
            this.space.systemAction(),
            this.index,
        );

        assert(message.payload.type === "Content");

        return this.room._updateMessageContent(session.action(), {
            messageIndex: this.index,
            version: message.payload.contentUpdate?.mappings.length ?? 0,
            steps: [
                new ReplaceStep(
                    0,
                    message.payload.content.doc.content.size,
                    new Slice(
                        (typeof content === "string"
                            ? createSimpleMessageContent(content)
                            : assertMessageContent(content)
                        ).content,
                        0,
                        0,
                    ),
                ),
            ],
        });
    }

    public delete(session: TestSession) {
        return this.room._deleteMessage(session.action(), {messageIndex: this.index});
    }
}
