import {Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageMetadata,
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
    readAgentWebMessagingPage,
    readAgentWebMessagingPageAroundMessage,
    readAgentWebMessagingPageInDirection,
} from "~/server/agents/web/pages/messaging/read_agent_web_messaging_page.js";
import {updateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/update_agent_web_messaging_page.js";
import {
    ApiPostResponse,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type AgentWebPostPage = AgentWebMessagingPage<AgentWebPostPagePreamble> & {
    readonly type: "Post";
};

export type AgentWebPostPagePreamble = {};

export type AgentWebPostPageWithMetadata = AgentWebPostPage & {
    readonly metadata: AgentWebPostPageMetadata;
};

export type AgentWebPostPageMetadata = AgentWebMessagingPageMetadata & {
    readonly type: "Post";
    readonly id: PostId;
};

function buildAgentWebPostPage(
    page: AgentWebMessagingPageWithMetadata<AgentWebPostPagePreamble>,
    id: PostId,
): AgentWebPostPageWithMetadata {
    return {
        ...page,
        type: "Post",
        metadata: buildAgentWebPostPageMetadata(page.metadata, id),
    };
}

function buildAgentWebPostPageMetadata(
    metadata: AgentWebMessagingPageMetadata,
    id: PostId,
): AgentWebPostPageMetadata {
    return {...metadata, type: "Post", id};
}

export async function readAgentWebPostPage(
    context: AgentWebContext,
    id: PostId,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebPostPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebPostPageMetadata}> {
    const parsedSearchParams = parseAgentWebMessagingPageSearchParams({
        messageNouns: agentWebMessagingPageCommentNouns,
        defaultDirection: "Start",
        searchParams,
    });

    let fullPostPromise: Promise<ApiPostResponse> | null = null;

    const loadFullPost = () => {
        fullPostPromise ??= (async () => {
            const {
                data: {post},
            } = await context.api.get(context.span, "/posts/{id}", {params: {path: {id}}});

            return post;
        })();

        return fullPostPromise;
    };

    const loadRoomMetadata = (): Promise<{
        pageLink: AgentWebMessagingPagePaginationPageLink;
        preamble: AgentWebPostPagePreamble;
    }> => {
        if (fullPostPromise !== null) {
            return fullPostPromise.then(post => {
                const postReference: ApiPostReferenceResponse = {
                    type: "Post",
                    id,
                    title,
                };

                return {
                    preamble: {},
                };
            });
        }
    };

    switch (parsedSearchParams.type) {
        case "Direction": {
            switch (parsedSearchParams.direction) {
                case "Start": {
                    if (
                        parsedSearchParams.startCursor === null ||
                        parsedSearchParams.startCursor < 0
                    ) {
                        // We're at the start of the page, preload the full post because we'll want to try
                        // fitting it into the page.
                        void loadFullPost();
                    }
                    break;
                }
                case "End": {
                    // NOCOMMIT: Doesn't work in all cases
                    if (
                        parsedSearchParams.startCursor !== null &&
                        parsedSearchParams.startCursor -
                            agentWebMessagingPageApiMessagesBatchCount <
                            0
                    ) {
                        // We'll be loading messages up to the first comment. Preload the full post so we
                        // can try fitting it into the page.
                        void loadFullPost();
                    }
                    break;
                }
                default:
                    throw exhaustive(parsedSearchParams.direction);
            }

            return await readAgentWebMessagingPageInDirection(context, {
                messageNouns: agentWebMessagingPageCommentNouns,
                room: {type: "Post", id},
                roomMetadataPromise,
                direction: parsedSearchParams.direction,
                startCursor: parsedSearchParams.startCursor,
                limitLength,
                printPage: page => printPage(buildAgentWebPostPage(page, id)),
            });
        }
        case "Around": {
            // NOCOMMIT: Doesn't work in all cases
            if (
                getReadAgentWebMessagingPageAroundMessageStartCursor(parsedSearchParams.around) < 0
            ) {
                // We'll be loading messages up to the first comment. Preload the full post so we
                // can try fitting it into the page.
                void loadFullPost();
            }

            return await readAgentWebMessagingPageAroundMessage(context, {
                messageNouns: agentWebMessagingPageCommentNouns,
                room: {type: "Post", id},
                roomMetadataPromise,
                around: parsedSearchParams.around,
                limitLength,
                printPage: page => printPage(buildAgentWebPostPage(page, id)),
            });
        }
        default:
            throw exhaustive(parsedSearchParams);
    }

    const result = await readAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        room: {type: "Post", id},
        roomMetadataPromise: getPostRoomMetadata(context, id),
        defaultDirection: "Start",
        searchParams,
        limitLength,
        printPage: page => printPage(buildAgentWebPostPage(page, id)),
    });

    return {
        response: result.response,
        metadata: buildAgentWebPostPageMetadata(result.metadata, id),
    };
}

