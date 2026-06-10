import {Fragment, Node, Slice} from "prosemirror-model";
import {DocAttrStep, ReplaceStep, Step} from "prosemirror-transform";
import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {
    DocumentContentCacheForUpdate,
    FileDocumentAuthorizer,
    createDocument,
    getDocumentContent,
    getDocumentPreview,
    getDocumentWithOptionalComments,
    updateDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {attachFileAsUploader} from "~/server/files/data/files_actions.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {fromApiContentBlockElements} from "~/shared/api/content/from_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
    dangerousLegacyDefaultDocumentAccessPolicy,
} from "~/shared/documents/document_content_schema.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, SiteId} from "~/shared/id/types/id_types.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";

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

    // NOTE(calebmer): A cool capability would be to allow testers to create multiple
    // `TestDocumentClient`s that have their own state so you can make concurrent,
    // version conflicting, updates.
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
            hasPresentShortcut?: boolean;
            cover?: DocumentContentCover;
            sitePosition?: {siteId: SiteId; parentId: SiteContainerId; orderKey: OrderKey};
        } & (
            | {
                  title?: string;
                  body?: string;
                  access?: "Public" | "Private" | AccessPolicy;
                  content?: undefined;
              }
            | {
                  content: Node | ReadonlyArray<Node>;
                  title?: undefined;
                  body?: undefined;
              }
        ) = {},
    ): Promise<TestDocument> {
        let content: Node;
        if (options.content) {
            const defaultAccessPolicy: AccessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            };

            if (isReadonlyArray(options.content)) {
                content = assertDocumentContent(
                    schema.node("doc", {accessPolicy: defaultAccessPolicy}, options.content),
                );
            } else if (
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
                        {...options.content.attrs, accessPolicy: defaultAccessPolicy},
                        options.content.content,
                    ),
                );
            }
        } else {
            let accessPolicy: AccessPolicy;
            if (options.access === "Public") {
                accessPolicy = {
                    type: "Local",
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                };
            } else if (options.access === "Private" || options.access === undefined) {
                accessPolicy = {
                    type: "Local",
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
                schema.node(
                    "doc",
                    {
                        accessPolicy,
                        hasPresentShortcut: options.hasPresentShortcut,
                        cover: options.cover,
                    },
                    [
                        schema.node("title", {}, options.title ? [schema.text(options.title)] : []),
                        ...(options.body
                            ? parseDocumentTestContent(options.body)
                            : [schema.node("paragraph", {}, [])]),
                    ],
                ),
            );
        }

        const document = await createDocument(session.action(), {
            spaceId: session.space.id,
            id: options.id,
            content: assertDocumentContent(content),
            sitePosition: options.sitePosition,
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

    public async getContent() {
        const {content} = await getDocumentContent(this.space.systemAction(), this.id);
        return content;
    }

    public async updateContentPreview() {
        const {updateContentPreview} = await getDocumentContent(this.space.systemAction(), this.id);
        await updateContentPreview(this.space.systemAction());
    }

    public async getString() {
        const {content} = await getDocumentContent(this.space.systemAction(), this.id);
        return content.toString();
    }

    public async getVersion() {
        return await this._state.withLock(async stateRef => stateRef.current.lastVersion);
    }

    public readonly access = new TestAccessPolicy({
        get: async () => {
            const document = await getDocumentPreview(this.space.systemAction(), this.id);
            return document.accessPolicy;
        },
        set: async (session, accessPolicy) => {
            // Site policies pass position in the intentional update, but the doc attr stores
            // the bare site policy (no position) — strip it for the DocAttrStep.
            const docAttrAccessPolicy =
                accessPolicy.type === "Site"
                    ? omitObject(accessPolicy, ["position"])
                    : accessPolicy;
            await this.update(session, [new DocAttrStep("accessPolicy", docAttrAccessPolicy)], {
                intentionallyUpdateAccessPolicy: {accessPolicy, notification: null},
            });
        },
    });

    /**
     * Type new text into the document starting from the last updated position in this
     * `TestDocument`'s state. Moves the update position to after the new text.
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
        return await this._state.withLock(async stateRef => {
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
     * Does not use the current update cursor in this test document class's state and
     * does not update the cursor.
     */
    public async update(
        session: TestSpaceSession,
        steps: MaybeThunk<ReadonlyArray<Step>, [lastUpdatePos: number]>,
        {
            versionOverride,
            ...options
        }: Omit<
            Parameters<typeof updateDocumentContent>[1],
            "id" | "version" | "steps" | "clientId"
        > & {versionOverride?: number} = {},
    ) {
        return await this._state.withLock(async stateRef => {
            const result = await updateDocumentContent(session.action(), {
                ...options,
                id: this.id,
                version: versionOverride ?? stateRef.current.lastVersion,
                steps: typeof steps === "function" ? steps(stateRef.current.lastUpdatePos) : steps,
                clientId: generateId(),
            });

            stateRef.current.lastVersion += steps.length;

            return result;
        });
    }

    /**
     * Attach a file to the document. Will attach the file as a block immediately below
     * the current typing position.
     */
    public async attachFile(session: TestSpaceSession, file: TestFile) {
        await attachFileAsUploader(
            session.action(),
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
        content: string | Node = TestDocumentCommentThread.createDefaultMessageContent(),
        options?: {id?: DocumentCommentThreadId; overrideCreatedTime?: Date},
    ) {
        return TestDocumentCommentThread._create(this, session, range, content, options);
    }
}

function parseDocumentTestContent(content: string) {
    const apiContent = parseApiContentFromMarkdown(content);

    return Array.from(
        fromApiContentBlockElements(DocumentContentProsemirrorSchema, apiContent.elements),
    );
}
