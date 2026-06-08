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
    AgentWebMessagingPagePaginationPageLink,
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
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiChannelReferenceResponse,
    ApiContentResponse,
    ApiPostReferenceResponse,
    ApiPostResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type AgentWebPostPage = AgentWebMessagingPage<
    AgentWebPostPagePreamble,
    AgentWebPostPageCustomBlock
> & {
    readonly type: "Post";
};

export type AgentWebPostPagePreamble = {};

export type AgentWebPostPageCustomBlock = {
    readonly type: "Custom";
    readonly author: ApiAccountReferenceResponse;
    readonly channel: ApiChannelReferenceResponse | null;
    readonly content: ApiContentResponse;
};

export type AgentWebPostPagePost = {
    readonly author: ApiAccountReferenceResponse;
    readonly channel: Extract<AgentWebPageStoredLink, {type: "Channel"}> | null;
    readonly timeContent: string;
    readonly content: ApiContentResponse;
};

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

    const loadRoomMetadata = async (): Promise<{
        pageLink: AgentWebMessagingPagePaginationPageLink;
        preamble: AgentWebPostPagePreamble;
        startCustomBlock: {
            time: Date;
            block: AgentWebPostPageCustomBlock;
        } | null;
    }> => {
        if (fullPostPromise !== null) {
            const post = await fullPostPromise;

            const postReference: ApiPostReferenceResponse = {
                type: "Post",
                id,
                title: post.reference.title,
            };

            return {
                pageLink: postReference,
                preamble: {},
                startCustomBlock: {
                    time: deserializeDateString(post.createdTime),
                    block: {
                        type: "Custom",
                        author: intoApiAccountReference(post.author),
                        channel: post.channel
                            ? {
                                  type: "Channel",
                                  id: post.channel.id,
                                  title: post.channel.name,
                              }
                            : null,
                        content: post.content,
                    },
                },
            };
        }

        const {
            data: {reference: postReference},
        } = await context.api.get(context.span, "/posts/{id}/reference", {
            params: {path: {id}},
        });

        return {
            pageLink: postReference,
            preamble: {},
            startCustomBlock: null,
        };
    };

    switch (parsedSearchParams.type) {
        case "Direction": {
            switch (parsedSearchParams.direction) {
                case "Start": {
                    if (
                        parsedSearchParams.startCursor === null ||
                        parsedSearchParams.startCursor < -1
                    ) {
                        // We're at the start of the page, preload the full post because we'll want to try
                        // fitting it into the page.
                        void loadFullPost();
                    }
                    break;
                }
                case "End": {
                    // Loads the full post even if we don't need it. The post may be truncated if it
                    // doesn't fit within the limit.
                    //
                    // Edge case: if you use a "before" value that's larger than the number of messages
                    // and there are less than `agentWebMessagingPageApiMessagesBatchCount` (30)
                    // messages we won't show the post. For example, if there are 5 messages and you
                    // use `?before=100`. We'll only load the first 5 messages and we won't show the
                    // post because according to this math the post won't be visible on the page. This
                    // is a bug. Ideally we wouldn't allow `?before=100` at all but for consistent
                    // cursor based pagination across our API we treat `?before=100` as a "last 30
                    // messages <100" constraint and not messages between 70 and 100 constraint.
                    //
                    // NOCOMMIT: Test this edge case
                    if (
                        parsedSearchParams.startCursor !== null &&
                        parsedSearchParams.startCursor -
                            agentWebMessagingPageApiMessagesBatchCount <
                            -1
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

            const {response, metadata} = await readAgentWebMessagingPageInDirection(context, {
                messageNouns: agentWebMessagingPageCommentNouns,
                room: {type: "Post", id},
                roomMetadataPromise: loadRoomMetadata(),
                direction: parsedSearchParams.direction,
                startCursor: parsedSearchParams.startCursor,
                limitLength,
                printPage: page => printPage(buildAgentWebPostPage(page, id)),
            });

            return {response, metadata: {...metadata, type: "Post", id}};
        }
        case "Around": {
            // Loads the full post even if we don't need it. The post may be truncated if it
            // doesn't fit within the limit.
            if (
                getReadAgentWebMessagingPageAroundMessageStartCursor(parsedSearchParams.around) < -1
            ) {
                // We'll be loading messages up to the first comment. Preload the full post so we
                // can try fitting it into the page.
                void loadFullPost();
            }

            const {response, metadata} = await readAgentWebMessagingPageAroundMessage(context, {
                messageNouns: agentWebMessagingPageCommentNouns,
                room: {type: "Post", id},
                roomMetadataPromise: loadRoomMetadata(),
                around: parsedSearchParams.around,
                limitLength,
                printPage: page => printPage(buildAgentWebPostPage(page, id)),
            });

            return {response, metadata: {...metadata, type: "Post", id}};
        }
        default:
            throw exhaustive(parsedSearchParams);
    }
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
    return await readAgentWebPostPage(context, id, {
        searchParams: new URLSearchParams([["comment", String(index)]]),
        limitLength,
        printPage,
    });
}

export function normalizeAgentWebPostPage<Page extends AgentWebPostPage>(page: Page): Page {
    return normalizeAgentWebMessagingPage(page, {
        normalizePreamble: () => {},
        normalizeCustomBlock: (normalizer, customBlock) => {
            if (customBlock.channel) normalizer.normalizeReference(customBlock.channel);
            normalizer.normalizeReference(customBlock.author);
            normalizer.normalizeBlockElements(customBlock.content.elements);
        },
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
