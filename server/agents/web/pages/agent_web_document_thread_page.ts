import {Parent, Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageDocumentThreadRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPageWithMetadata,
    agentWebMessagingPageCommentNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {
    agentWebMessagingPageApiMessagesBatchCount,
    getReadAgentWebMessagingPageAroundMessageStartCursor,
    parseAgentWebMessagingPageSearchParams,
    readAgentWebMessagingPageAroundMessage,
    readAgentWebMessagingPageInDirection,
} from "~/server/agents/web/pages/messaging/read_agent_web_messaging_page.js";
import {updateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/update_agent_web_messaging_page.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.js";
import {normalizeApiContent} from "~/shared/api/markdown/normalize_api_content.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiDocumentReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {mapMaybePromise} from "~/shared/helpers/async/map_maybe_promise.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {mapMaybeThunk} from "~/shared/helpers/control/map_maybe_thunk.js";
import {memoMaybeThunk} from "~/shared/helpers/control/memo_maybe_thunk.js";
import {unwrapMaybeThunk} from "~/shared/helpers/control/unwrap_maybe_thunk.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

export type AgentWebDocumentThreadPage = {
    readonly type: "DocumentThread";
    readonly preamble: AgentWebDocumentThreadPagePreamble;
    readonly pagination: AgentWebMessagingPagePagination<AgentWebDocumentThreadPageCustomBlock> | null;
    readonly isEndOfMessages: boolean;
} & (
    | {
          readonly subType: "Head";
          readonly blocks: AgentWebDocumentThreadHeadPageBlocks;
      }
    | {
          readonly subType: "Tail";
          readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock<never>>;
      }
);

export type AgentWebDocumentThreadHeadPageBlocks = readonly [
    AgentWebDocumentThreadPageCustomBlock,
    ...ReadonlyArray<AgentWebMessagingPageBlock<never>>,
];

export type AgentWebDocumentThreadPagePreamble = {
    readonly document: ApiDocumentReferenceResponse;
};

export type AgentWebDocumentThreadPageWithMetadata = AgentWebDocumentThreadPage & {
    readonly metadata: AgentWebDocumentThreadPageMetadata;
};

export type AgentWebDocumentThreadPageMetadata = AgentWebMessagingPageMetadata & {
    readonly type: "DocumentThread";
    readonly id: DocumentId;
    readonly threadId: DocumentCommentThreadId;
};

export type AgentWebDocumentThreadPageCustomBlock = {
    readonly type: "Custom";
    readonly tagName: "document-preview";
    readonly timeAttribute: null;
    readonly content: ApiContentResponseWithoutKeys;
};

function buildAgentWebDocumentThreadPage(
    page: AgentWebMessagingPageWithMetadata<
        AgentWebDocumentThreadPagePreamble,
        AgentWebDocumentThreadPageCustomBlock
    >,
    id: DocumentId,
    threadId: DocumentCommentThreadId,
): AgentWebDocumentThreadPageWithMetadata {
    if (page.blocks.length > 0 && page.blocks[0]!.type === "Custom") {
        assert(page.blocks.slice(1).every(block => block.type !== "Custom"));

        return {
            ...page,
            type: "DocumentThread",
            subType: "Head",
            preamble: page.preamble,
            isEndOfMessages: page.isEndOfMessages,
            blocks: page.blocks as AgentWebDocumentThreadHeadPageBlocks,
            metadata: buildAgentWebDocumentThreadPageMetadata(page.metadata, id, threadId),
        };
    }

    assert(page.blocks.every(block => block.type !== "Custom"));

    return {
        ...page,
        type: "DocumentThread",
        subType: "Tail",
        preamble: page.preamble,
        blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
        metadata: buildAgentWebDocumentThreadPageMetadata(page.metadata, id, threadId),
    };
}

function buildAgentWebDocumentThreadPageMetadata(
    metadata: AgentWebMessagingPageMetadata,
    id: DocumentId,
    threadId: DocumentCommentThreadId,
): AgentWebDocumentThreadPageMetadata {
    return {...metadata, type: "DocumentThread", id, threadId};
}

export async function readAgentWebDocumentThreadPage(
    context: AgentWebContext,
    id: DocumentId,
    threadId: DocumentCommentThreadId,
    {
        searchParams: originalSearchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebDocumentThreadPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebDocumentThreadPageMetadata}> {
    let excludesDocumentPreview = false;

    const searchParams = new URLSearchParams(originalSearchParams);

    if (searchParams.get("after") === "document-preview") {
        excludesDocumentPreview = true;
        searchParams.delete("after");
        searchParams.set("start", "");
    }

    if (searchParams.get("before") === "document-preview") {
        excludesDocumentPreview = true;
        searchParams.set("before", "0");
    }

    const parsedSearchParams = parseAgentWebMessagingPageSearchParams({
        messageNouns: agentWebMessagingPageCommentNouns,
        defaultDirection: "Start",
        searchParams,
    });

    type RoomMetadata = {
        pageLink: AgentWebPageDocumentThreadRoutedLink;
        preamble: AgentWebDocumentThreadPagePreamble;
        startCustomBlock: {
            time: null;
            block: AgentWebDocumentThreadPageCustomBlock;
        } | null;
    };

    const roomMetadataWithStartCustomBlock = new Lazy<Promise<RoomMetadata>>(async () => {
        // If `excludesDocumentPreview` is set then never return a `<document-preview>`
        // start block.
        if (excludesDocumentPreview) return await roomMetadataWithoutStartCustomBlock.get();

        const {
            data: {document, thread},
        } = await context.api.get(context.span, "/documents/{id}/threads/{threadId}", {
            params: {path: {id, threadId}},
        });

        const documentReference: ApiDocumentReferenceResponse = {
            type: "Document",
            id,
            title: document.reference.title,
        };

        return {
            pageLink: {
                type: "DocumentThread",
                document: documentReference,
                threadId,
            },
            preamble: {
                type: "Head",
                document: documentReference,
            },
            startCustomBlock: {
                time: null,
                block: {
                    type: "Custom",
                    tagName: "document-preview",
                    timeAttribute: null,
                    // Make sure we only include comment marks in the preview for the current thread.
                    content: visitAndProduceApiContent(thread.documentContentSnippet, {
                        // NOCOMMIT: How do comments on `file` nodes work? Do they work at all??
                        visitInlineElement: element => {
                            if (
                                element.marks?.some(
                                    mark => mark.type === "Comment" && mark.thread.id !== threadId,
                                )
                            ) {
                                element.marks = element.marks.filter(
                                    mark => mark.type !== "Comment" || mark.thread.id === threadId,
                                );
                            }
                        },
                    }),
                },
            },
        };
    });

    const roomMetadataWithoutStartCustomBlock = new Lazy<Promise<RoomMetadata>>(async () => {
        const {
            data: {reference: documentReference},
        } = await context.api.get(context.span, "/documents/{id}/reference", {
            params: {path: {id}},
        });

        return {
            pageLink: {
                type: "DocumentThread",
                document: documentReference,
                threadId,
            },
            preamble: {
                type: "Tail",
                document: documentReference,
            },
            startCustomBlock: null,
        };
    });

    let roomMetadataPromise: Promise<RoomMetadata>;
    let response: string;
    let metadata: AgentWebMessagingPageMetadata;

    switch (parsedSearchParams.type) {
        case "Direction": {
            switch (parsedSearchParams.direction) {
                case "Start": {
                    if (
                        parsedSearchParams.startCursor === null ||
                        parsedSearchParams.startCursor < -1
                    ) {
                        // We're at the start of the page, preload the full preview because we'll want to
                        // try fitting it into the page.
                        roomMetadataPromise = roomMetadataWithStartCustomBlock.get();
                    } else {
                        roomMetadataPromise = roomMetadataWithoutStartCustomBlock.get();
                    }
                    break;
                }
                case "End": {
                    // Loads the full preview even if we don't need it. The preview may be truncated if
                    // it doesn't fit within the limit.
                    //
                    // Edge case: if you use a "before" value that's larger than the number of messages
                    // and there are less than `agentWebMessagingPageApiMessagesBatchCount` (30)
                    // messages we won't show the preview. For example, if there are 5 messages and you
                    // use `?before=100`. We'll only load the first 5 messages and we won't show the
                    // preview because according to this math the preview won't be visible on the page.
                    // This is a bug. Ideally we wouldn't allow `?before=100` at all but for consistent
                    // cursor based pagination across our API we treat `?before=100` as a "last 30
                    // messages <100" constraint and not messages between 70 and 100 constraint.
                    if (
                        parsedSearchParams.startCursor !== null &&
                        parsedSearchParams.startCursor -
                            agentWebMessagingPageApiMessagesBatchCount <
                            -1
                    ) {
                        // We'll be loading messages up to the first comment. Preload the full preview so
                        // we can try fitting it into the page.
                        roomMetadataPromise = roomMetadataWithStartCustomBlock.get();
                    } else {
                        roomMetadataPromise = roomMetadataWithoutStartCustomBlock.get();
                    }
                    break;
                }
                default:
                    throw exhaustive(parsedSearchParams.direction);
            }

            [, {response, metadata}] = await runAllPromises([
                roomMetadataPromise,
                readAgentWebMessagingPageInDirection(context, {
                    messageNouns: agentWebMessagingPageCommentNouns,
                    room: {type: "DocumentThread", id, threadId},
                    getRoomMetadata: async ({isStartOfMessages}) => {
                        const roomMetadata = await roomMetadataPromise;

                        // If there is no start custom block loaded but we're at the start of the message
                        // list, then load the full preview so we can include it as a start block. Slightly
                        // inefficient waterfall, but this case should happen rarely so we're fine with it
                        // (`End` direction, multiple pagination requests needed, and near the top of the
                        // message list).
                        if (!roomMetadata.startCustomBlock && isStartOfMessages) {
                            return await roomMetadataWithStartCustomBlock.get();
                        }

                        return roomMetadata;
                    },
                    direction: parsedSearchParams.direction,
                    startCursor: parsedSearchParams.startCursor,
                    limitLength,
                    printPage: page =>
                        printPage(buildAgentWebDocumentThreadPage(page, id, threadId)),
                }),
            ]);
            break;
        }
        case "Around": {
            // Loads the full preview even if we don't need it. The preview may be truncated if
            // it doesn't fit within the limit.
            if (
                getReadAgentWebMessagingPageAroundMessageStartCursor(parsedSearchParams.around) < -1
            ) {
                // We'll be loading messages up to the first comment. Preload the full preview so
                // we can try fitting it into the page.
                roomMetadataPromise = roomMetadataWithStartCustomBlock.get();
            } else {
                roomMetadataPromise = roomMetadataWithoutStartCustomBlock.get();
            }

            [, {response, metadata}] = await runAllPromises([
                roomMetadataPromise,
                readAgentWebMessagingPageAroundMessage(context, {
                    messageNouns: agentWebMessagingPageCommentNouns,
                    room: {type: "DocumentThread", id, threadId},
                    getRoomMetadata: async ({isStartOfMessages}) => {
                        const roomMetadata = await roomMetadataPromise;

                        // If there is no start custom block loaded but we're at the start of the message
                        // list, then load the full preview so we can include it as a start block. Slightly
                        // inefficient waterfall, but this case should happen rarely so we're fine with it
                        // (`Around` direction, multiple pagination requests needed, and near the top of
                        // the message list).
                        if (!roomMetadata.startCustomBlock && isStartOfMessages) {
                            return await roomMetadataWithStartCustomBlock.get();
                        }

                        return roomMetadata;
                    },
                    around: parsedSearchParams.around,
                    limitLength,
                    printPage: page =>
                        printPage(buildAgentWebDocumentThreadPage(page, id, threadId)),
                }),
            ]);
            break;
        }
        default:
            throw exhaustive(parsedSearchParams);
    }

    return {response, metadata: buildAgentWebDocumentThreadPageMetadata(metadata, id, threadId)};
}

export async function readAgentWebDocumentThreadMessagePage(
    context: AgentWebContext,
    id: DocumentId,
    threadId: DocumentCommentThreadId,
    index: number,
    {
        limitLength,
        printPage,
    }: {
        limitLength: number;
        printPage: (page: AgentWebDocumentThreadPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebDocumentThreadPageMetadata}> {
    return await readAgentWebDocumentThreadPage(context, id, threadId, {
        searchParams: new URLSearchParams([["comment", String(index)]]),
        limitLength,
        printPage,
    });
}

export function normalizeAgentWebDocumentThreadPage<Page extends AgentWebDocumentThreadPage>(
    page: Page,
): Page {
    return normalizeAgentWebMessagingPage(page, {
        normalizePreamble: (normalizer, preamble) => {
            normalizer.normalizeReference(preamble.document);
        },
        normalizeCustomBlock: (normalizer, customBlock) => {
            normalizer.normalizeBlockElements(customBlock.content.elements);
        },
    });
}

export async function updateAgentWebDocumentThreadPage(
    context: AgentWebContextWithoutStorage,
    pathname: MaybeThunk<MaybePromise<string>>,
    oldPageMetadata: MaybeThunk<MaybePromise<AgentWebDocumentThreadPageMetadata>>,
    oldPage: AgentWebDocumentThreadPage,
    newPage: AgentWebDocumentThreadPage,
): Promise<AgentWebDocumentThreadPageMetadata> {
    if (oldPage.preamble.document.id !== newPage.preamble.document.id) {
        throw new InvalidArgumentError("Can\u2019t update document in document thread preamble", {
            displayMessage: errorDisplayMessage`You can only update your \`<comment>\`s. You can\u2019t change which document the document comment thread belongs to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.`,
        });
    }

    oldPageMetadata = memoMaybeThunk(oldPageMetadata);

    const newPageMetadata = await updateAgentWebMessagingPage<
        AgentWebDocumentThreadPagePreamble,
        AgentWebDocumentThreadPageCustomBlock
    >(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        pathname,
        room: mapMaybeThunk(oldPageMetadata, oldPageMetadata =>
            mapMaybePromise(oldPageMetadata, oldPageMetadata => ({
                type: "DocumentThread",
                id: oldPageMetadata.id,
                threadId: oldPageMetadata.threadId,
            })),
        ),
        oldPageMetadata,
        oldPage,
        newPage,
        prepareCustomBlockUpdate: (oldCustomBlock, newCustomBlock) => {
            const normalizedOldContent = normalizeApiContent(oldCustomBlock.content);
            const normalizedNewContent = normalizeApiContent(newCustomBlock.content);

            if (isDeepEqual(normalizedOldContent, normalizedNewContent)) return {update: asyncNoop};

            throw new InvalidArgumentError("Can\u2019t update document preview", {
                displayMessage: errorDisplayMessage`You can\u2019t update the \`<document-preview>\` in document comment thread markdown. \`<document-preview>\` is a read-only preview of the document\u2019s content around the comment. If you want to update the document\u2019s content then call the \`update\` tool on the document itself.`,
            });
        },
    });

    const {id, threadId} = await unwrapMaybeThunk(oldPageMetadata);

    return buildAgentWebDocumentThreadPageMetadata(newPageMetadata, id, threadId);
}

export async function printAgentWebDocumentThreadPage(
    storage: AgentWebSessionStorage,
    pageLink: {document: {id: DocumentId}; threadId: DocumentCommentThreadId},
    page: AgentWebDocumentThreadPage,
): Promise<Root> {
    // Get the number for the comment thread. If there's not currently a number for
    // this thread then we'll generate the next number in the sequence.
    const threadNumber = await storage.mutex.withLock(async () => {
        const id: `${DocumentId}-${DocumentCommentThreadId}` = `${pageLink.document.id}-${pageLink.threadId}`;

        let number = await storage.documentCommentThreadNumberById.get(id);

        // Make a `list()` call to figure out the total number of comment threads we've
        // seen and use a comment thread number that's one more than that.
        if (number === undefined) {
            const threads = await storage.documentCommentThreadNumberById.list({
                prefix: `${pageLink.document.id}-`,
            });

            number = threads.size + 1;

            await storage.documentCommentThreadNumberById.put(id, number);
            await storage.documentCommentThreadIdByNumber.put(
                `${pageLink.document.id}-${number}`,
                pageLink.threadId,
            );
        }

        return number;
    });

    return await printAgentWebMessagingPage<
        {document: {id: DocumentId}; threadId: DocumentCommentThreadId},
        AgentWebDocumentThreadPagePreamble,
        AgentWebDocumentThreadPageCustomBlock
    >(storage, pageLink, page, {
        messageNouns: agentWebMessagingPageCommentNouns,
        printPreamble: async (storage, preamble) => {
            return await printApiContentToAgentWebMarkdownTree(storage, {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Document comment thread on "},
                            {type: "Mention", reference: preamble.document},
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            });
        },
        printCustomBlock: async (storage, block) => {
            const contentTree = await printApiContentToAgentWebMarkdownTree(
                storage,
                block.content,
                {documentId: pageLink.document.id},
            );

            const traverse = (node: Parent) => {
                for (let index = 0; index < node.children.length; index++) {
                    const childNode = node.children[index]!;

                    // Remove `id` from `<comment>` tag. The `id` should be implicit as this is the
                    // only `<comment>` tag.
                    if (childNode.type === "html") {
                        childNode.value = childNode.value.replaceAll(
                            `<comment id="${threadNumber}">`,
                            "<comment>",
                        );
                    }

                    if ("children" in childNode) {
                        traverse(childNode);
                    }
                }
            };

            traverse(contentTree);

            return {
                type: "root",
                children: [
                    {type: "html", value: "<document-preview>"},
                    ...contentTree.children,
                    {type: "html", value: "</document-preview>"},
                ],
            };
        },
    });
}

export async function parseAgentWebDocumentThreadPage(
    storage: AgentWebSessionStorage,
    pageLink: {document: {id: DocumentId}; threadId: DocumentCommentThreadId} | null,
    root: Root,
): Promise<AgentWebDocumentThreadPage> {
    if (pageLink === null)
        throw new InvalidArgumentError("NOCOMMIT", {displayMessage: errorDisplayMessage`NOCOMMIT`});

    // We expect `printAgentWebDocumentThreadPage()`,
    // `createAgentWebPageRoutedLinkPathname()`, or
    // `printApiContentToAgentWebMarkdown()` to generate a thread number for this
    // thread by this point. We don't want the parser to mutate storage.
    const threadNumber = assertExists(
        await storage.documentCommentThreadNumberById.get(
            `${pageLink.document.id}-${pageLink.threadId}`,
        ),
        "Document comment thread number hasn\u2019t been generated for this thread yet",
    );

    const page = await parseAgentWebMessagingPage(storage, pageLink, root, {
        messageNouns: agentWebMessagingPageCommentNouns,
        parsePreamble: async (storage, preamble): Promise<AgentWebDocumentThreadPagePreamble> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid document thread preamble", {
                    displayMessage: errorDisplayMessage`Document comment thread markdown must start with \`Document comment thread on [My Document](/document/my-document).\`. Try again with a proper start to document comment thread markdown on line 1.`,
                });
            };

            const preambleContent = await parseApiContentFromAgentWebMarkdownTree(
                storage,
                preamble,
            );

            if (
                preambleContent.elements.length !== 1 ||
                preambleContent.elements[0]?.type !== "Paragraph"
            ) {
                throw createError();
            }

            const elements = preambleContent.elements[0].elements;
            const lastElement = elements[elements.length - 1]!;
            const hasTrailingPeriod = lastElement.type === "Text" && lastElement.text === ".";
            const actualElements = hasTrailingPeriod ? elements.slice(0, -1) : elements;

            if (actualElements.length !== 2) throw createError();

            const [firstElement, secondElement] = actualElements;

            if (firstElement?.type !== "Text" || secondElement?.type !== "Mention")
                throw createError();

            if (secondElement.reference.type !== "Document") throw createError();

            if (
                firstElement.text !== "Document comment thread on " &&
                firstElement.text !== "Document comments thread on " &&
                firstElement.text !== "Document thread on "
            ) {
                throw createError();
            }

            return {document: secondElement.reference};
        },
        parseCustomBlockByTagName: {
            "document-preview": async (
                storage,
                root,
            ): Promise<AgentWebDocumentThreadPageCustomBlock> => {
                const traverse = (node: Parent) => {
                    for (let index = 0; index < node.children.length; index++) {
                        const childNode = node.children[index]!;

                        // Remove `id` from `<comment>` tag. The `id` should be implicit as this is the
                        // only `<comment>` tag.
                        if (childNode.type === "html") {
                            childNode.value = childNode.value.replace(
                                "<comment>",
                                `<comment id="${threadNumber}">`,
                            );
                        }

                        if ("children" in childNode) {
                            traverse(childNode);
                        }
                    }
                };

                traverse(root);

                const content = await parseApiContentFromAgentWebMarkdownTree(storage, root, {
                    documentId: pageLink.document.id,
                });

                return {
                    type: "Custom",
                    tagName: "document-preview",
                    timeAttribute: null,
                    content,
                };
            },
        },
    });

    const documentPreviewBlockIndexes: Array<number> = [];

    for (const [index, block] of page.blocks.entries()) {
        if (block.type === "Custom" && block.tagName === "document-preview") {
            documentPreviewBlockIndexes.push(index);
        }
    }

    if (documentPreviewBlockIndexes.length === 0) {
        return {
            ...page,
            type: "DocumentThread",
            subType: "Tail",
            preamble: page.preamble,
            blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
        };
    }

    if (documentPreviewBlockIndexes.length !== 1 || documentPreviewBlockIndexes[0] !== 0) {
        throw new InvalidArgumentError(
            "Must only have one document preview block at start of head page",
            {
                displayMessage: errorDisplayMessage`There must be only one \`<document-preview>\` immediately after the first line which states what document the thread is on (e.g. \`Document thread on [My Document](/document/my-document).\`). Try again with one \`<document-preview>\` at the start of the markdown.`,
            },
        );
    }

    return {
        ...page,
        type: "DocumentThread",
        subType: "Head",
        preamble: page.preamble,
        blocks: page.blocks as AgentWebDocumentThreadHeadPageBlocks,
    };
}
