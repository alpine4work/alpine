import {AddMarkStep, AddNodeMarkStep, Step} from "prosemirror-transform";
import {
    createDocumentComment,
    deleteDocumentComment,
    getDocumentComment,
    getDocumentCommentThread,
    getResolvedDocumentCommentThreadRanges,
    updateDocumentCommentContent,
} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {
    TestAccountActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestCommentRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {encodeDocumentCommentRoomKey} from "~/shared/documents/document_model.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

const schema = DocumentContentProsemirrorSchema;

export class TestDocumentCommentThread extends TestCommentRoomBase {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly document: TestDocument;
    public readonly id: DocumentCommentThreadId;
    public readonly createdTime: Date;

    private constructor(
        context: TestContext,
        document: TestDocument,
        id: DocumentCommentThreadId,
        createdTime: Date,
    ) {
        super();
        this.context = context;
        this.space = document.space;
        this.document = document;
        this.id = id;
        this.createdTime = createdTime;
    }

    // Starts with an underscore since you should prefer calling
    // `document.createCommentThread()` to `TestDocumentCommentThread._create()`.
    public static async _create(
        document: TestDocument,
        session: TestSpaceSession,
        range: {isNode?: false; from: number; to: number} | {isNode: true; pos: number},
        content: string | MessageContent,
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
                                : content,
                        initialCommentFileIds: [],
                        createdTime,
                    },
                ],
            },
        );

        return new TestDocumentCommentThread(session.context, document, id, createdTime);
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
        }: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
        },
    ) {
        return createDocumentComment(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            parent,
            content,
            fileIds,
        });
    }

    public override _updateMessageContent(
        context: TestSessionActionContext,
        {
            messageIndex,
            version,
            steps,
        }: {
            messageIndex: number;
            version: number;
            steps: ReadonlyArray<Step>;
        },
    ) {
        return updateDocumentCommentContent(context, {
            documentId: this.document.id,
            commentThreadId: this.id,
            commentIndex: messageIndex,
            version,
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
