import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, Link, Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPagePaginationPageLink,
    AgentWebMessagingPageTimeBlock,
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
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type AgentWebPostPage = {
    readonly type: "Post";
    readonly pagination: AgentWebMessagingPagePagination<AgentWebPostPageCustomBlock> | null;
    readonly isEndOfMessages: boolean;
} & (
    | {
          readonly subType: "HeadPage";
          readonly preamble: AgentWebPostPageHeadPagePreamble;
          readonly blocks: readonly [
              AgentWebMessagingPageTimeBlock,
              AgentWebPostPageCustomBlock,
              ...ReadonlyArray<AgentWebMessagingPageBlock<never>>,
          ];
      }
    | {
          readonly subType: "TailPage";
          readonly preamble: AgentWebPostPageTailPagePreamble;
          readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock<never>>;
      }
);

export type AgentWebPostPageBase = AgentWebMessagingPage<
    AgentWebPostPagePreambleBase,
    AgentWebPostPageCustomBlock
> & {
    readonly type: "Post";
    readonly subType: "HeadPage" | "TailPage";
};

export type AgentWebPostPagePreambleBase =
    | AgentWebPostPageHeadPagePreamble
    | AgentWebPostPageTailPagePreamble;

assertAssignableTypes<AgentWebPostPage, AgentWebPostPageBase>();

export type AgentWebPostPageHeadPagePreamble = {
    readonly type: "HeadPage";
    readonly channel: ApiChannelReferenceResponse | null;
};

export type AgentWebPostPageTailPagePreamble = {
    readonly type: "TailPage";
    readonly post: ApiPostReferenceResponse;
};

