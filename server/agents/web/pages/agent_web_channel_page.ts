import {fromDate, toCalendarDate} from "@internationalized/date";
import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {produce} from "immer";
import {Html, Link, Parent, PhrasingContent, Root, RootContent} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {normalizeApiContent} from "~/shared/api/markdown/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountReferenceResponse,
    ApiPostPreviewResponse,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {
    DateString,
    deserializeDateString,
    isDateString,
} from "~/shared/helpers/date/date_string.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";

export const agentWebChannelPageApiPostsBatchCount = 15;
export const agentWebChannelPageNextPageLinkText = "Next page »";

export type AgentWebChannelPage = {
    readonly type: "Channel";
    readonly name: string;
    readonly pagination: AgentWebChannelPagePagination | null;
    readonly posts: ReadonlyArray<AgentWebChannelPagePostBlock>;
    readonly isEndOfPosts: boolean;
} & (
    | {
          readonly subType: "Head";
          readonly description: ApiContentResponseWithoutKeys;
      }
    | {
          readonly subType: "Tail";
      }
);

export type AgentWebChannelPagePagination = {
    readonly nextCursor: string;
};

export type AgentWebChannelPagePostBlock = {
    readonly type: "Post";
    readonly author: ApiAccountReferenceResponse | null;
    readonly timeAttribute: string | null;
    readonly contentSnippet: ApiContentResponseWithoutKeys;
    readonly reference: ApiPostReferenceResponse | null;
};

export type AgentWebChannelPageWithMetadata = AgentWebChannelPage & {
    readonly metadata: AgentWebChannelPageMetadata;
};

export type AgentWebChannelPageMetadata = {
    readonly type: "Channel";
    readonly id: ChannelId;
    readonly isEndOfPosts: boolean;
    readonly posts: ReadonlyArray<{
        readonly id: PostId;
    }>;
};

export async function readAgentWebChannelPage(
    context: AgentWebContext,
    id: ChannelId,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebChannelPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebChannelPageMetadata}> {
    const afterCursor = parseAgentWebChannelPageSearchParams(searchParams);

    const posts: Array<
        Replace<AgentWebChannelPagePostBlock, {reference: ApiPostReferenceResponse}>
    > = [];
    const postCursors: Array<DateString> = [];

    const [channelDescriptionResult, initialPostsResult] = await runAllPromises([
        afterCursor === null
            ? context.api.get(context.span, "/channels/{id}", {
                  params: {path: {id}},
              })
            : null,
        context.api.get(context.span, "/channels/{id}/posts", {
            params: {
                path: {id},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: afterCursor ?? undefined,
                },
            },
        }),
    ]);

    const contextTime = new Date();
    const {channel} = initialPostsResult.data;
    let currentPostBatch = initialPostsResult.data.posts;
    let nextCursor = initialPostsResult.data.nextCursor;
    let lookaheadPost: ApiPostPreviewResponse | null = null;

    while (true) {
        const postBatch: ReadonlyArray<ApiPostPreviewResponse> =
            lookaheadPost !== null ? [lookaheadPost, ...currentPostBatch] : currentPostBatch;
        lookaheadPost = null;

        let includedPostBatch = postBatch;
        let pageNextCursor: string | null = nextCursor;

        if (nextCursor !== null && postBatch.length > agentWebChannelPageApiPostsBatchCount - 1) {
            includedPostBatch = postBatch.slice(0, -1);
            lookaheadPost = assertExists(postBatch[postBatch.length - 1]);
            pageNextCursor = getAgentWebChannelPageAfterSearchParam(
                assertExists(includedPostBatch[includedPostBatch.length - 1]).createdTime,
                lookaheadPost.createdTime,
            );
        }

        for (const post of includedPostBatch) {
            const createdTime = deserializeDateString(post.createdTime);
            const contextDate = toCalendarDate(fromDate(contextTime, post.createdTimeZone));
            const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                defaultLocale,
                post.createdTimeZone,
                contextDate,
                createdTime,
                {withLongMonth: true},
            );
            const formattedTimeZone = formatTimeZoneAbbreviation(post.createdTimeZone, contextTime);

            posts.push({
                type: "Post",
                author: intoApiAccountReference(post.author),
                timeAttribute: `${formattedTime} ${formattedTimeZone}`,
                contentSnippet: post.contentSnippet,
                reference: {
                    type: "Post",
                    id: post.id,
                    title: post.reference.title,
                },
            });
            postCursors.push(post.createdTime);
        }

        const pagePosts = posts.slice();

        const metadata: AgentWebChannelPageMetadata = {
            type: "Channel",
            id,
            isEndOfPosts: nextCursor === null,
            posts: pagePosts.map(post => ({
                id: post.reference.id,
                // NOCOMMIT: We should include `keys` from unzip in metadata so messages can quote
                // the post.
            })),
        };

        let page: AgentWebChannelPageWithMetadata;

        if (afterCursor === null) {
            page = {
                type: "Channel",
                subType: "Head",
                name: channel.name,
                description: assertExists(channelDescriptionResult).data.channel.description,
                pagination: pageNextCursor !== null ? {nextCursor: pageNextCursor} : null,
                posts: pagePosts,
                isEndOfPosts: nextCursor === null,
                metadata,
            };
        } else {
            page = {
                type: "Channel",
                subType: "Tail",
                name: channel.name,
                pagination: pageNextCursor !== null ? {nextCursor: pageNextCursor} : null,
                posts: pagePosts,
                isEndOfPosts: nextCursor === null,
                metadata,
            };
        }

        const response = await printPage(page);

        if (nextCursor !== null && response.length < limitLength) {
            const nextPostsResult = await context.api.get(context.span, "/channels/{id}/posts", {
                params: {
                    path: {id},
                    query: {
                        limit: agentWebChannelPageApiPostsBatchCount,
                        cursor: nextCursor,
                    },
                },
            });

            currentPostBatch = nextPostsResult.data.posts;
            nextCursor = nextPostsResult.data.nextCursor;
            continue;
        }

        if (response.length <= limitLength) {
            return {response, metadata: page.metadata};
        }

        const truncatedResult = await truncateAgentWebChannelPage(context.storage, id, {
            page,
            postCursors,
            limitLength,
            response,
        });

        if (truncatedResult === null) return {response, metadata: page.metadata};

        return {
            response: truncatedResult.response,
            metadata: truncatedResult.metadata,
        };
    }
}

