import {Node, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {
    TestAccountActionContext,
    TestActionContext,
    TestBotActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {Reaction, ReactionEmotion} from "~/shared/reactions/reaction.js";

const testMessageCountByConstructor = new DefaultMap<
    typeof TestMessagingRoomBase,
    {current: number}
>(() => ({current: 1}));

type TestMessagingRoomCreateMessageOptions = {
    parent?: TestMessage | MessageContentPayloadParent;
    files?: Iterable<TestFile | FileId>;
    createdTimeZone?: TimeZone;
    overrideCreatedTime?: Date;
    isStream?: boolean;
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
            createdTimeZone?: TimeZone;
            overrideCreatedTimeForTest?: Date;
            isStream?: boolean;
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
            contentVersion: number;
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

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _putMessageStreamPart(
        context: TestBotActionContext,
        options: {
            messageIndex: number;
            partIndex: number;
            payload: MessageStreamPartPayload;
        },
    ): Promise<void>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _completeMessageStream(
        context: TestBotActionContext,
        options: {messageIndex: number},
    ): Promise<void>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _setMessageReaction(
        context: ServerSessionActionContextWithPush,
        options: {
            messageIndex: number;
            contentVersion: number;
            pos: number;
            reaction: Reaction | "GenericLike";
        },
    ): Promise<void>;

    // Public so that we can call from `TestMessage`. Shouldn't be called outside
    // of this file.
    public abstract _deleteMessageReaction(
        context: ServerSessionActionContext,
        options: {
            messageIndex: number;
            contentVersion: number;
            pos: number;
        },
    ): Promise<void>;

    public static createDefaultMessageContent() {
        return `Test ${this._getMessageNoun()} ${testMessageCountByConstructor.getOrSetDefault(this)
            .current++}`;
    }

    // Static method so you can't call `post.createMessage()`, you must call
    // `post.createComment()`. However, for code working generically on any room
    // that code can call `TestMessagingRoomBase.createMessage(room)`.
    public static createMessage<Room extends TestMessagingRoomBase>(
        room: Room,
        session: TestSession | TestBotAccount | TestAccountActionContext,
        content?: string | Node | {isStream: true},
        options?: TestMessagingRoomCreateMessageOptions,
    ): Promise<TestMessage<Room>> {
        return room._actuallyCreateMessage(session, content, options);
    }

    protected async _actuallyCreateMessage(
        session: TestSession | TestBotAccount | TestAccountActionContext,
        content: string | Node | {isStream: true} = (
            this.constructor as typeof TestMessagingRoomBase
        ).createDefaultMessageContent(),
        {
            parent,
            files,
            createdTimeZone,
            overrideCreatedTime,
            isStream,
        }: TestMessagingRoomCreateMessageOptions = {},
    ): Promise<TestMessage<this>> {
        if (parent instanceof TestMessage) {
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
                parent:
                    parent instanceof TestMessage
                        ? {type: "Message", index: parent.index}
                        : parent ?? null,
                content:
                    typeof content === "string"
                        ? parseTestMessageContent(this.space.id, content)
                        : content instanceof Node
                        ? assertMessageContent(content)
                        : createSimpleMessageContent(""),
                fileIds: files
                    ? Array.from(files, file => (typeof file === "string" ? file : file.id))
                    : [],
                createdTimeZone,
                overrideCreatedTimeForTest: overrideCreatedTime,
                isStream:
                    isStream ||
                    (typeof content !== "string" &&
                        "isStream" in content &&
                        content.isStream === true),
            },
        );

        const author: TestAccount =
            session instanceof TestSession
                ? session.account
                : session instanceof TestAccount
                ? session
                : await TestAccount.get(this.context, session.actor.getPossiblyBotAccountId());

        return TestMessage._new(this.context, this.space, author, this, index, createdTime);
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
    public readonly author: TestAccount;
    public readonly room: Room;
    public readonly index: number;
    public readonly createdTime: Date;

    private constructor(
        context: TestContext,
        space: TestSpace,
        author: TestAccount,
        room: Room,
        index: number,
        createdTime: Date,
    ) {
        this.context = context;
        this.space = space;
        this.author = author;
        this.room = room;
        this.index = index;
        this.createdTime = createdTime;
    }

    // Public so we can call this function from `TestMessagingRoomBase`. Shouldn't
    // be called outside of this file.
    public static _new<Room extends TestMessagingRoomBase>(
        context: TestContext,
        space: TestSpace,
        author: TestAccount,
        room: Room,
        index: number,
        createdTime: Date,
    ) {
        return new TestMessage(context, space, author, room, index, createdTime);
    }

    public async get() {
        return this.room._getMessage(this.space.systemAction(), this.index);
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
            contentVersion: message.payload.contentUpdate?.mappings.length ?? 0,
            steps: [
                new ReplaceStep(
                    0,
                    message.payload.content.doc.content.size,
                    new Slice(
                        (typeof content === "string"
                            ? parseTestMessageContent(this.space.id, content)
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

    public putStreamPart(
        context: TestBotActionContext,
        partIndex: number,
        payload: string | Node | MessageStreamPartPayload,
    ) {
        return this.room._putMessageStreamPart(context, {
            messageIndex: this.index,
            partIndex,
            payload:
                typeof payload === "string"
                    ? {type: "Content", content: parseTestMessageContent(this.space.id, payload)}
                    : payload instanceof Node
                    ? {type: "Content", content: assertMessageContent(payload)}
                    : payload,
        });
    }

    public completeStream(context: TestBotActionContext) {
        return this.room._completeMessageStream(context, {messageIndex: this.index});
    }

    public async setReaction(
        session: TestSession,
        reaction: Reaction | "GenericLike" | ReactionEmotion = "GenericLike",
    ) {
        const message = await this.room._getMessage(
            // Use a system action since if there's a `PermissionDeniedError` we want it
            // thrown from `_setMessageReaction()` instead of `_getMessage()`.
            this.space.systemAction(),
            this.index,
        );

        assert(message.payload.type === "Content");

        return this.room._setMessageReaction(
            session.action().clone({
                apns: new TestApnsContextModule(),
                webPush: new TestWebPushContextModule(),
            }),
            {
                messageIndex: this.index,
                contentVersion: message.payload.contentUpdate?.mappings.length ?? 0,
                pos: message.payload.content.doc.content.size,
                reaction:
                    reaction === "GenericLike" || isObject(reaction)
                        ? reaction
                        : {
                              character: await session.getReactionCharacter(),
                              emotion: reaction,
                          },
            },
        );
    }

    public async deleteReaction(session: TestSession) {
        const message = await this.room._getMessage(
            // Use a system action since if there's a `PermissionDeniedError` we want it
            // thrown from `_setMessageReaction()` instead of `_getMessage()`.
            this.space.systemAction(),
            this.index,
        );

        assert(message.payload.type === "Content");

        return this.room._deleteMessageReaction(session.action(), {
            messageIndex: this.index,
            contentVersion: message.payload.contentUpdate?.mappings.length ?? 0,
            pos: message.payload.content.doc.content.size,
        });
    }
}

export function parseTestMessageContent(spaceId: SpaceId, content: string): MessageContent {
    const apiContent = parseApiContentFromMarkdown(content, {spaceId});
    return assertMessageContent(fromApiContent(MessageContentProsemirrorSchema, apiContent));
}
