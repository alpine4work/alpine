import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {createDocument, updateDocumentContent} from "~/server/documents/data/documents_table.js";
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
        state: MutexValue<{
            lastVersion: number;
            lastUpdatePos: number;
        }>,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this._state = state;
    }

    public static async create(
        session: TestSpaceSession,
        options: {
            id?: DocumentId;
        } & (
            | {
                  title?: string;
                  body: string;
                  content?: undefined;
              }
            | {
                  content: DocumentContent;
                  title?: undefined;
                  body?: undefined;
              }
            | {
                  title?: undefined;
                  body?: undefined;
                  content?: undefined;
              }
        ) = {},
    ): Promise<TestDocument> {
        const content = options.content
            ? options.content
            : assertDocumentContent(
                  schema.node("doc", {}, [
                      schema.node("title", {}, options.title ? [schema.text(options.title)] : []),
                      schema.node("paragraph", {}, options.body ? [schema.text(options.body)] : []),
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
    public async type(session: TestSpaceSession, text: string) {
        return this._state.withLock(async stateRef => {
            const result = await updateDocumentContent(session.action(), {
                id: this.id,
                version: stateRef.current.lastVersion,
                steps: [
                    new ReplaceStep(
                        stateRef.current.lastUpdatePos,
                        stateRef.current.lastUpdatePos,
                        text.length !== 0
                            ? new Slice(Fragment.from(schema.text(text)), 0, 0)
                            : Slice.empty,
                    ),
                ],
                clientId: generateId(),
            });

            stateRef.current.lastVersion += 1;
            stateRef.current.lastUpdatePos += text.length;

            return result;
        });
    }

    /**
     * Update the document content with some steps at the current version.
     *
     * Does not use the current update cursor in this test document class's
     * state and does not update the cursor.
     */
    public async update(session: TestSpaceSession, steps: ReadonlyArray<Step>) {
        return this._state.withLock(async stateRef => {
            const result = await updateDocumentContent(session.action(), {
                id: this.id,
                version: stateRef.current.lastVersion,
                steps,
                clientId: generateId(),
            });

            stateRef.current.lastVersion += steps.length;

            return result;
        });
    }
}
