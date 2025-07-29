import {Node} from "prosemirror-model";
import {
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InternalError} from "~/shared/error/error.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";

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

    protected abstract _createMessage(
        context: TestSessionActionContext,
        options: {
            parentMessageIndex: number | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
        },
    ): Promise<{index: number; createdTime: Date}>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _updateMessageContent(
        context: TestSessionActionContext,
        options: {
            messageIndex: number;
            content: MessageContent;
        },
    ): Promise<{contentUpdatedTime: Date}>;

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

    protected async _actuallyCreateMessage(
        session: TestSession,
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

        const {index, createdTime} = await this._createMessage(session.action(), {
            parentMessageIndex: parent?.index ?? null,
            content:
                typeof content === "string"
                    ? createSimpleMessageContent(content)
                    : assertMessageContent(content),
            fileIds: files
                ? Array.from(files, file => (typeof file === "string" ? file : file.id))
                : [],
        });

        return TestMessage._new(this.context, this.space, this, index, createdTime);
    }
}

export abstract class TestMessageRoomBase extends TestMessagingRoomBase {
    public sendMessage(
        session: TestSession,
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

    public updateContent(session: TestSession, content: string | MessageContent) {
        return this.room._updateMessageContent(session.action(), {
            messageIndex: this.index,
            content: typeof content === "string" ? createSimpleMessageContent(content) : content,
        });
    }

    public delete(session: TestSession) {
        return this.room._deleteMessage(session.action(), {messageIndex: this.index});
    }
}