export type AgentWebPostPageCustomBlock = {
    readonly type: "Custom";
    readonly tagName: "post";
    readonly author: ApiAccountReferenceResponse;
    readonly timeAttribute: null;
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
    page: AgentWebMessagingPageWithMetadata<
        AgentWebPostPagePreambleBase,
        AgentWebPostPageCustomBlock
    >,
    id: PostId,
): AgentWebPostPageWithMetadata {
    switch (page.preamble.type) {
        case "HeadPage": {
            assert(page.blocks[0]?.type === "Time");
            assert(page.blocks[1]?.type === "Custom");
            assert(page.blocks.slice(2).every(block => block.type !== "Custom"));

            return {
                ...page,
                type: "Post",
                subType: "HeadPage",
                preamble: page.preamble,
                blocks: page.blocks as readonly [
                    AgentWebMessagingPageTimeBlock,
                    AgentWebPostPageCustomBlock,
                    ...ReadonlyArray<AgentWebMessagingPageBlock<never>>,
                ],
                metadata: buildAgentWebPostPageMetadata(page.metadata, id),
            };
        }
        case "TailPage": {
            assert(page.blocks.every(block => block.type !== "Custom"));

            return {
                ...page,
                type: "Post",
                subType: "TailPage",
                preamble: page.preamble,
                blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
                metadata: buildAgentWebPostPageMetadata(page.metadata, id),
            };
        }
        default:
            throw exhaustive(page.preamble);
    }
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
        searchParams: originalSearchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebPostPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebPostPageMetadata}> {
    let excludesPost = false;

    const searchParams = new URLSearchParams(originalSearchParams);

    if (searchParams.get("after") === "post") {
        excludesPost = true;
        searchParams.delete("after");
        searchParams.set("start", "");
    }

    if (searchParams.get("before") === "post") {
        excludesPost = true;
        searchParams.set("before", "0");
    }

    const parsedSearchParams = parseAgentWebMessagingPageSearchParams({
        messageNouns: agentWebMessagingPageCommentNouns,
        defaultDirection: "Start",
        searchParams,
    });

    type RoomMetadata = {
        pageLink: AgentWebMessagingPagePaginationPageLink;
        preamble: AgentWebPostPagePreambleBase;
        startCustomBlock: {
            time: Date;
            block: AgentWebPostPageCustomBlock;
        } | null;
    };

    const roomMetadataWithStartCustomBlock = new Lazy<Promise<RoomMetadata>>(async () => {
        // If `excludesPost` is set then never return a post start block.
        if (excludesPost) return await roomMetadataWithoutStartCustomBlock.get();

        const {
            data: {post},
        } = await context.api.get(context.span, "/posts/{id}", {params: {path: {id}}});

        const postCreatedTime = deserializeDateString(post.createdTime);

        return {
            pageLink: {
                type: "Post",
                id,
                title: post.reference.title,
            },
            preamble: {
                type: "HeadPage",
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
                    tagName: "post",
                    author: intoApiAccountReference(post.author),
                    timeAttribute: null,
                    timeZoneAttribute:
                        post.createdTimeZone !== context.timeZone
                            ? formatTimeZoneAbbreviation(post.createdTimeZone, postCreatedTime)
                            : null,
                    content: post.content,
                },
            },
        };
    });

    const roomMetadataWithoutStartCustomBlock = new Lazy<Promise<RoomMetadata>>(async () => {
        const {
            data: {reference: postReference},
        } = await context.api.get(context.span, "/posts/{id}/reference", {
            params: {path: {id}},
        });

        return {
            pageLink: postReference,
            preamble: {
                type: "TailPage",
                post: postReference,
            },
            startCustomBlock: null,
        };
    });

    switch (parsedSearchParams.type) {
        case "Direction": {
            let roomMetadataPromise: Promise<RoomMetadata>;

            switch (parsedSearchParams.direction) {
                case "Start": {
                    if (
                        parsedSearchParams.startCursor === null ||
                        parsedSearchParams.startCursor < -1
                    ) {
                        // We're at the start of the page, preload the full post because we'll want to try
                        // fitting it into the page.
                        roomMetadataPromise = roomMetadataWithStartCustomBlock.get();
                    } else {
                        roomMetadataPromise = roomMetadataWithoutStartCustomBlock.get();
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
                    if (
                        parsedSearchParams.startCursor !== null &&
                        parsedSearchParams.startCursor -
                            agentWebMessagingPageApiMessagesBatchCount <
                            -1
                    ) {
                        // We'll be loading messages up to the first comment. Preload the full post so we
                        // can try fitting it into the page.
                        roomMetadataPromise = roomMetadataWithStartCustomBlock.get();
                    } else {
                        roomMetadataPromise = roomMetadataWithoutStartCustomBlock.get();
                    }
                    break;
                }
                default:
                    throw exhaustive(parsedSearchParams.direction);
            }

            const [, {response, metadata}] = await runAllPromises([
                roomMetadataPromise,
                readAgentWebMessagingPageInDirection(context, {
                    messageNouns: agentWebMessagingPageCommentNouns,
                    room: {type: "Post", id},
                    getRoomMetadata: async ({isStartOfMessages}) => {
                        const roomMetadata = await roomMetadataPromise;

                        // If there is no start custom block loaded but we're at the start of the message
                        // list, then load the full post so we can include it as a start block. Slightly
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
                    printPage: page => printPage(buildAgentWebPostPage(page, id)),
                }),
            ]);

            return {response, metadata: {...metadata, type: "Post", id}};
        }
        case "Around": {
            let roomMetadataPromise: Promise<RoomMetadata>;

            // Loads the full post even if we don't need it. The post may be truncated if it
            // doesn't fit within the limit.
            if (
                getReadAgentWebMessagingPageAroundMessageStartCursor(parsedSearchParams.around) < -1
            ) {
                // We'll be loading messages up to the first comment. Preload the full post so we
                // can try fitting it into the page.
                roomMetadataPromise = roomMetadataWithStartCustomBlock.get();
            } else {
                roomMetadataPromise = roomMetadataWithoutStartCustomBlock.get();
            }

            const [, {response, metadata}] = await runAllPromises([
                roomMetadataPromise,
                readAgentWebMessagingPageAroundMessage(context, {
                    messageNouns: agentWebMessagingPageCommentNouns,
                    room: {type: "Post", id},
                    getRoomMetadata: async ({isStartOfMessages}) => {
                        const roomMetadata = await roomMetadataPromise;

                        // If there is no start custom block loaded but we're at the start of the message
                        // list, then load the full post so we can include it as a start block. Slightly
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
                    printPage: page => printPage(buildAgentWebPostPage(page, id)),
                }),
            ]);

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
            switch (preamble.type) {
                case "HeadPage": {
                    if (preamble.channel) normalizer.normalizeReference(preamble.channel);
                    break;
                }
                case "TailPage": {
                    normalizer.normalizeReference(preamble.post);
                    break;
                }
                default:
                    throw exhaustive(preamble);
            }
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
    return await printAgentWebMessagingPage<
        PostId,
        AgentWebPostPagePreambleBase,
        AgentWebPostPageCustomBlock
    >(storage, id, page, {
        messageNouns: agentWebMessagingPageCommentNouns,
        printPreamble: async (storage, preamble) => {
            switch (preamble.type) {
                case "HeadPage": {
                    return await printApiContentToAgentWebMarkdownTree(storage, {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Post"},
                                    ...(preamble.channel
                                        ? [
                                              {type: "Text" as const, text: " in "},
                                              {
                                                  type: "Mention" as const,
                                                  reference: preamble.channel,
                                              },
                                          ]
                                        : [
                                              {
                                                  type: "Text" as const,
                                                  text: " that\u2019s not in any channel",
                                              },
                                          ]),
                                    {type: "Text", text: "."},
                                ],
                            },
                        ],
                    });
                }
                case "TailPage": {
                    const preambleTree = await printApiContentToAgentWebMarkdownTree(storage, {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Comments on "},
                                    {type: "Mention" as const, reference: preamble.post},
                                    {type: "Text", text: "."},
                                ],
                            },
                        ],
                    });

                    assert(preambleTree.children.length === 1);
                    assert(preambleTree.children[0]!.type === "paragraph");
                    assert(preambleTree.children[0].children.length === 3);
                    assert(preambleTree.children[0].children[1]!.type === "link");
                    preambleTree.children[0].children[1].children = [{type: "text", value: "post"}];

                    return preambleTree;
                }
                default:
                    throw exhaustive(preamble);
            }
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
        parsePreamble: async (storage, preamble): Promise<AgentWebPostPagePreambleBase> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid post preamble", {
                    displayMessage: errorDisplayMessage`Post markdown must start with \`Post in [My Channel](/channel/my-channel).\` or \`Comments on [post](/post/my-post).\`. Try again with a proper start to post markdown on line 1.`,
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

            if (elements.length === 1 && elements[0]!.type === "Text") {
                switch (elements[0]!.text) {
                    case "Post that\u2019s not in any channel":
                    case "Post that\u2019s not in any channel.": {
                        return {type: "HeadPage", channel: null};
                    }
                    default:
                        throw createError();
                }
            }

            const lastElement = elements[elements.length - 1]!;
            const hasTrailingPeriod = lastElement.type === "Text" && lastElement.text === ".";
            const actualElements = hasTrailingPeriod ? elements.slice(0, -1) : elements;

            if (actualElements.length !== 2) throw createError();

            const [firstElement, secondElement] = actualElements;

            if (firstElement?.type !== "Text" || secondElement?.type !== "Mention") {
                throw createError();
            }

            switch (firstElement.text) {
                case "Post in ": {
                    if (secondElement.reference.type !== "Channel") throw createError();
                    return {type: "HeadPage", channel: secondElement.reference};
                }
                case "Comments on ": {
                    if (secondElement.reference.type !== "Post") throw createError();
                    return {type: "TailPage", post: secondElement.reference};
                }
                default:
                    throw createError();
            }
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
                    tagName: "post",
                    author,
                    timeAttribute: null,
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
