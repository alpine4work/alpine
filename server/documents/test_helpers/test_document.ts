import {Fragment, Node, Slice} from "prosemirror-model";
import {DocAttrStep, ReplaceStep, Step} from "prosemirror-transform";
import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {
    DocumentContentCacheForUpdate,
    FileDocumentAuthorizer,
    createDocument,
    getDocumentPreview,
    getDocumentWithOptionalComments,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {attachFileAsUploader} from "~/server/files/data/files_table.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
    dangerousLegacyDefaultDocumentAccessPolicy,
} from "~/shared/documents/document_content_schema.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
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
    public readonly initialAccessPolicy: AccessPolicy;

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
        initialAccessPolicy: AccessPolicy,
        state: MutexValue<{
            lastVersion: number;
            lastUpdatePos: number;
        }>,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
        this.initialAccessPolicy = initialAccessPolicy;
        this._state = state;
    }

    public static async create(
        session: TestSpaceSession,
        options: {
            id?: DocumentId;
            initialCover?: DocumentContentCover;
        } & (
            | {
                  title?: string;
                  body?: string;
                  access?: "Public" | "Private" | AccessPolicy;
                  content?: undefined;
              }
            | {
                  content: Node;
                  title?: undefined;
                  body?: undefined;
              }
        ) = {},
    ): Promise<TestDocument> {
        let content: Node;
        if (options.content) {
            if (
                !isDeepEqual(
                    options.content.attrs.accessPolicy,
                    dangerousLegacyDefaultDocumentAccessPolicy,
                )
            ) {
                content = options.content;
            }
            // If an access policy wasn't specified so we're using the old, default, public
            // access policy. Then instead replace the legacy public access policy with a
            // private access policy.
            else {
                content = assertDocumentContent(
                    schema.node(
                        "doc",
                        {
                            ...options.content.attrs,
                            accessPolicy: {
                                accountGrantById: new Map([
                                    [session.account.id, {level: "Manage", generation: 0}],
                                ]),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                        options.content.content,
                    ),
                );
            }
        } else {
            let accessPolicy: AccessPolicy;
            if (options.access === "Public") {
                accessPolicy = {
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                };
            } else if (options.access === "Private" || options.access === undefined) {
                accessPolicy = {
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                };
            } else {
                accessPolicy = options.access;
            }

            content = assertDocumentContent(
                schema.node("doc", {accessPolicy, cover: options.initialCover}, [
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
        }

        const document = await createDocument(session.action(), {
            spaceId: session.space.id,
            id: options.id,
            content: assertDocumentContent(content),
        });

        return new TestDocument(
            session.context,
            session.space,
            document.id,
            document.createdTime,
            content.attrs.accessPolicy,
            new MutexValue({
                lastVersion: document.version,
                lastUpdatePos: content.nodeSize - 3,
            }),
        );
    }

    public get() {
        return getDocumentWithOptionalComments(this.space.systemAction(), this.id);
    }

    public readonly access = new TestAccessPolicy({
        get: async () => {
            const document = await getDocumentPreview(this.space.systemAction(), this.id);
            return document.accessPolicy;
        },
        set: async (session, accessPolicy) => {
            await this.update(session, [new DocAttrStep("accessPolicy", accessPolicy)], {
                intentionallyUpdateAccessPolicy: {accessPolicy, notification: null},
            });
        },
    });

    /**
     * Type new text into the document starting from the last updated position in
     * this `TestDocument`'s state. Moves the update position to after the
     * new text.
     */
    public async type(
        session: TestSpaceSession,
        text: string | Node | ReadonlyArray<Node> | Fragment,
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

            if (typeof text === "string") {
                if (text.length === 0) text = Fragment.empty;
                else text = Fragment.from(schema.text(text));
            }

            if (text instanceof Node) text = [text];
            if (isReadonlyArray(text)) text = Fragment.from(text);

            const result = await updateDocumentContent(session.action(), {
                id: this.id,
                version: stateRef.current.lastVersion,
                steps: [
                    new ReplaceStep(
                        lastUpdatePos,
                        lastUpdatePos,
                        text.size !== 0 ? new Slice(text, 0, 0) : Slice.empty,
                    ),
                    ...(secondText !== undefined
                        ? [
                              new ReplaceStep(
                                  lastUpdatePos + text.size,
                                  lastUpdatePos + text.size,
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
                text.size + (secondText !== undefined ? secondText.length : 0);

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
     * Attach a file to the document. Will attach the file as a block immediately
     * below the current typing position.
     */
    public async attachFile(session: TestSpaceSession, file: TestFile) {
        await attachFileAsUploader(
            session.action(),
            this.space.id,
            file.id,
            FileDocumentAuthorizer.bind({type: "Document", documentId: this.id}),
        );

        await this._state.withLock(async stateRef => {
            const steps = [
                new ReplaceStep(
                    stateRef.current.lastUpdatePos + 1,
                    stateRef.current.lastUpdatePos + 1,
                    new Slice(
                        Fragment.from(
                            schema.node("fileRow", {}, schema.node("file", {fileId: file.id})),
                        ),
                        0,
                        0,
                    ),
                ),
            ];

            await updateDocumentContent(session.action(), {
                id: this.id,
                version: stateRef.current.lastVersion,
                clientId: generateId(),
                steps,
            });

            stateRef.current.lastVersion += steps.length;
        });
    }

    /**
     * Create a comment thread at the specified range.
     */
    public createCommentThread(
        session: TestSpaceSession,
        range: {isNode?: false; from: number; to: number} | {isNode: true; pos: number},
        content: string | MessageContent = TestDocumentCommentThread.createDefaultMessageContent(),
    ) {
        return TestDocumentCommentThread._create(this, session, range, content);
    }
}