function parseAgentWebChannelPageSearchParams(searchParams: URLSearchParams): DateString | null {
    const afterCursor = searchParams.get("after");

    for (const key of searchParams.keys()) {
        if (key !== "after") {
            throw new InvalidArgumentError("Unsupported channel page search param", {
                displayMessage: errorDisplayMessage`Expected only the \`?after\` URL search param for channel pages. Try again with \`?after\` or omit pagination search params.`,
            });
        }
    }

    if (afterCursor === null) return null;

    const fullAfterCursor = getAgentWebChannelPageFullAfterSearchParam(afterCursor);

    if (!isDateString(fullAfterCursor)) {
        throw new InvalidArgumentError("Expected `after` search param to be a cursor", {
            displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be an ISO 8601 cursor. Try again with a cursor from a channel page \u201cNext page »\u201d link or omit \`?after\`.`,
        });
    }

    return fullAfterCursor;
}

function getAgentWebChannelPageFullAfterSearchParam(afterCursor: string): string {
    const match = afterCursor.match(
        /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?)?(?:Z)?$/,
    );

    if (!match) return afterCursor;

    const [, date, hour, minute, second, millisecond] = match;

    if (hour === undefined || minute === undefined) return `${date}T23:59:59.999Z`;

    return `${date}T${hour}:${minute}:${second ?? "59"}.${millisecond ?? "999"}Z`;
}

function getAgentWebChannelPageAfterSearchParam(
    boundaryCursor: DateString,
    nextCursor: DateString,
): string {
    const match = boundaryCursor.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})(\.\d{3})Z$/);
    assert(match !== null);

    const [, date, time, seconds, milliseconds] = match;
    const candidates = [
        date!,
        `${date}T${time}`,
        `${date}T${time}${seconds}`,
        `${date}T${time}${seconds}${milliseconds}`,
    ];

    for (const candidate of candidates) {
        const fullCandidate = getAgentWebChannelPageFullAfterSearchParam(candidate);

        if (fullCandidate < nextCursor) {
            return candidate;
        }
    }

    return candidates[candidates.length - 1]!;
}

