import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Node, Root, RootContent} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageDocumentThreadRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageRoutedLinkPathname} from "~/server/agents/web/create_agent_web_page_routed_link_pathname.js";
import {extractCommentFromApiDocumentThreadContentSnippet} from "~/server/agents/web/internal/extract_comment_from_api_document_thread_content_snippet.js";
import {parseAgentWebDocumentPage} from "~/server/agents/web/pages/agent_web_document_page.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPagePagination,
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
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {findApiContentRanges} from "~/shared/api/content/find_api_content_ranges.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {
    unzipKeysFromApiContentResponse,
    zipKeysIntoApiContentResponse,
} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiDocumentReferenceResponse,
    ApiDocumentThreadResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
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
    readonly pagination: AgentWebMessagingPagePagination<AgentWebDocumentThreadPageCustomBlock> | null;
    readonly isEndOfMessages: boolean;
} & (
    | {
          readonly subType: "Head";
          readonly preamble: AgentWebDocumentThreadHeadPagePreamble;
          readonly blocks: AgentWebDocumentThreadHeadPageBlocks;
      }
    | {
          readonly subType: "Tail";
          readonly preamble: AgentWebDocumentThreadTailPagePreamble;
          readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock<never>>;
      }
);

export type AgentWebDocumentThreadHeadPageBlocks = readonly [
    AgentWebDocumentThreadPageCustomBlock,
    ...ReadonlyArray<AgentWebMessagingPageBlock<never>>,
];

export type AgentWebDocumentThreadPagePreamble =
    | AgentWebDocumentThreadHeadPagePreamble
    | AgentWebDocumentThreadTailPagePreamble;

export type AgentWebDocumentThreadHeadPagePreamble = {
    readonly type: "Head";
    readonly document: ApiDocumentReferenceResponse;
    readonly isResolved: boolean;
};

export type AgentWebDocumentThreadTailPagePreamble = {
    readonly type: "Tail";
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
    readonly tagName: "blockquote";
    readonly timeAttribute: null;
    readonly hasCiteAttribute: boolean;
    readonly matchAttribute: number | null;
    readonly content: ApiContentResponseWithoutKeys;
};

function buildAgentWebDocumentThreadPage(
    page: AgentWebMessagingPage<
        AgentWebDocumentThreadPagePreamble,
        AgentWebDocumentThreadPageCustomBlock
    >,
): AgentWebDocumentThreadPage {
    if (page.blocks.length > 0 && page.blocks[0]!.type === "Custom") {
        assert(page.blocks.slice(1).every(block => block.type !== "Custom"));
        assert(page.preamble.type === "Head");

        return {
            ...page,
            type: "DocumentThread",
            subType: "Head",
            preamble: page.preamble,
            isEndOfMessages: page.isEndOfMessages,
            blocks: page.blocks as AgentWebDocumentThreadHeadPageBlocks,
        };
    }

    assert(page.blocks.every(block => block.type !== "Custom"));
    assert(page.preamble.type === "Tail");

    return {
        ...page,
        type: "DocumentThread",
        subType: "Tail",
        preamble: page.preamble,
        blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
    };
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
        printPage: (page: AgentWebDocumentThreadPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebDocumentThreadPageMetadata}> {
    let excludesDocumentPreview = false;

    const searchParams = new URLSearchParams(originalSearchParams);

    if (searchParams.get("after") === "blockquote") {
        excludesDocumentPreview = true;
        searchParams.delete("after");
        searchParams.set("start", "");
    }

    if (searchParams.get("before") === "blockquote") {
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
        // If `excludesDocumentPreview` is set then never return a `<blockquote>` start
        // block.
        if (excludesDocumentPreview) return await roomMetadataWithoutStartCustomBlock.get();

        const {
            data: {thread},
        } = await context.api.get(context.span, "/documents/{id}/threads/{threadId}", {
            params: {path: {id, threadId}},
        });

        const documentReference: ApiDocumentReferenceResponse = {
            type: "Document",
            id,
            title: thread.document.reference.title,
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
                isResolved: thread.isResolved,
            },
            startCustomBlock: {
                time: null,
                block: {
                    type: "Custom",
                    tagName: "blockquote",
                    timeAttribute: null,
                    hasCiteAttribute: true,
                    matchAttribute: null,
                    // Just show the commented content to the agent without any of the surrounding
                    // context returned by the API. We use this format so that it's easy for the agent
                    // to create new document comment threads since all it needs to do is write the
                    // content it's quoting and nothing else.
                    content: extractCommentFromApiDocumentThreadContentSnippet(
                        threadId,
                        thread.documentContentSnippet,
                    ),
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
                    printPage: page => printPage(buildAgentWebDocumentThreadPage(page)),
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
                    printPage: page => printPage(buildAgentWebDocumentThreadPage(page)),
                }),
            ]);
            break;
        }
        default:
            throw exhaustive(parsedSearchParams);
    }

    return {response, metadata: {...metadata, type: "DocumentThread", id, threadId}};
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
        printPage: (page: AgentWebDocumentThreadPage) => Promise<string>;
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

