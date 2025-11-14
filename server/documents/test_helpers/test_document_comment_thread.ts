import {Node} from "prosemirror-model";
import {AddMarkStep, AddNodeMarkStep, Step} from "prosemirror-transform";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithApns} from "~/server/context/server_session_action_context_with_apns.js";
import {
    completeDocumentCommentStream,
    createDocumentComment,
    deleteDocumentComment,
    deleteDocumentCommentReaction,
    getDocumentComment,
    getDocumentCommentThread,
    getResolvedDocumentCommentThreadRanges,
    putDocumentCommentStreamPart,
    setDocumentCommentReaction,
    updateDocumentCommentContent,
} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {
    TestAccountActionContext,
    TestBotActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestCommentRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {encodeDocumentCommentRoomKey} from "~/shared/documents/document_model.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    MessageContentPayloadParent,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {Reaction} from "~/shared/reactions/reaction.js";

const schema = DocumentContentProsemirrorSchema;

export class TestDocumentCommentThread extends TestCommentRoomBase {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly firstCommentAuthor: TestAccount;
    public readonly document: TestDocument;
    public readonly id: DocumentCommentThreadId;
    public readonly createdTime: Date;

    private constructor(
        context: TestContext,
        document: TestDocument,
        firstCommentAuthor: TestAccount,
        id: DocumentCommentThreadId,
        createdTime: Date,
    ) {
        super();
        this.context = context;
        this.space = document.space;
        this.document = document;
        this.firstCommentAuthor = firstCommentAuthor;
        this.id = id;
        this.createdTime = createdTime;
    }

    // Starts with an underscore since you should prefer calling
    // `document.createCommentThread()` to `TestDocumentCommentThread._create()`.
    public static async _create(
        document: TestDocument,
        session: TestSpaceSession,
        range: {isNode?: false; from: number; to: number} | {isNode: true; pos: number},
        content: string | Node,
    ) {
        const id = generateId<DocumentCommentThreadId>();
        const createdTime = new Date();

        await document.update(
            session,
            [
                range.isNode
                    ? new AddNodeMarkStep(
                          range.pos,
                          schema.marks.comment.create({commentThreadId: id}),
                      )
                    : new AddMarkStep(
                          range.from,
                          range.to,
                          schema.marks.comment.create({commentThreadId: id}),
                      ),
            ],
            {
                createCommentThreads: [
                    {
                        commentThreadId: id,
                        initialCommentContent:
                            typeof content === "string"
                                ? createSimpleMessageContent(content)
                                : assertMessageContent(content),
                        initialCommentFileIds: [],
                        createdTime,
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            },
        );

        return new TestDocumentCommentThread(
            session.context,
            document,
            session.account,
            id,
            createdTime,
        );
    }

    protected override _getRoomKey() {
        return encodeDocumentCommentRoomKey(this.document.id, this.id);
    }

    public override getBotScope(): BotTokenPayloadScope {
        return {type: "Document", documentId: this.document.id};
    }

    public override _getMessage(context: TestSessionActionContext, messageIndex: number) {
        return getDocumentComment(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
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
            isStream,
        }: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
            createdTimeZone?: TimeZone;
            isStream?: boolean;
        },
    ) {
        return createDocumentComment(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
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
        return updateDocumentCommentContent(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            steps,
        });
    }

    public override _deleteMessage(
        context: TestSessionActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        return deleteDocumentComment(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
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
        await putDocumentCommentStreamPart(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            commentIndex: messageIndex,
            partIndex,
            payload,
        });
    }

    public override async _completeMessageStream(
        context: TestBotActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        await completeDocumentCommentStream(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            commentIndex: messageIndex,
        });
    }

    public override async _setMessageReaction(
        context: ServerSessionActionContextWithApns,
        {
            messageIndex,
            contentVersion,
            pos,
            reaction,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number;
            reaction: Reaction | "GenericLike";
        },
    ) {
        await setDocumentCommentReaction(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
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
            pos: number;
        },
    ) {
        await deleteDocumentCommentReaction(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            pos,
        });
    }

    public async get() {
        return getDocumentCommentThread(this.space.systemAction(), {
            documentId: this.document.id,
            commentThreadId: this.id,
        });
    }

    public async resolve(session: TestSpaceSession) {
        await this.document.update(
            session,
            [new RemoveAllMarksStep(schema.marks.comment.create({commentThreadId: this.id}))],
            {resolveCommentThreadIds: [this.id]},
        );
    }

    public async unresolve(session: TestSpaceSession) {
        const {version, ranges} = await getResolvedDocumentCommentThreadRanges(session.action(), {
            documentId: this.document.id,
            commentThreadId: this.id,
        });

        await this.document.update(
            session,
            [
                new AddMarksAfterRemoveAllStep(
                    schema.marks.comment.create({commentThreadId: this.id}),
                    ranges,
                ),
            ],
            {versionOverride: version, unresolveCommentThreadIds: [this.id]},
        );
    }
}