async function truncateAgentWebChannelPage(
    storage: AgentWebSessionStorage,
    id: ChannelId,
    {
        page,
        postCursors,
        limitLength,
        response,
    }: {
        page: AgentWebChannelPageWithMetadata;
        postCursors: ReadonlyArray<DateString>;
        limitLength: number;
        response: string;
    },
): Promise<{
    metadata: AgentWebChannelPageMetadata;
    response: string;
} | null> {
    if (page.posts.length <= 1) return null;
    assert(page.posts.length <= postCursors.length);

    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);
    let lastPostEndOffset: number | null = null;
    let truncatePostEndOffset: number | null = null;
    let truncatePostCount = 0;

    let truncateLength = limitLengthDifference;

    let channelPathname: string | null = null;

    // Edge case: if we need to add a pagination link then expect more to be truncated
    // so we can add the pagination link while still fitting into `limitLength`.
    if (!page.pagination) {
        channelPathname = await createAgentWebPageStoredLinkPathname(storage, {
            type: "Channel",
            id,
            title: page.name,
        });

        truncateLength +=
            // We need double newlines when adding after a heading and a single space when
            // adding into a paragraph. Given double newlines is the longer of the two use that
            // in our character count.
            "\n\n[".length +
            agentWebChannelPageNextPageLinkText.length +
            "](".length +
            channelPathname.length +
            "?after=".length +
            "0000-00-00T00:00:00.000".length +
            ")".length;
    }

    const traverse = (node: Parent): boolean => {
        for (const childNode of reverseIterable(node.children)) {
            if (
                childNode.type === "html" &&
                hasHtmlCloseTag(childNode.value, tagName => tagName === "post")
            ) {
                const endOffset = assertExists(childNode.position?.end.offset);

                lastPostEndOffset ??= endOffset;
                truncatePostEndOffset = endOffset;
                truncatePostCount++;

                if (lastPostEndOffset - truncatePostEndOffset >= truncateLength) {
                    return true;
                }
            }

            if ("children" in childNode) {
                if (traverse(childNode)) {
                    return true;
                }
            }
        }

        return false;
    };

    traverse(responseTree);

    // We don't truncate the last post traverse sees.
    truncatePostCount--;

    // There are no posts in this page so we don't truncate.
    if (truncatePostEndOffset === null) return null;

    // Always set when `truncatePostEndOffset` is set.
    assert(lastPostEndOffset !== null);

    // No truncation occurred!
    if (truncatePostEndOffset === lastPostEndOffset) {
        return null;
    }

    const truncatedPosts = page.posts.slice(0, page.posts.length - truncatePostCount);

    // There should always be at least one post left after we truncate.
    assert(truncatedPosts.length > 0);

    const afterSearchParam = getAgentWebChannelPageAfterSearchParam(
        postCursors[truncatedPosts.length - 1]!,
        postCursors[truncatedPosts.length]!,
    );

    // We're intentionally dropping everything after `truncatePostEndOffset`. Which
    // will include the `isEndOfPosts` paragraph. If we're truncating then we're
    // implicitly not at the end of posts anymore.
    let truncatedResponse = response.slice(0, truncatePostEndOffset);

    // Update the "Next page" link to reflect the new last post cursor after
    // truncation.
    //
    // If there is no "Next page" link and truncation occurred then we need to add a
    // "Next page" link.
    if (page.pagination) {
        let paginationLink: Link | null = null;

        const traversePaginationLink = (node: Parent): void => {
            for (const childNode of node.children) {
                if (
                    childNode.type === "link" &&
                    printMarkdownPhrasingContentText(childNode.children) ===
                        agentWebChannelPageNextPageLinkText
                ) {
                    paginationLink = childNode;
                    return;
                }

                if ("children" in childNode) {
                    traversePaginationLink(childNode);
                    if (paginationLink !== null) return;
                }
            }
        };

        traversePaginationLink(responseTree);

        // TypeScript is dumb and doesn't realize `traversePaginationLink()` may assign
        // `paginationLink` synchronously.
        paginationLink = paginationLink as any;

        assert(paginationLink !== null);

        const linkStartOffset = assertExists(paginationLink.position?.start.offset);
        const linkEndOffset = assertExists(paginationLink.position?.end.offset);

        assert(linkEndOffset <= truncatedResponse.length);

        truncatedResponse =
            truncatedResponse.slice(0, linkStartOffset) +
            response
                .slice(linkStartOffset, linkEndOffset)
                .replace(/\?after=[^)]+/, `?after=${afterSearchParam}`) +
            truncatedResponse.slice(linkEndOffset);
    } else {
        assert(channelPathname !== null);

        const linkMarkdown = `[${agentWebChannelPageNextPageLinkText}](${channelPathname}?after=${afterSearchParam})`;

        switch (page.subType) {
            case "Head": {
                const divider = responseTree.children.find(
                    childNode => childNode.type === "thematicBreak",
                );
                assert(divider !== undefined);

                const insertionOffset = assertExists(divider.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, insertionOffset) +
                    "\n\n" +
                    linkMarkdown +
                    truncatedResponse.slice(insertionOffset);
                break;
            }
            case "Tail": {
                const preamble = responseTree.children[0];
                assert(preamble?.type === "paragraph");

                const insertionOffset = assertExists(preamble.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, insertionOffset) +
                    " " +
                    linkMarkdown +
                    truncatedResponse.slice(insertionOffset);
                break;
            }
        }
    }

    return {
        metadata: {
            ...page.metadata,
            isEndOfPosts: false,
            posts: page.metadata.posts.slice(0, truncatedPosts.length),
        },
        response: truncatedResponse,
    };
}

export async function createAgentWebChannelPage(
    context: AgentWebContext,
    newPage: AgentWebChannelPage,
): Promise<{
    pageMetadata: AgentWebChannelPageMetadata;
    pageLink: Extract<AgentWebPageStoredLink, {type: "Channel"}>;
}> {
    if (newPage.subType !== "Head") {
        throw new InvalidArgumentError("Can only create channel head pages", {
            displayMessage: errorDisplayMessage`Channel markdown must start with a channel title (e.g. \`# General\`) when creating a channel. Try again with a channel title.`,
        });
    }

    if (newPage.pagination !== null) {
        throw new InvalidArgumentError("Can\u2019t create channel with pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t include a \u201C${agentWebChannelPageNextPageLinkText}\u201D link when creating a channel. Try again without a \u201C${agentWebChannelPageNextPageLinkText}\u201D link.`,
        });
    }

    if (newPage.posts.length > 0) {
        throw new InvalidArgumentError("Can\u2019t create posts while creating channel", {
            displayMessage: errorDisplayMessage`You can\u2019t create \`<post>\`s while creating a channel. Try creating the channel again without posts and then call the \`create\` tool with \`type\` of \`post\` for each post you want to create.`,
        });
    }

    // NOCOMMIT: Test parsing a page with regular `---` divider in description

    // TODO(#agents-web): Implement channel create endpoint. When we add the ability to
    // create make sure to also test that you can update the channel name +
    // description. Maybe even that you can add a divider with the `<hr />` syntax (and
    // any end dividers are ignored).
    throw new UnimplementedError("Channel create API endpoint hasn\u2019t been implemented yet");
}