export async function readAgentWebPostMessagePage(
    context: AgentWebContext,
    id: PostId,
    index: number,
    {
        limitLength,
        printPage,
    }: {
        limitLength: number;
        printPage: (page: AgentWebPostPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebPostPageMetadata}> {
    const result = await readAgentWebMessagingPageAroundMessage(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        room: {type: "Post", id},
        roomMetadataPromise: getPostRoomMetadata(context, id),
        around: {startMessageIndex: index, endMessageIndex: index + 1},
        limitLength,
        printPage: page => printPage(buildAgentWebPostPage(page, id)),
    });

    return {
        response: result.response,
        metadata: buildAgentWebPostPageMetadata(result.metadata, id),
    };
}

async function getPostRoomMetadata(
    context: AgentWebContextWithoutStorage,
    id: PostId,
): Promise<{
    pageLink: Extract<AgentWebPageStoredLink, {type: "Post"}>;
    preamble: AgentWebPostPagePreamble;
}> {
    const {
        data: {
            mention: {target},
        },
    } = await context.api.get(context.span, "/posts/{id}/mention", {
        params: {path: {id}},
    });

    return {
        pageLink: target,
        preamble: {},
    };
}

export function normalizeAgentWebPostPage<Page extends AgentWebPostPage>(page: Page): Page {
    return normalizeAgentWebMessagingPage(page, {
        normalizePreamble: () => {},
    });
}

export async function updateAgentWebPostPage(
    context: AgentWebContextWithoutStorage,
    pathname: string,
    oldPageMetadata: AgentWebPostPageMetadata,
    oldPage: AgentWebPostPage,
    newPage: AgentWebPostPage,
): Promise<AgentWebPostPageMetadata> {
    const newPageMetadata = await updateAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        pathname,
        room: {type: "Post", id: oldPageMetadata.id},
        oldPageMetadata,
        oldPage,
        newPage,
    });

    return {...newPageMetadata, type: "Post", id: oldPageMetadata.id};
}

export async function printAgentWebPostPage(
    storage: AgentWebSessionStorage,
    id: PostId,
    page: AgentWebPostPage,
): Promise<Root> {
    return await printAgentWebMessagingPage(storage, id, page, {
        messageNouns: agentWebMessagingPageCommentNouns,
        printPreamble: async () => {
            return {
                type: "root",
                children: [
                    {
                        type: "paragraph",
                        children: [{type: "text", value: "Comments on post."}],
                    },
                ],
            };
        },
    });
}

export async function parseAgentWebPostPage(
    storage: AgentWebSessionStorage,
    id: PostId | null,
    root: Root,
): Promise<AgentWebPostPage> {
    const page = await parseAgentWebMessagingPage(storage, id, root, {
        messageNouns: agentWebMessagingPageCommentNouns,
        parsePreamble: async (_storage, preamble): Promise<AgentWebPostPagePreamble> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid post preamble", {
                    displayMessage: errorDisplayMessage`Post comments markdown must start with \`Comments on post.\`. Try again with a proper start to post comments markdown on line 1.`,
                });
            };

            if (preamble.children.length !== 1) {
                throw createError();
            }

            const child = preamble.children[0]!;

            if (
                child.type !== "paragraph" ||
                child.children.length !== 1 ||
                child.children[0]?.type !== "text" ||
                child.children[0].value !== "Comments on post."
            ) {
                throw createError();
            }

            return {};
        },
    });

    return {...page, type: "Post"};
}
