import {AddMarkStep, AddNodeMarkStep} from "prosemirror-transform";
import {
    getDocumentCommentThread,
    getResolvedDocumentCommentThreadRanges,
} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

const schema = DocumentContentProsemirrorSchema;

export class TestDocumentCommentThread {
    public readonly context: TestContext;
    public readonly document: TestDocument;
    public readonly id: DocumentCommentThreadId;

    private constructor(context: TestContext, document: TestDocument, id: DocumentCommentThreadId) {
        this.context = context;
        this.document = document;
        this.id = id;
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
                    },
                ],
            },
        );

        return new TestDocumentCommentThread(session.context, document, id);
    }

    public async get(session: TestSpaceSession) {
        return getDocumentCommentThread(session.action(), {
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