export async function updateAgentWebChannelPage(
    context: AgentWebContextWithoutStorage,
    oldPageMetadata: AgentWebChannelPageMetadata,
    oldPage: AgentWebChannelPage,
    newPage: AgentWebChannelPage,
): Promise<AgentWebChannelPageMetadata> {
    switch (oldPage.subType) {
        case "Head": {
            if (newPage.subType !== "Head") {
                throw new InvalidArgumentError("Can\u2019t update channel preamble", {
                    displayMessage: errorDisplayMessage`You can only update the channel name and description. Try again with a channel name as a markdown h1 (e.g. \`# My Channel\`) on line 1 of the channel markdown.`,
                });
            }
            break;
        }
        case "Tail": {
            if (newPage.subType !== "Tail" || oldPage.name !== newPage.name) {
                throw new InvalidArgumentError("Can\u2019t update channel preamble", {
                    displayMessage: errorDisplayMessage`You can only update the channel name on the first page of the channel. You must leave the \`Posts in My Channel.\` line at the start of the channel markdown in place. Try calling the \`read\` tool to navigate to the first page in the channel and you can call the \`update\` tool on that page to update the channel name.`,
                });
            }
            break;
        }
        default:
            throw exhaustive(oldPage);
    }

    if (
        !isDeepEqual(
            oldPage.pagination ? {nextCursor: oldPage.pagination.nextCursor} : null,
            newPage.pagination ? {nextCursor: newPage.pagination.nextCursor} : null,
        )
    ) {
        throw new InvalidArgumentError("Can\u2019t update channel pagination", {
            displayMessage: errorDisplayMessage`You can only update the channel name and description on a channel page. You can\u2019t update the next page link in channel markdown. Try again with a more specific update that only changes the channel name or description.`,
        });
    }

    if (oldPage.posts.length < newPage.posts.length) {
        throw new InvalidArgumentError("Can\u2019t add posts to channel page", {
            displayMessage: errorDisplayMessage`You can\u2019t add \`<post>\`s with the \`update\` tool on a channel page. Call the \`create\` tool with \`type\` of \`post\` with each post you want to create.`,
        });
    }

    if (oldPage.posts.length > newPage.posts.length) {
        throw new InvalidArgumentError("Can\u2019t remove posts from channel page", {
            displayMessage: errorDisplayMessage`You can only update the channel name and description on a channel page. You can\u2019t remove \`<post>\`s. Try again with a more specific update that only changes the channel name or description.`,
        });
    }

    for (let index = 0; index < oldPage.posts.length; index++) {
        const oldPost = oldPage.posts[index]!;
        const newPost = newPage.posts[index]!;

        const oldPostMetadata = {
            author: oldPost.author ? {id: oldPost.author.id} : null,
            timeAttribute: oldPost.timeAttribute,
            reference: oldPost.reference ? {id: oldPost.reference.id} : null,
        };
        const newPostMetadata = {
            author: newPost.author ? {id: newPost.author.id} : null,
            timeAttribute: newPost.timeAttribute,
            reference: newPost.reference ? {id: newPost.reference.id} : null,
        };

        if (!isDeepEqual(oldPostMetadata, newPostMetadata)) {
            throw new InvalidArgumentError("Can\u2019t update message created by someone else", {
                displayMessage: errorDisplayMessage`You can only update the channel name and description on a channel page. Any metadata on \`<post>\`s (the \`from\`/\`time\` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.`,
            });
        }

        if (
            !isDeepEqual(
                normalizeApiContent(oldPost.contentSnippet),
                normalizeApiContent(newPost.contentSnippet),
            )
        ) {
            throw new InvalidArgumentError("Can\u2019t update channel post content snippet", {
                displayMessage: errorDisplayMessage`You can only update the channel name and description on a channel page. You can\u2019t change a \`<post>\`\u2019s content. To update a post, call the \`read\` tool with the post\u2019s \u201CSee more\u201D link and then call the \`update\` tool on the post page.`,
            });
        }
    }

    // The end of posts marker is optional for a page that's actually at the end of
    // posts (according to metadata). However, for a page that's not at the end of
    // posts you can't add the end of posts marker!
    if (!oldPageMetadata.isEndOfPosts && newPage.isEndOfPosts) {
        throw new InvalidArgumentError("Can\u2019t change whether this page is the end of posts", {
            displayMessage: errorDisplayMessage`Can\u2019t add the \u201cEnd of posts\u201d marker in an update. Only a \`read\` tool call can tell you whether you\u2019ve seen all of a channel\u2019s posts. Try again without adding the \u201cEnd of posts\u201d marker.`,
        });
    }

    if (oldPage.subType === "Head") {
        assert(newPage.subType === "Head");

        if (oldPage.name !== newPage.name) {
            // TODO(#agents-web): Implement channel rename endpoint.
            throw new UnimplementedError(
                "Channel rename API endpoint hasn\u2019t been implemented yet",
            );
        }

        if (
            !isDeepEqual(
                normalizeApiContent(oldPage.description),
                normalizeApiContent(newPage.description),
            )
        ) {
            // TODO(#agents-web): Implement channel description update endpoint.
            throw new UnimplementedError(
                "Channel description update API endpoint hasn\u2019t been implemented yet",
            );
        }
    }

    return oldPageMetadata;
}