export async function createAgentWebDocumentThreadPage(
    context: AgentWebContext,
    documentPath: string,
    newPage: AgentWebDocumentThreadPage,
) {
    const documentReadResponse = await context.storage.readResponseByPath.get(documentPath);

    if (!documentReadResponse || documentReadResponse.expirationTime.getTime() < Date.now()) {
        throw new InvalidArgumentError("Read response not found or expired", {
            displayMessage: errorDisplayMessage`Can\u2019t create a document comment thread for a document that hasn\u2019t been read recently. Call the \`read\` tool with the path \`${documentPath}\` then call the \`create\` tool again.`,
        });
    }

    assert(documentReadResponse.pageMetadata.type === "Document");

    const responseTree = parseMarkdownTree(documentReadResponse.response);

    const documentPage = await parseAgentWebDocumentPage(
        context.storage,
        documentReadResponse.pageMetadata.id,
        responseTree,
    );

    if (newPage.subType === "Tail") {
        throw new InvalidArgumentError("Document quote is created when creating a comment thread", {
            displayMessage: errorDisplayMessage`A \`<blockquote>\` is required when creating a document comment thread. You must add a \`<blockquote>\` containing the exact document content you\u2019re commenting after the \`Document comment thread on [My Document](/document/my-document).\` line at the start of the markdown. Try again and add a \`<blockquote>\`.`,
        });
    }

    if (newPage.preamble.isResolved) {
        throw new InvalidArgumentError("Can\u2019t create resolved document comment thread", {
            displayMessage: errorDisplayMessage`You can\u2019t create a document comment thread as resolved. New document comment threads must start unresolved. Try again with \`- [ ] Unresolved\` or remove \`- [x] Resolved\` entirely.`,
        });
    }

    if (newPage.pagination) {
        throw new InvalidArgumentError(
            "Can\u2019t create document comment thread with pagination",
            {
                displayMessage: errorDisplayMessage`You can\u2019t include a next page link when creating a document comment thread. Try again without a next page link.`,
            },
        );
    }

    const quoteBlock = newPage.blocks[0];

    if (newPage.blocks.length === 1) {
        throw new InvalidArgumentError(
            "Must include at least one comment when creating a document comment thread",
            {
                displayMessage: errorDisplayMessage`When creating a document comment thread you must include at least one \`<comment>\` to start the thread. Try again and add a \`<comment>\` after your \`<blockquote>\`.`,
            },
        );
    }

    const firstCommentBlock = newPage.blocks[1]!;

    if (firstCommentBlock.type === "Time") {
        throw new InvalidArgumentError("Can only create comments (not `<time>`)", {
            displayMessage: errorDisplayMessage`Unexpected \`<time>\`, you can only add \`<comment>\`s. The creation time of comments will be decided by the server. Try again and remove the new \`<time>\`.`,
        });
    }

    const documentContent = zipKeysIntoApiContentResponse({
        content: documentPage.content,
        keys: documentReadResponse.pageMetadata.keys,
    });

    const ranges = Array.from(findApiContentRanges(documentContent, quoteBlock.content));

    // NOCOMMIT: Include a link to a skill with more information about content
    // matching.
    if (ranges.length === 0) {
        throw new InvalidArgumentError("Quoted document content not found", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find the quoted content in \`<blockquote>\` in \`${documentPath}\`. To create a document comment thread you must exactly recreate the content you\u2019re commenting on in \`<blockquote>\` so we can find the corresponding range in the document. Formatting is flexible when matching content so \`**needle**\` will match \`**foo needle bar**\` and \`- needle\` will match \`- foo needle bar\` because \`**needle**\` and \`- needle\` correctly match the word \u201Cneedle\u201D and have the right formatting. Simply \`needle\` without formatting will also match \`**foo needle bar**\` and \`- foo needle bar\` however \`_needle_\` will match neither because it has incorrect formatting. Your content in \`<blockquote>\` must be valid markdown so \`**foo needle\` won\u2019t match \`**foo needle bar**\` because the formatting (\`**\`) is unterminated, either \`**foo needle**\` or \`foo needle\` (without formatting) will match. Try again but make sure to exactly copy the content you want to comment in \`${documentPath}\` into a \`<blockquote>\`.`,
        });
    }

    if (
        quoteBlock.matchAttribute !== null &&
        (quoteBlock.matchAttribute < 1 || quoteBlock.matchAttribute > ranges.length)
    ) {
        throw new InvalidArgumentError("Quoted document content match out of bounds", {
            displayMessage: errorDisplayMessage`The \`<blockquote>\` \`match\` attribute must be between 1 and ${ranges.length}, instead it was \`match="${quoteBlock.matchAttribute}"\`. Try again with a valid 1-indexed \`match\` attribute.`,
        });
    }

    if (quoteBlock.matchAttribute === null && ranges.length > 1) {
        throw new InvalidArgumentError("Quoted document content found more than once", {
            displayMessage: errorDisplayMessage`${ranges.length} matches were found for the quoted content in \`<blockquote>\` in \`${documentPath}\`. Try again but provide more surrounding context to make your match unique or add a 1-indexed \`match\` attribute to \`<blockquote>\` to choose which match to use (e.g. \`<blockquote match="2">\` uses the second match).`,
        });
    }

    // Creation is placed in a `Lazy` since we want to create the document comment
    // thread at the last possible moment before it's needed. We want
    // `updateAgentWebDocumentThreadPage()` to run any validations first before we
    // create the document comment thread and then only right before
    // `updateAgentWebDocumentThreadPage()` tries to create new document comment thread
    // comments do we want to create the document comment thread.
    const createPromise = new Lazy<
        Promise<{
            thread: ApiDocumentThreadResponse;
            firstMessage: ApiMessageResponse;
            pageLink: AgentWebPageDocumentThreadRoutedLink;
        }>
    >(async () => {
        // TODO(#agents-web): Implement document comment thread creation endpoint.
        throw new UnimplementedError(
            "Document comment thread creation API endpoint hasn\u2019t been implemented yet",
        );
    });

    const pageMetadata = await updateAgentWebDocumentThreadPage(
        context,
        async () => {
            const {pageLink} = await createPromise.get();
            return await createAgentWebPageRoutedLinkPathname(context.storage, pageLink);
        },
        async () => {
            const {thread, firstMessage} = await createPromise.get();

            const keys =
                firstMessage.payload.type === "Content"
                    ? unzipKeysFromApiContentResponse(firstMessage.payload.content).keys
                    : [];

            return {
                type: "DocumentThread",
                id: thread.document.id,
                threadId: thread.id,
                isStartOfMessages: true,
                isEndOfMessages: true,
                messages: [{index: firstMessage.index, keys}],
            };
        },
        {...newPage, blocks: [quoteBlock, firstCommentBlock]},
        newPage,
    );

    const {pageLink} = await createPromise.get();

    return {pageMetadata, pageLink};
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
            if (oldCustomBlock.matchAttribute !== newCustomBlock.matchAttribute) {
                throw new InvalidArgumentError("Can\u2019t update document preview match", {
                    displayMessage: errorDisplayMessage`You can\u2019t update the \`<blockquote>\` \`match\` attribute in document comment thread markdown. \`<blockquote>\` is a read-only preview of the document\u2019s content around the comment and \`match\` is added when content in a document is repeated multiple times so you know which instance of the content the comment is for. Try again with a more specific update that only changes the content of comments from you or adds new comments. If you want to update the document\u2019s content then call the \`update\` tool on the document itself.`,
                });
            }

            const normalizedOldContent = normalizeApiContent(oldCustomBlock.content);
            const normalizedNewContent = normalizeApiContent(newCustomBlock.content);

            if (isDeepEqual(normalizedOldContent, normalizedNewContent)) return {update: asyncNoop};

            throw new InvalidArgumentError("Can\u2019t update document preview", {
                displayMessage: errorDisplayMessage`You can\u2019t update the \`<blockquote>\` in document comment thread markdown. \`<blockquote>\` is a read-only preview of the document\u2019s content around the comment. Try again with a more specific update that only changes the content of comments from you or adds new comments. If you want to update the document\u2019s content then call the \`update\` tool on the document itself.`,
            });
        },
    });

    const {id, threadId} = await unwrapMaybeThunk(oldPageMetadata);

    if (oldPage.preamble.type === "Head" && newPage.preamble.type === "Head") {
        if (oldPage.preamble.isResolved !== newPage.preamble.isResolved) {
            // TODO(#agents-web): Implement document comment thread resolve/unresolve endpoint.
            throw new UnimplementedError(
                "Document comment thread resolve/unresolve API endpoint hasn\u2019t been implemented yet",
            );
        }
    }

    return {...newPageMetadata, type: "DocumentThread", id, threadId};
}

