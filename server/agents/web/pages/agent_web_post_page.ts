import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, Link, Node, Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
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
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiChannelReferenceResponse,
    ApiContentResponse,
    ApiPostResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type AgentWebPostPage = AgentWebMessagingPage<
    AgentWebPostPagePreamble,
    AgentWebPostPageCustomBlock
> & {
    readonly type: "Post";
};

export type AgentWebPostPagePreamble = {
    readonly channel: ApiChannelReferenceResponse | null;
};

export type AgentWebPostPageCustomBlock = {
    readonly type: "Custom";
    readonly author: ApiAccountReferenceResponse;
    readonly timeZoneAttribute: string | null;
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
    page: AgentWebMessagingPageWithMetadata<AgentWebPostPagePreamble, AgentWebPostPageCustomBlock>,
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

            const postCreatedTime = deserializeDateString(post.createdTime);

            return {
                pageLink: {
                    type: "Post",
                    id,
                    title: post.reference.title,
                },
                preamble: {
                    channel: post.channel
                        ? {
                              type: "Channel",
                              id: post.channel.id,
                              title: post.channel.name,
                          }
                        : null,
                },
                startCustomBlock: {
                    time: postCreatedTime,
                    block: {
                        type: "Custom",
                        author: intoApiAccountReference(post.author),
                        timeZoneAttribute:
                            post.createdTimeZone !== context.timeZone
                                ? formatTimeZoneAbbreviation(post.createdTimeZone, postCreatedTime)
                                : null,
                        content: post.content,
                    },
                },
            };
        }

        const {
            data: {post},
        } = await context.api.get(context.span, "/posts/{id}/preview", {
            params: {path: {id}},
        });

        return {
            pageLink: {
                type: "Post",
                id,
                title: post.reference.title,
            },
            preamble: {
                channel: post.channel
                    ? {
                          type: "Channel",
                          id: post.channel.id,
                          title: post.channel.name,
                      }
                    : null,
            },
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
        normalizePreamble: (normalizer, preamble) => {
            if (preamble.channel) normalizer.normalizeReference(preamble.channel);
        },
        normalizeCustomBlock: (normalizer, customBlock) => {
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
        printPreamble: async (storage, preamble) => {
            return await printApiContentToAgentWebMarkdownTree(storage, {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Post and comments"},
                            ...(preamble.channel
                                ? [
                                      {type: "Text" as const, text: " in "},
                                      {type: "Mention" as const, reference: preamble.channel},
                                  ]
                                : []),
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            });
        },
        printCustomBlock: async (storage, block) => {
            const [authorPathname, contentTree] = await runAllPromises([
                createAgentWebPageStoredLinkPathname(storage, block.author),
                printApiContentToAgentWebMarkdownTree(storage, block.content),
            ]);

            const authorLink: Link = {
                type: "link",
                url: authorPathname,
                children: [{type: "text", value: block.author.shortName}],
            };
            let openTag = `<post from="${escapeHtml(printMarkdownTree(authorLink).trim())}"`;

            if (block.timeZoneAttribute !== null) {
                openTag += ` timezone="${escapeHtml(block.timeZoneAttribute)}"`;
            }

            openTag += ">";

            return {
                type: "root",
                children: [
                    {
                        type: "html",
                        value: openTag,
                    },
                    ...contentTree.children,
                    {
                        type: "html",
                        value: "</post>",
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
        parsePreamble: async (storage, preamble): Promise<AgentWebPostPagePreamble> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid post preamble", {
                    displayMessage: errorDisplayMessage`Post markdown must start with \`Post and comments in [My Channel](/channel/my-channel).\`. Try again with a proper start to post markdown on line 1.`,
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

            if (
                elements.length === 1 &&
                elements[0]!.type === "Text" &&
                (elements[0]!.text === "Post and comments" ||
                    elements[0]!.text === "Post and comments.")
            ) {
                return {channel: null};
            }

            const lastElement = elements[elements.length - 1]!;
            const hasTrailingPeriod = lastElement.type === "Text" && lastElement.text === ".";
            const actualElements = hasTrailingPeriod ? elements.slice(0, -1) : elements;

            if (actualElements.length !== 2) throw createError();

            const [firstElement, secondElement] = actualElements;

            if (
                firstElement?.type !== "Text" ||
                firstElement.text !== "Post and comments in " ||
                secondElement?.type !== "Mention" ||
                secondElement.reference.type !== "Channel"
            ) {
                throw createError();
            }

            return {channel: secondElement.reference};
        },
        parseCustomBlockByTagName: {
            post: async (
                storage,
                root,
                {openTag, openTagPosition},
            ): Promise<AgentWebPostPageCustomBlock> => {
                const {fromAttribute, timeZoneAttribute} =
                    parseAgentWebPostPageCustomBlockOpenTag(openTag);

                if (typeof fromAttribute !== "string") {
                    throw new InvalidArgumentError("Post element is missing author link", {
                        displayMessage: errorDisplayMessage`\`<post>\` on line ${openTagPosition?.start.line ?? "unknown"} is missing the \`from\` attribute. The post must include a link to the author.`,
                    });
                }

                const [author, content] = await runAllPromises([
                    parseAgentWebPostPageAccountLink(storage, openTagPosition, fromAttribute),
                    parseApiContentFromAgentWebMarkdownTree(storage, root),
                ]);

                return {
                    type: "Custom",
                    author,
                    timeZoneAttribute,
                    content,
                };
            },
        },
    });

    return {...page, type: "Post"};
}

function parseAgentWebPostPageCustomBlockOpenTag(openTag: string): {
    fromAttribute: string | null;
    timeZoneAttribute: string | null;
} {
    let hasPostOpenTag = false;
    let hasEndedPostOpenTag = false;
    let startedAttribute: "from" | "timezone" | null = null;
    let fromAttribute: string | null = null;
    let timeZoneAttribute: string | null = null;

    const tokenizer = new HtmlTokenizer(
        {},
        {
            onopentagname: (start, end) => {
                const tagName = openTag.slice(start, end).toLowerCase();
                if (tagName !== "post") return;

                hasPostOpenTag = true;
            },
            onopentagend: () => {
                if (hasPostOpenTag) {
                    assert(!startedAttribute);
                    hasEndedPostOpenTag = true;
                }
            },
            onattribname: (start, end) => {
                if (!hasPostOpenTag || hasEndedPostOpenTag) return;

                const attributeName = openTag.slice(start, end).toLowerCase();
                if (attributeName === "from") {
                    startedAttribute = "from";
                    fromAttribute = "";
                } else if (attributeName === "timezone") {
                    startedAttribute = "timezone";
                    timeZoneAttribute = "";
                }
            },
            onattribdata: (start, end) => {
                const attributeData = openTag.slice(start, end);

                switch (startedAttribute) {
                    case "from": {
                        fromAttribute += attributeData;
                        break;
                    }
                    case "timezone": {
                        timeZoneAttribute += attributeData;
                        break;
                    }
                }
            },
            onattribentity: codepoint => {
                const attributeData = String.fromCodePoint(codepoint);

                switch (startedAttribute) {
                    case "from": {
                        fromAttribute += attributeData;
                        break;
                    }
                    case "timezone": {
                        timeZoneAttribute += attributeData;
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

    assert(hasPostOpenTag);

    return {
        fromAttribute,
        timeZoneAttribute,
    };
}

async function parseAgentWebPostPageAccountLink(
    storage: AgentWebSessionStorage,
    position: Html["position"],
    string: string,
): Promise<ApiAccountReferenceResponse> {
    const createError = () => {
        const quotedString = quoteMarkdown([{type: "text", value: string}]);

        return new InvalidArgumentError("Invalid account link", {
            displayMessage: errorDisplayMessage`Expected a link to a human or bot on line ${position?.start.line ?? "unknown"}. For example: \u201C[John](/human/john-doe)\u201D. Instead we found ${quotedString}. Try again with a valid link to a human or bot.`,
        });
    };

    const root = parseMarkdownTree(string);
    if (root.children.length !== 1) throw createError();

    const firstChild = root.children[0]!;
    if (firstChild.type !== "paragraph") throw createError();
    if (firstChild.children.length !== 1) throw createError();

    const firstGrandchild = firstChild.children[0]!;
    if (firstGrandchild.type !== "link") throw createError();

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, firstGrandchild.url);
    if (!pageLinkResult) throw createError();

    const {pageLink} = pageLinkResult;
    if (pageLink.type !== "Account") throw createError();

    return pageLink;
}