export function normalizeAgentWebChannelPage<Page extends AgentWebChannelPage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            if (page.subType === "Head") {
                if (page.description.elements.length === 0) {
                    page.description.elements.push({type: "Paragraph", elements: []});
                } else {
                    normalizer.normalize(page.description);
                }
            }

            for (const post of page.posts) {
                if (post.author) normalizer.normalizeReference(post.author);
                normalizer.normalize(post.contentSnippet);
                if (post.reference) normalizer.normalizeReference(post.reference);
            }
        });
    });
}

export async function printAgentWebChannelPage(
    storage: AgentWebSessionStorage,
    id: ChannelId,
    page: AgentWebChannelPage,
): Promise<Root> {
    const children: Array<RootContent> = [];

    switch (page.subType) {
        case "Head": {
            children.push({
                type: "heading",
                depth: 1,
                children: [{type: "text", value: page.name}],
            });

            const isEmptyDescription =
                page.description.elements.length === 0 ||
                (page.description.elements.length === 1 &&
                    page.description.elements[0]!.type === "Paragraph" &&
                    page.description.elements[0].elements.length === 0);

            if (!isEmptyDescription) {
                const descriptionTree = await printApiContentToAgentWebMarkdownTree(
                    storage,
                    page.description,
                );

                // We are going to use a thematic break (`---`) to separate our channel description
                // from the channel posts. So we can't include thematic breaks in the description
                // markdown or else they'll mess up parsing. To solve this we convert thematic
                // breaks to the equivalent HTML `<hr />`.
                replaceThematicBreaksWithHtml(descriptionTree);

                for (const childNode of descriptionTree.children) children.push(childNode);
            }

            children.push({type: "thematicBreak"});

            if (page.pagination) {
                children.push(
                    await printAgentWebChannelHeadPagePaginationParagraph(
                        storage,
                        id,
                        page,
                        page.pagination,
                    ),
                );
            }
            break;
        }
        case "Tail": {
            children.push(await printAgentWebChannelTailPagePreamble(storage, id, page));
            break;
        }
    }

    for (const post of page.posts) {
        for (const childNode of await printAgentWebChannelPagePostBlock(storage, post)) {
            children.push(childNode);
        }
    }

    if (page.isEndOfPosts) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: "End of posts."}],
        });
    }

    return {type: "root", children};
}

function replaceThematicBreaksWithHtml(root: Root): void {
    const traverse = (node: Parent): void => {
        for (let index = 0; index < node.children.length; index++) {
            const child = node.children[index]!;

            if (child.type === "thematicBreak") {
                node.children[index] = {type: "html", value: "<hr />"} as RootContent;
                continue;
            }

            if ("children" in child) {
                traverse(child);
            }
        }
    };

    traverse(root);
}

async function printAgentWebChannelHeadPagePaginationParagraph(
    storage: AgentWebSessionStorage,
    id: ChannelId,
    page: AgentWebChannelPage,
    pagination: AgentWebChannelPagePagination,
): Promise<RootContent> {
    const pathname = await createAgentWebPageStoredLinkPathname(storage, {
        type: "Channel",
        id,
        title: page.name,
    });

    return {
        type: "paragraph",
        children: [
            {
                type: "link",
                url: `${pathname}?after=${pagination.nextCursor}`,
                children: [{type: "text", value: agentWebChannelPageNextPageLinkText}],
            },
        ],
    };
}

async function printAgentWebChannelTailPagePreamble(
    storage: AgentWebSessionStorage,
    id: ChannelId,
    page: Extract<AgentWebChannelPage, {subType: "Tail"}>,
): Promise<RootContent> {
    const children: Array<PhrasingContent> = [{type: "text", value: `Posts in ${page.name}.`}];

    if (page.pagination) {
        const pathname = await createAgentWebPageStoredLinkPathname(storage, {
            type: "Channel",
            id,
            title: page.name,
        });

        children.push(
            {type: "text", value: " "},
            {
                type: "link",
                url: `${pathname}?after=${page.pagination.nextCursor}`,
                children: [{type: "text", value: agentWebChannelPageNextPageLinkText}],
            },
        );
    }

    return {type: "paragraph", children};
}