export async function printAgentWebDocumentThreadPage(
    storage: AgentWebSessionStorage,
    pageLink: {document: {id: DocumentId}; threadId: DocumentCommentThreadId},
    page: AgentWebDocumentThreadPage,
): Promise<Root> {
    return await printAgentWebMessagingPage<
        {document: {id: DocumentId}; threadId: DocumentCommentThreadId},
        AgentWebDocumentThreadPagePreamble,
        AgentWebDocumentThreadPageCustomBlock
    >(storage, pageLink, page, {
        messageNouns: agentWebMessagingPageCommentNouns,
        printPreamble: async (storage, preamble) => {
            const preambleTree = await printApiContentToAgentWebMarkdownTree(storage, {
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

            if (preamble.type === "Tail") return preambleTree;

            return {
                type: "root",
                children: [
                    ...preambleTree.children,
                    {
                        type: "list",
                        ordered: false,
                        spread: false,
                        children: [
                            {
                                type: "listItem",
                                checked: preamble.isResolved,
                                spread: false,
                                children: [
                                    {
                                        type: "paragraph",
                                        children: [
                                            {
                                                type: "text",
                                                value: preamble.isResolved
                                                    ? "Resolved"
                                                    : "Unresolved",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
        },
        printCustomBlock: async (storage, block) => {
            const contentTree = await printApiContentToAgentWebMarkdownTree(
                storage,
                block.content,
                {documentId: pageLink.document.id},
            );

            let openTag = "<blockquote";

            if (block.hasCiteAttribute) {
                openTag += ` cite="../.."`;
            }

            if (block.matchAttribute !== null) {
                openTag += ` match="${block.matchAttribute}"`;
            }

            openTag += ">";

            return {
                type: "root",
                children: [
                    {type: "html", value: openTag},
                    ...contentTree.children,
                    {type: "html", value: "</blockquote>"},
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
    const {page} = await parseAgentWebDocumentThreadPageAndReturnDocumentPath(
        storage,
        pageLink,
        root,
    );
    return page;
}

export async function parseAgentWebDocumentThreadPageAndReturnDocumentPath(
    storage: AgentWebSessionStorage,
    pageLink: {document: {id: DocumentId}; threadId: DocumentCommentThreadId} | null,
    root: Root,
): Promise<{page: AgentWebDocumentThreadPage; documentPath: string}> {
    let documentPath: string | null = null;

    const page = await parseAgentWebMessagingPage(storage, pageLink, root, {
        messageNouns: agentWebMessagingPageCommentNouns,
        parsePreamble: async (storage, preamble): Promise<AgentWebDocumentThreadPagePreamble> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid document thread preamble", {
                    displayMessage: errorDisplayMessage`Document comment thread markdown must start with \`Document comment thread on [My Document](/document/my-document).\`. Optionally followed by \`- [ ] Unresolved\` or \`- [x] Resolved\`. Try again with a proper start to document comment thread markdown on line 1.`,
                });
            };

            const [documentPreambleNode, ...statePreambleNodes] = preamble.children;

            if (!documentPreambleNode) throw createError();

            const resolvedState = parseAgentWebDocumentThreadPageResolvedState(statePreambleNodes);
            if (resolvedState === null) throw createError();

            const preambleContent = await parseApiContentFromAgentWebMarkdownTree(storage, {
                type: "root",
                children: [documentPreambleNode],
            });

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
                firstElement.text !== "Document thread on " &&
                firstElement.text !== "Comment thread on " &&
                firstElement.text !== "Comments thread on " &&
                firstElement.text !== "Thread on "
            ) {
                throw createError();
            }

            const firstPreambleChild = assertExists(preamble.children[0]);
            assert(firstPreambleChild.type === "paragraph");
            const preambleLinkChild = assertExists(
                firstPreambleChild.children.find(child => child.type === "link"),
            );
            assert(preambleLinkChild.type === "link");

            documentPath = preambleLinkChild.url;

            if (resolvedState.type === "Present") {
                return {
                    type: "Head",
                    document: secondElement.reference,
                    isResolved: resolvedState.isResolved,
                };
            }

            return {type: "Tail", document: secondElement.reference};
        },
        parseCustomBlockByTagName: {
            blockquote: async (
                storage,
                root,
                {openTag, openTagPosition},
            ): Promise<AgentWebDocumentThreadPageCustomBlock> => {
                const {hasCiteAttribute, matchAttribute} =
                    parseAgentWebDocumentThreadPageBlockquoteOpenTag(openTag, openTagPosition);

                const content = await parseApiContentFromAgentWebMarkdownTree(storage, root, {
                    documentId: pageLink?.document.id ?? null,
                });

                return {
                    type: "Custom",
                    tagName: "blockquote",
                    timeAttribute: null,
                    hasCiteAttribute,
                    matchAttribute,
                    content,
                };
            },
        },
    });

    assert(documentPath !== null);

    const documentPreviewBlockIndexes: Array<number> = [];

    for (const [index, block] of page.blocks.entries()) {
        if (block.type === "Custom" && block.tagName === "blockquote") {
            documentPreviewBlockIndexes.push(index);
        }
    }

    if (documentPreviewBlockIndexes.length === 0) {
        if (page.preamble.type === "Head") {
            const resolvedState = page.preamble.isResolved
                ? `\`- [x] Resolved\``
                : `\`- [ ] Unresolved\``;

            throw new InvalidArgumentError(
                "Can\u2019t include resolved state on document thread tail page",
                {
                    displayMessage: errorDisplayMessage`${resolvedState} can only be included on the first page of a document comment thread, right before a \`<blockquote>\`. Try again and remove ${resolvedState}.`,
                },
            );
        }

        return {
            page: {
                ...page,
                type: "DocumentThread",
                subType: "Tail",
                preamble: page.preamble,
                blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
            },
            documentPath,
        };
    }

    if (documentPreviewBlockIndexes.length !== 1 || documentPreviewBlockIndexes[0] !== 0) {
        throw new InvalidArgumentError(
            "Must only have one document preview block at start of head page",
            {
                displayMessage: errorDisplayMessage`There must be only one \`<blockquote>\` and it must be placed immediately after the first line which states what document the thread is on (e.g. \`Document thread on [My Document](/document/my-document).\`). Try again with one \`<blockquote>\` at the start of the markdown.`,
            },
        );
    }

    return {
        page: {
            ...page,
            type: "DocumentThread",
            subType: "Head",
            preamble:
                page.preamble.type === "Head"
                    ? page.preamble
                    : {
                          type: "Head",
                          document: page.preamble.document,
                          isResolved: false,
                      },
            blocks: page.blocks as AgentWebDocumentThreadHeadPageBlocks,
        },
        documentPath,
    };
}

function parseAgentWebDocumentThreadPageResolvedState(
    nodes: ReadonlyArray<RootContent>,
): {type: "Absent"} | {type: "Present"; isResolved: boolean} | null {
    if (nodes.length === 0) return {type: "Absent"};
    if (nodes.length !== 1) return null;

    const node = nodes[0]!;
    if (node.type !== "list") return null;
    if (node.ordered) return null;
    if (node.children.length !== 1) return null;

    const item = node.children[0]!;
    if (item.checked !== true && item.checked !== false) return null;
    if (item.children.length !== 1) return null;

    const paragraph = item.children[0]!;
    if (paragraph.type !== "paragraph") return null;

    const text = printMarkdownPhrasingContentText(paragraph.children);
    if (text !== "Resolved" && text !== "Unresolved") return null;

    return {type: "Present", isResolved: item.checked};
}

function parseAgentWebDocumentThreadPageBlockquoteOpenTag(
    openTag: string,
    openTagPosition: Node["position"],
): {hasCiteAttribute: boolean; matchAttribute: number | null} {
    let hasBlockquoteOpenTag = false;
    let hasEndedBlockquoteOpenTag = false;
    let startedAttribute: "cite" | "match" | null = null;
    let citeAttribute: string | null = null;
    let matchAttributeString: string | null = null;

    const tokenizer = new HtmlTokenizer(
        {},
        {
            onopentagname: (start, end) => {
                const tagName = openTag.slice(start, end).toLowerCase();
                if (tagName !== "blockquote") return;

                hasBlockquoteOpenTag = true;
            },
            onopentagend: () => {
                if (hasBlockquoteOpenTag) {
                    assert(!startedAttribute);
                    hasEndedBlockquoteOpenTag = true;
                }
            },
            onattribname: (start, end) => {
                if (!hasBlockquoteOpenTag || hasEndedBlockquoteOpenTag) return;

                const attributeName = openTag.slice(start, end).toLowerCase();

                switch (attributeName) {
                    case "cite": {
                        startedAttribute = "cite";
                        citeAttribute = "";
                        break;
                    }
                    case "match": {
                        startedAttribute = "match";
                        matchAttributeString = "";
                        break;
                    }
                }
            },
            onattribdata: (start, end) => {
                const attributeData = openTag.slice(start, end);

                switch (startedAttribute) {
                    case "cite": {
                        citeAttribute += attributeData;
                        break;
                    }
                    case "match": {
                        matchAttributeString += attributeData;
                        break;
                    }
                }
            },
            onattribentity: codepoint => {
                const attributeData = String.fromCodePoint(codepoint);

                switch (startedAttribute) {
                    case "cite": {
                        citeAttribute += attributeData;
                        break;
                    }
                    case "match": {
                        matchAttributeString += attributeData;
                        break;
                    }
                }
            },
            onattribend: () => {
                startedAttribute = null;
            },
            onclosetag: () => {},
            onselfclosingtag: () => {},
            ontext: () => {},
            ontextentity: () => {},
            oncdata: () => {},
            oncomment: () => {},
            ondeclaration: () => {},
            onprocessinginstruction: () => {},
            onend: () => {},
        },
    );

    tokenizer.write(openTag);
    tokenizer.end();

    assert(hasBlockquoteOpenTag);

    const hasCiteAttribute = citeAttribute !== null;

    if (hasCiteAttribute && citeAttribute !== "../..") {
        throw new InvalidArgumentError("Invalid document quote cite attribute", {
            displayMessage: errorDisplayMessage`Invalid \`<blockquote>\` \`cite\` attribute on line ${openTagPosition?.start.line ?? "unknown"}. The \`<blockquote>\` \`cite\` attribute must always be \`cite="../.."\` since we always want to quote content from the parent document. Try again with \`cite="../.."\` or omit the \`cite\` attribute entirely (\`cite="../.."\` is implied).`,
        });
    }

    if (matchAttributeString === null) {
        return {hasCiteAttribute, matchAttribute: null};
    }

    const matchAttribute = parseInt(matchAttributeString, 10);

    if (!/^-?[0-9]+$/.test(matchAttributeString) || !Number.isSafeInteger(matchAttribute)) {
        throw new InvalidArgumentError("Invalid document quote match attribute", {
            displayMessage: errorDisplayMessage`Invalid \`<blockquote>\` \`match\` attribute on line ${openTagPosition?.start.line ?? "unknown"}. Try again with a 1-indexed integer like \`match="2"\`.`,
        });
    }

    return {hasCiteAttribute, matchAttribute};
}
