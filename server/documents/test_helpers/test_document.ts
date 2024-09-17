import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {
    DocumentContentCacheForUpdate,
    createDocument,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";

const schema = DocumentContentProsemirrorSchema;

/**
 * A utility for creating and updating documents in tests. The `TestDocument`
 * object maintains internal cursor state allowing you to seamlessly add new
 * content to the document.
 */
export class TestDocument {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: DocumentId;
    public readonly createdTime: Date;

    // NOTE(calebmer): A cool capability would be to allow testers to create
    // multiple `TestDocumentClient`s that have their own state so you can make
    // concurrent, version conflicting, updates.
    private readonly _state: MutexValue<{
        lastVersion: number;
        lastUpdatePos: number;
    }>;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: DocumentId,
        createdTime: Date,
        state: MutexValue<{
            lastVersion: number;
            lastUpdatePos: number;
        }>,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
        this._state = state;
    }

    public static async create(
        session: TestSpaceSession,
        options: {
            id?: DocumentId;
        } & (
            | {
                  title?: string;
                  body?: string;
                  content?: undefined;
              }
            | {
                  content: DocumentContent;
                  title?: undefined;
                  body?: undefined;
              }
        ) = {},
    ): Promise<TestDocument> {
        const content = options.content
            ? options.content
            : assertDocumentContent(
                  schema.node("doc", {}, [
                      schema.node("title", {}, options.title ? [schema.text(options.title)] : []),
                      ...(options.body
                          ? options.body
                                .trimEnd()
                                .split("\n")
                                .map(bodyLine =>
                                    schema.node("paragraph", {}, [schema.text(bodyLine)]),
                                )
                          : [schema.node("paragraph", {}, [])]),
                  ]),
              );

        const document = await createDocument(session.action(), {
            spaceId: session.space.id,
            id: options.id,
            content,
        });

        return new TestDocument(
            session.context,
            session.space,
            document.id,
            document.createdTime,
            new MutexValue({
                lastVersion: document.version,
                lastUpdatePos: content.nodeSize - 3,
            }),
        );
    }

    /**
     * Type new text into the document starting from the last updated position in
     * this `TestDocument`'s state. Moves the update position to after the
     * new text.
     */
    public async type(
        session: TestSpaceSession,
        text: string,
        {
            cacheOverrideForTest,
            secondText,
        }: {
            cacheOverrideForTest?: DocumentContentCacheForUpdate;
            secondText?: string;
        } = {},
    ): Promise<
        Awaited<ReturnType<typeof updateDocumentContent>> & {range: {from: number; to: number}}
    > {
        return this._state.withLock(async stateRef => {
            const {lastUpdatePos} = stateRef.current;

            const result = await updateDocumentContent(session.action(), {
                id: this.id,
                version: stateRef.current.lastVersion,
                steps: [
                    new ReplaceStep(
                        lastUpdatePos,
                        lastUpdatePos,
                        text.length !== 0
                            ? new Slice(Fragment.from(schema.text(text)), 0, 0)
                            : Slice.empty,
                    ),
                    ...(secondText !== undefined
                        ? [
                              new ReplaceStep(
                                  lastUpdatePos + text.length,
                                  lastUpdatePos + text.length,
                                  secondText.length !== 0
                                      ? new Slice(Fragment.from(schema.text(secondText)), 0, 0)
                                      : Slice.empty,
                              ),
                          ]
                        : []),
                ],
                clientId: generateId(),
                cacheOverrideForTest,
            });

            stateRef.current.lastVersion += 1 + (secondText !== undefined ? 1 : 0);
            stateRef.current.lastUpdatePos +=
                text.length + (secondText !== undefined ? secondText.length : 0);

            return Object.assign(result, {
                range: {
                    from: lastUpdatePos,
                    to: stateRef.current.lastUpdatePos,
                },
            });
        });
    }

    /**
     * Update the document content with some steps at the current version.
     *
     * Does not use the current update cursor in this test document class's
     * state and does not update the cursor.
     */
    public async update(
        session: TestSpaceSession,
        steps: ReadonlyArray<Step>,
        {
            versionOverride,
            ...options
        }: Omit<
            Parameters<typeof updateDocumentContent>[1],
            "id" | "version" | "steps" | "clientId"
        > & {versionOverride?: number} = {},
    ) {
        return this._state.withLock(async stateRef => {
            const result = await updateDocumentContent(session.action(), {
                ...options,
                id: this.id,
                version: versionOverride ?? stateRef.current.lastVersion,
                steps,
                clientId: generateId(),
            });

            stateRef.current.lastVersion += steps.length;

            return result;
        });
    }

    /**
     * Create a comment thread at the specified range.
     */
    public createCommentThread(
        session: TestSpaceSession,
        range: {from: number; to: number},
        content: string | MessageContent,
    ) {
        return TestDocumentCommentThread._create(this, session, range, content);
    }
}