async function printAgentWebChannelPagePostBlock(
    storage: AgentWebSessionStorage,
    post: AgentWebChannelPagePostBlock,
): Promise<Array<RootContent>> {
    const [authorPathname, postPathname, contentSnippetTree] = await runAllPromises([
        post.author ? createAgentWebPageStoredLinkPathname(storage, post.author) : null,
        post.reference ? createAgentWebPageStoredLinkPathname(storage, post.reference) : null,
        printApiContentToAgentWebMarkdownTree(storage, post.contentSnippet),
    ]);

    const traverse = (node: Parent): void => {
        for (let index = 0; index < node.children.length; index++) {
            const child = node.children[index]!;

            // If someone has crafted a agent web link (URL starts with "/") labeled as "See
            // more »" then that may confuse the parser so drop the "»". Agent web links from
            // content are mentions and the title doesn't matter for parsing.
            if (
                child.type === "link" &&
                child.url.startsWith("/") &&
                printMarkdownPhrasingContentText(child.children) === "See more »"
            ) {
                child.children = [{type: "text", value: "See more"}];
                continue;
            }

            if ("children" in child) {
                traverse(child);
            }
        }
    };

    traverse(contentSnippetTree);

    let openTag = "<post";

    if (post.author !== null) {
        const authorLink: Link = {
            type: "link",
            url: assertExists(authorPathname),
            children: [{type: "text", value: post.author.shortName}],
        };

        openTag += ` from="${escapeHtml(printMarkdownTree(authorLink).trim())}"`;
    }

    if (post.timeAttribute !== null) {
        openTag += ` time="${escapeHtml(post.timeAttribute)}"`;
    }

    openTag += ">";

    const children: Array<RootContent> = [{type: "html", value: openTag}];

    for (const child of contentSnippetTree.children) {
        children.push(child);
    }

    if (post.reference !== null) {
        children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: assertExists(postPathname),
                    children: [{type: "text", value: "See more »"}],
                },
            ],
        });
    }

    children.push({type: "html", value: "</post>"});

    return children;
}

export async function parseAgentWebChannelPage(
    storage: AgentWebSessionStorage,
    id: ChannelId | null,
    root: Root,
): Promise<AgentWebChannelPage> {
    const firstChild = root.children[0];

    if (firstChild?.type === "heading" && firstChild.depth === 1) {
        return await parseAgentWebChannelHeadPage(storage, root);
    }

    return await parseAgentWebChannelTailPage(storage, root);
}

async function parseAgentWebChannelHeadPage(
    storage: AgentWebSessionStorage,
    root: Root,
): Promise<AgentWebChannelPage> {
    const heading = root.children[0]!;
    assert(heading.type === "heading" && heading.depth === 1);

    const name = printMarkdownPhrasingContentText(heading.children);
    const dividerIndex = root.children.findIndex(
        (child, index) => index > 0 && child.type === "thematicBreak",
    );

    const descriptionChildren =
        dividerIndex === -1 ? root.children.slice(1) : root.children.slice(1, dividerIndex);

    if (
        dividerIndex === -1 &&
        descriptionChildren.some(isAgentWebChannelPagePostSectionStartNode)
    ) {
        throw new InvalidArgumentError("Missing channel posts divider", {
            displayMessage: errorDisplayMessage`Channel posts must be separated from the channel description with a divider (e.g. \`---\`). Try again but add a divider before the posts section.`,
        });
    }

    if (dividerIndex === -1) {
        const description = await parseApiContentFromAgentWebMarkdownTree(storage, {
            type: "root",
            children: descriptionChildren,
        });

        return {
            type: "Channel",
            subType: "Head",
            name,
            description:
                description.elements.length === 0
                    ? {elements: [{type: "Paragraph", elements: []}]}
                    : description,
            pagination: null,
            posts: [],
            isEndOfPosts: false,
        };
    }

    const [description, {pagination, posts, isEndOfPosts}] = await runAllPromises([
        parseApiContentFromAgentWebMarkdownTree(storage, {
            type: "root",
            children: descriptionChildren,
        }),
        parseAgentWebChannelPagePostSection(storage, {
            section: {type: "root", children: root.children.slice(dividerIndex + 1)},
            withLeadingPagination: true,
        }),
    ]);

    return {
        type: "Channel",
        subType: "Head",
        name,
        description:
            description.elements.length === 0
                ? {elements: [{type: "Paragraph", elements: []}]}
                : description,
        pagination,
        posts,
        isEndOfPosts,
    };
}

async function parseAgentWebChannelTailPage(
    storage: AgentWebSessionStorage,
    root: Root,
): Promise<AgentWebChannelPage> {
    const firstChild = root.children[0];

    if (firstChild?.type !== "paragraph") {
        throw new InvalidArgumentError("Invalid channel posts preamble", {
            displayMessage: errorDisplayMessage`Channel posts markdown must start with the channel name in a heading (e.g. \`# General\`) or \u201CPosts in General\u201D. Try again with a proper start to channel markdown on line 1.`,
        });
    }

    const [{name, pagination}, postSection] = await runAllPromises([
        parseAgentWebChannelTailPreamble(storage, firstChild),
        parseAgentWebChannelPagePostSection(storage, {
            section: {type: "root", children: root.children.slice(1)},
            withLeadingPagination: false,
        }),
    ]);

    return {
        type: "Channel",
        subType: "Tail",
        name,
        pagination: pagination ?? postSection.pagination,
        posts: postSection.posts,
        isEndOfPosts: postSection.isEndOfPosts,
    };
}

async function parseAgentWebChannelTailPreamble(
    storage: AgentWebSessionStorage,
    paragraph: Extract<RootContent, {type: "paragraph"}>,
): Promise<{
    name: string;
    pagination: AgentWebChannelPagePagination | null;
}> {
    let children = paragraph.children;
    let pagination: AgentWebChannelPagePagination | null = null;

    const lastChild = children[children.length - 1];
    if (
        lastChild?.type === "link" &&
        printMarkdownPhrasingContentText(lastChild.children) === agentWebChannelPageNextPageLinkText
    ) {
        pagination = await parseAgentWebChannelPagePaginationLink(storage, lastChild);
        children = children.slice(0, -1);

        const lastText = children[children.length - 1];
        if (lastText?.type === "text" && lastText.value.endsWith(" ")) {
            children = [
                ...children.slice(0, -1),
                {...lastText, value: lastText.value.slice(0, -1)},
            ];
        }
    }

    const text = printMarkdownPhrasingContentText(children);
    const match = text.match(/^Posts in (.*?)(?:\.)?$/);

    if (!match) {
        throw new InvalidArgumentError("Invalid channel posts preamble", {
            displayMessage: errorDisplayMessage`Channel posts markdown must start with \u201CPosts in My Channel\u201D (where \u201CMy Channel\u201D is the actual name of the channel) when reading an earlier channel posts page. Try again with a proper channel posts preamble on line 1.`,
        });
    }

    return {name: match[1]!, pagination};
}

async function parseAgentWebChannelPagePostSection(
    storage: AgentWebSessionStorage,
    {
        section,
        withLeadingPagination,
    }: {
        section: Root;
        withLeadingPagination: boolean;
    },
): Promise<{
    pagination: AgentWebChannelPagePagination | null;
    posts: ReadonlyArray<AgentWebChannelPagePostBlock>;
    isEndOfPosts: boolean;
}> {
    let children = section.children;
    let pagination: AgentWebChannelPagePagination | null = null;

    if (withLeadingPagination && children[0]?.type === "paragraph") {
        pagination = await parseAgentWebChannelPagePaginationParagraphIfPossible(
            storage,
            children[0],
        );

        if (pagination) children = children.slice(1);
    }

    const postPromises: Array<Promise<AgentWebChannelPagePostBlock>> = [];
    let isEndOfPosts = false;

    for (let index = 0; index < children.length; index++) {
        const child = children[index]!;

        if (isAgentWebChannelPageEndOfPostsParagraph(child)) {
            isEndOfPosts = true;

            if (index !== children.length - 1) {
                throw new InvalidArgumentError("Content after end of channel posts", {
                    displayMessage: errorDisplayMessage`Nothing may appear after \u201CEnd of posts\u201D in channel markdown. Try again after removing the extra content after \u201CEnd of posts\u201D on line ${children[index + 1]!.position?.start.line ?? "unknown"}.`,
                });
            }
            break;
        }

        if (child.type !== "html" || !hasHtmlOpenTag(child.value, tagName => tagName === "post")) {
            throw new InvalidArgumentError("Expected channel post block", {
                displayMessage: errorDisplayMessage`Expected \`<post>\` blocks in the channel posts section after the divider (\`---\`). Try again with valid channel posts markdown on line ${child.position?.start.line ?? "unknown"} (or if you want to add a divider to your channel description you can do so with the HTML divider syntax \`<hr />\`).`,
            });
        }

        const postChildren: Array<RootContent> = [];
        const openTag = child.value;
        const openTagPosition = child.position;
        let didFindCloseTag = false;

        for (index++; index < children.length; index++) {
            const postChild = children[index]!;

            if (
                postChild.type === "html" &&
                hasHtmlCloseTag(postChild.value, tagName => tagName === "post")
            ) {
                didFindCloseTag = true;
                break;
            }

            postChildren.push(postChild);
        }

        if (!didFindCloseTag) {
            throw new InvalidArgumentError("Unclosed channel post block", {
                displayMessage: errorDisplayMessage`\`<post>\` on line ${openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a \`</post>\` closing tag and try again.`,
            });
        }

        postPromises.push(
            parseAgentWebChannelPagePostBlock(storage, {
                root: {type: "root", children: postChildren},
                openTag,
                openTagPosition,
            }),
        );
    }

    return {
        pagination,
        posts: await runAllPromises(postPromises),
        isEndOfPosts,
    };
}

async function parseAgentWebChannelPagePaginationParagraphIfPossible(
    storage: AgentWebSessionStorage,
    paragraph: Extract<RootContent, {type: "paragraph"}>,
): Promise<AgentWebChannelPagePagination | null> {
    if (paragraph.children.length !== 1) return null;

    const child = paragraph.children[0]!;
    if (
        child.type !== "link" ||
        printMarkdownPhrasingContentText(child.children) !== agentWebChannelPageNextPageLinkText
    ) {
        return null;
    }

    return await parseAgentWebChannelPagePaginationLink(storage, child);
}

async function parseAgentWebChannelPagePaginationLink(
    storage: AgentWebSessionStorage,
    link: Link,
): Promise<AgentWebChannelPagePagination> {
    const {pathname, searchParams} = normalizeAgentWebPath(link.url);
    const afterCursor = searchParams.get("after");

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, pathname);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Channel" || afterCursor === null) {
        throw new InvalidArgumentError("Invalid channel page pagination link", {
            displayMessage: errorDisplayMessage`Expected \u201cNext page »\u201d to link to a channel page with an \`?after\` cursor. Try again with a valid channel pagination link.`,
        });
    }

    return {nextCursor: afterCursor};
}

function isAgentWebChannelPageEndOfPostsParagraph(node: RootContent): boolean {
    return (
        node.type === "paragraph" &&
        /^End of posts\.?$/.test(printMarkdownPhrasingContentText(node.children))
    );
}

function isAgentWebChannelPagePostSectionStartNode(node: RootContent): boolean {
    if (isAgentWebChannelPageEndOfPostsParagraph(node)) return true;

    if (node.type === "html" && hasHtmlOpenTag(node.value, tagName => tagName === "post")) {
        return true;
    }

    return (
        node.type === "paragraph" &&
        node.children.length === 1 &&
        node.children[0]?.type === "link" &&
        printMarkdownPhrasingContentText(node.children[0].children) ===
            agentWebChannelPageNextPageLinkText
    );
}

async function parseAgentWebChannelPagePostBlock(
    storage: AgentWebSessionStorage,
    {
        root,
        openTag,
        openTagPosition,
    }: {
        root: Root;
        openTag: string;
        openTagPosition: Html["position"];
    },
): Promise<AgentWebChannelPagePostBlock> {
    const {fromAttribute, timeAttribute} = parseAgentWebChannelPagePostOpenTag(openTag);
    const author =
        fromAttribute === null
            ? null
            : await parseAgentWebChannelPageAccountLink(storage, openTagPosition, fromAttribute);

    const seeMore = root.children[root.children.length - 1];
    const seeMoreLink =
        seeMore?.type === "paragraph" &&
        seeMore.children.length === 1 &&
        seeMore.children[0]?.type === "link" &&
        seeMore.children[0].url.startsWith("/") &&
        printMarkdownPhrasingContentText(seeMore.children[0].children) === "See more »"
            ? seeMore.children[0]
            : null;

    let contentSnippet: ApiContentResponseWithoutKeys;
    let reference: ApiPostReferenceResponse | null = null;

    if (seeMoreLink === null) {
        contentSnippet = await parseApiContentFromAgentWebMarkdownTree(storage, root);
    } else {
        const [pageLinkResult, parsedContentSnippet] = await runAllPromises([
            routeAgentWebPageLinkPathname(storage, seeMoreLink.url),
            parseApiContentFromAgentWebMarkdownTree(storage, {
                type: "root",
                children: root.children.slice(0, -1),
            }),
        ]);

        contentSnippet = parsedContentSnippet;

        if (!pageLinkResult || pageLinkResult.pageLink.type !== "Post") {
            throw new InvalidArgumentError("Invalid channel post link", {
                displayMessage: errorDisplayMessage`Expected \`See more »\` to link to a post. Try again with a valid post link at the end of the \`<post>\` on line ${openTagPosition?.start.line ?? "unknown"}.`,
            });
        }

        reference = pageLinkResult.pageLink;
    }

    return {
        type: "Post",
        author,
        timeAttribute,
        contentSnippet,
        reference,
    };
}

function parseAgentWebChannelPagePostOpenTag(openTag: string): {
    fromAttribute: string | null;
    timeAttribute: string | null;
} {
    let hasPostOpenTag = false;
    let hasEndedPostOpenTag = false;
    let startedAttribute: "from" | "time" | null = null;
    let fromAttribute: string | null = null;
    let timeAttribute: string | null = null;

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
                } else if (attributeName === "time") {
                    startedAttribute = "time";
                    timeAttribute = "";
                }
            },
            onattribdata: (start, end) => {
                const attributeData = openTag.slice(start, end);

                switch (startedAttribute) {
                    case "from":
                        fromAttribute += attributeData;
                        break;
                    case "time":
                        timeAttribute += attributeData;
                        break;
                }
            },
            onattribentity: codepoint => {
                const attributeData = String.fromCodePoint(codepoint);

                switch (startedAttribute) {
                    case "from":
                        fromAttribute += attributeData;
                        break;
                    case "time":
                        timeAttribute += attributeData;
                        break;
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

    return {fromAttribute, timeAttribute};
}

async function parseAgentWebChannelPageAccountLink(
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
