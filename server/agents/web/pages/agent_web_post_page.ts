import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, Link, Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPageTimeBlock,
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
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {unzipKeysFromApiContentResponse} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountReferenceResponse,
    ApiChannelReferenceResponse,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {mapMaybePromise} from "~/shared/helpers/async/map_maybe_promise.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {mapMaybeThunk} from "~/shared/helpers/control/map_maybe_thunk.js";
import {memoMaybeThunk} from "~/shared/helpers/control/memo_maybe_thunk.js";
import {unwrapMaybeThunk} from "~/shared/helpers/control/unwrap_maybe_thunk.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type AgentWebPostPage = {
    readonly type: "Post";
    readonly pagination: AgentWebMessagingPagePagination<AgentWebPostPageCustomBlock> | null;
    readonly isEndOfMessages: boolean;
} & (
    | {
          readonly subType: "Head";
          readonly preamble: AgentWebPostPageHeadPagePreamble;
          readonly blocks: AgentWebPostHeadPageBlocks;
      }
    | {
          readonly subType: "Tail";
          readonly preamble: AgentWebPostPageTailPagePreamble;
          readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock<never>>;
      }
);

export type AgentWebPostHeadPageBlocks =
    | readonly [AgentWebPostPageCustomBlock, ...ReadonlyArray<AgentWebMessagingPageBlock<never>>]
    | readonly [
          AgentWebMessagingPageTimeBlock,
          AgentWebPostPageCustomBlock,
          ...ReadonlyArray<AgentWebMessagingPageBlock<never>>,
      ];

export type AgentWebPostPageBase = AgentWebMessagingPage<
    AgentWebPostPagePreambleBase,
    AgentWebPostPageCustomBlock
> & {
    readonly type: "Post";
    readonly subType: "Head" | "Tail";
};

export type AgentWebPostPagePreambleBase =
    | AgentWebPostPageHeadPagePreamble
    | AgentWebPostPageTailPagePreamble;

assertAssignableTypes<AgentWebPostPage, AgentWebPostPageBase>();

export type AgentWebPostPageHeadPagePreamble = {
    readonly type: "Head";
    readonly channel: ApiChannelReferenceResponse | null;
};

export type AgentWebPostPageTailPagePreamble = {
    readonly type: "Tail";
    readonly post: ApiPostReferenceResponse;
};

export type AgentWebPostPageCustomBlock = {
    readonly type: "Custom";
    readonly tagName: "post";
    readonly author: ApiAccountReferenceResponse | null;
    readonly timeAttribute: null;
    readonly timeZoneAttribute: string | null;
    readonly content: ApiContentResponseWithoutKeys;
};

export type AgentWebPostPageWithMetadata =
    | (Extract<AgentWebPostPage, {subType: "Head"}> & {
          readonly metadata: Extract<AgentWebPostPageMetadata, {isStartOfMessages: true}>;
      })
    | (Extract<AgentWebPostPage, {subType: "Tail"}> & {
          readonly metadata: Extract<AgentWebPostPageMetadata, {isStartOfMessages: false}>;
      });

export type AgentWebPostPageMetadata = Omit<AgentWebMessagingPageMetadata, "isStartOfMessages"> & {
    readonly type: "Post";
    readonly id: PostId;
} & (
        | {
              readonly isStartOfMessages: true;
              readonly postKeys: ReadonlyArray<ApiContentKey> | null;
          }
        | {
              readonly isStartOfMessages: false;
          }
    );

function buildAgentWebPostPage(
    page: AgentWebMessagingPage<AgentWebPostPagePreambleBase, AgentWebPostPageCustomBlock>,
): AgentWebPostPage {
    switch (page.preamble.type) {
        case "Head": {
            assert(
                // Custom block can be the first block and no other.
                (page.blocks[0]?.type === "Custom" &&
                    page.blocks.slice(1).every(block => block.type !== "Custom")) ||
                    // Custom block can be the second block after `<time>` and no other.
                    (page.blocks[0]?.type === "Time" &&
                        page.blocks[1]?.type === "Custom" &&
                        page.blocks.slice(2).every(block => block.type !== "Custom")),
            );

            return {
                ...page,
                type: "Post",
                subType: "Head",
                preamble: page.preamble,
                isEndOfMessages:
                    // Don't include the "End of comments." marker if we only have a `<post>` and no
                    // `<comment>`s. Since the "End of comments." marker is optional. "End of
                    // comments." will still be reflected in the metadata so an agent will still be
                    // able to create comments.
                    //
                    // We do this to return nicer markdown to the agent. If we had a post and then "End
                    // of comments." it's a little strange since there's no other reference to
                    // comments.
                    (page.blocks[0].type === "Custom" && page.blocks.length === 1) ||
                    (page.blocks[1]?.type === "Custom" && page.blocks.length === 2)
                        ? false
                        : page.isEndOfMessages,
                blocks: page.blocks as AgentWebPostHeadPageBlocks,
            };
        }
        case "Tail": {
            assert(page.blocks.every(block => block.type !== "Custom"));

            return {
                ...page,
                type: "Post",
                subType: "Tail",
                preamble: page.preamble,
                blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
            };
        }
        default:
            throw exhaustive(page.preamble);
    }
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
        printPage: (page: AgentWebPostPage) => Promise<string>;
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
        pageLink: ApiPostReferenceResponse;
        preamble: AgentWebPostPagePreambleBase;
        startCustomBlock: {
            time: Date;
            block: AgentWebPostPageCustomBlock;
        } | null;
    };

    let hasLoadedStartCustomBlock = false;

    const roomMetadataWithStartCustomBlock = new Lazy<
        Promise<RoomMetadata & {keys: ReadonlyArray<ApiContentKey> | null}>
    >(async () => {
        // If `excludesPost` is set then never return a post start block.
        if (excludesPost) return await roomMetadataWithoutStartCustomBlock.get();

        hasLoadedStartCustomBlock = true;

        const {
            data: {post},
        } = await context.api.get(context.span, "/posts/{id}", {params: {path: {id}}});

        const postCreatedTime = deserializeDateString(post.createdTime);

        const {content, keys} = unzipKeysFromApiContentResponse(post.content);

        return {
            pageLink: {
                type: "Post",
                id,
                title: post.reference.title,
            },
            preamble: {
                type: "Head",
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
                    content,
                },
            },
            keys,
        };
    });

    const roomMetadataWithoutStartCustomBlock = new Lazy<Promise<RoomMetadata & {keys: null}>>(
        async () => {
            const {
                data: {reference: postReference},
            } = await context.api.get(context.span, "/posts/{id}-reference", {
                params: {path: {id}},
            });

            return {
                pageLink: postReference,
                preamble: {
                    type: "Tail",
                    post: postReference,
                },
                startCustomBlock: null,
                keys: null,
            };
        },
    );

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

            [, {response, metadata}] = await runAllPromises([
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
                    printPage: page => printPage(buildAgentWebPostPage(page)),
                }),
            ]);
            break;
        }
        case "Around": {
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

            [, {response, metadata}] = await runAllPromises([
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
                    printPage: page => printPage(buildAgentWebPostPage(page)),
                }),
            ]);
            break;
        }
        default:
            throw exhaustive(parsedSearchParams);
    }

    const hasPostOpenTag = /^.*\n+(?:.*\n+)?<post(?: |>)/.test(response);

    // Kinda hacky but truncate is implemented via string manipulation. So if we see a
    // response that thought it was a head page but the `<post>` was truncated then
    // switch the preamble to a tail page preamble.
    //
    // NOCOMMIT: Under what conditions might this trigger a `scroll` should we decrease
    // the limit length difference or something like that?
    if (!hasPostOpenTag && response.startsWith("Post in ")) {
        const match = assertExists(response.match(/^.*\)\. ([^.]+)\n/));

        const roomMetadata = await roomMetadataPromise;

        const roomPageLinkPathname = await createAgentWebPageStoredLinkPathname(
            context.storage,
            roomMetadata.pageLink,
        );

        const linkMarkdown = printMarkdownTree({
            type: "link",
            url: roomPageLinkPathname,
            children: [{type: "text", value: "post"}],
        }).trim();

        response =
            `Comments on ${linkMarkdown}. ` +
            response.slice(match[0].length - 1 - match[1]!.length);
    }

    let actualMetadata: AgentWebPostPageMetadata;

    if (excludesPost || !metadata.isStartOfMessages) {
        // Double check that in this case we're on a tail page without a `<post>`.
        assert(!hasPostOpenTag);

        actualMetadata = {...metadata, type: "Post", id, isStartOfMessages: false};
    } else {
        // Double check that in this case we're on the head page with a `<post>`.
        assert(hasPostOpenTag);
        assert(hasLoadedStartCustomBlock);

        actualMetadata = {
            ...metadata,
            type: "Post",
            id,
            isStartOfMessages: true,
            postKeys: assertExists((await roomMetadataWithStartCustomBlock.get()).keys),
        };
    }

    return {response, metadata: actualMetadata};
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
        printPage: (page: AgentWebPostPage) => Promise<string>;
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
                case "Head": {
                    if (preamble.channel) normalizer.normalizeReference(preamble.channel);
                    break;
                }
                case "Tail": {
                    normalizer.normalizeReference(preamble.post);
                    break;
                }
                default:
                    throw exhaustive(preamble);
            }
        },
        normalizeCustomBlock: (normalizer, customBlock) => {
            if (customBlock.author) normalizer.normalizeReference(customBlock.author);
            normalizer.normalizeBlockElements(customBlock.content.elements);
        },
    });
}

export async function createAgentWebPostPage(
    context: AgentWebContext,
    newPage: AgentWebPostPage,
): Promise<{
    pageMetadata: AgentWebPostPageMetadata;
    pageLink: Extract<AgentWebPageStoredLink, {type: "Post"}>;
}> {
    if (newPage.subType !== "Head" || !newPage.preamble.channel) {
        throw new InvalidArgumentError("Channel is required when creating post", {
            displayMessage: errorDisplayMessage`A channel is required when creating a \`<post>\`. You must add a \`Post in [My Channel](/channel/my-channel).\` line at the start of the post markdown with the channel you want to create the post in. Try again and add a channel.`,
        });
    }

    // `parseAgentWebPostPage()` should handle this error for us.
    assert(!newPage.pagination);

    if (newPage.blocks[0].type === "Time") {
        throw new InvalidArgumentError("Can only create posts", {
            displayMessage: errorDisplayMessage`Unexpected \`<time>\`, you can only add a \`<post>\`. The creation time of the post will be decided by the server. Try again and remove the new \`<time>\`.`,
        });
    }

    const {channel} = newPage.preamble;
    const postBlock = newPage.blocks[0];

    if (postBlock.author !== null && postBlock.author.id !== context.botAccount.id) {
        const authorLink: Link = {
            type: "link",
            url: context.botAccount.pathname,
            children: [{type: "text", value: context.botAccount.shortName}],
        };

        throw new InvalidArgumentError("Can only create posts as own account", {
            displayMessage: errorDisplayMessage`You can only create a \`<post>\` as yourself. Try again with a \`from\` attribute that references yourself (\`from="${escapeHtml(printMarkdownTree(authorLink).trim())}"\`).`,
        });
    }

    if (postBlock.timeZoneAttribute !== null) {
        // TODO(#agents-web): Implement parsing of time zone attribute.
        throw new UnimplementedError(
            "Parsing of time zone attribute into `TimeZone` type hasn\u2019t been implemented",
        );
    }

    // Creation is placed in a `Lazy` since we want to create the post at the last
    // possible moment before it's needed. We want `updateAgentWebPostPage()` to run
    // any validations first before we create the post and then only right before
    // `updateAgentWebPostPage()` tries to create new post comments do we want to
    // create the post.
    const createPromise = new Lazy(async () => {
        const {
            data: {post},
        } = await context.api.post(context.span, "/posts", {
            body: {
                spaceId: context.spaceId,
                post: {
                    channel,
                    content: postBlock.content,
                },
            },
        });

        const pageLink: Extract<AgentWebPageStoredLink, {type: "Post"}> = {
            type: "Post",
            id: post.id,
            title: post.reference.title,
        };

        return {
            post,
            pageLink,
        };
    });

    const pageMetadata = await updateAgentWebPostPage(
        context,
        async () => {
            const {pageLink} = await createPromise.get();
            return await createAgentWebPageStoredLinkPathname(context.storage, pageLink);
        },
        async () => {
            const {post} = await createPromise.get();

            const {keys} = unzipKeysFromApiContentResponse(post.content);

            return {
                type: "Post",
                id: post.id,
                isStartOfMessages: true,
                isEndOfMessages: true,
                postKeys: keys,
                messages: [],
            };
        },
        {...newPage, blocks: [postBlock]},
        newPage,
    );

    const {pageLink} = await createPromise.get();

    return {pageMetadata, pageLink};
}

export async function updateAgentWebPostPage(
    context: AgentWebContextWithoutStorage,
    pathname: MaybeThunk<MaybePromise<string>>,
    oldPageMetadata: MaybeThunk<MaybePromise<AgentWebPostPageMetadata>>,
    oldPage: AgentWebPostPage,
    newPage: AgentWebPostPage,
): Promise<AgentWebPostPageMetadata> {
    switch (oldPage.subType) {
        case "Head": {
            if (newPage.subType !== "Head") {
                throw new InvalidArgumentError("Can\u2019t update post preamble", {
                    displayMessage: errorDisplayMessage`You can only update your \`<post>\`s and \`<comment>\`s. You must leave the \`Post in [My Channel](/channel/my-channel).\` line at the start of the post markdown in place. Try again with a more specific update that only changes the content of the post (if it\u2019s from you) or adds new comments.`,
                });
            }

            // We may support this in the future but we don't today! That's why we say you
            // can't _currently_ do this thing.
            if (oldPage.preamble.channel?.id !== newPage.preamble.channel?.id) {
                throw new InvalidArgumentError(
                    "Can\u2019t currently change the channel a post is in",
                    {
                        displayMessage: errorDisplayMessage`You can\u2019t currently move a post to a different channel. Try again with a more specific update that only changes the content of the post (if it\u2019s from you) or adds new comments.`,
                    },
                );
            }
            break;
        }
        case "Tail": {
            if (newPage.subType !== "Tail") {
                throw new InvalidArgumentError("Can\u2019t update post preamble", {
                    displayMessage: errorDisplayMessage`You can only update your \`<comment>\`s. You must leave the \`Comments on [post](/post/my-post).\` line at the start of the post markdown in place. Try again with a more specific update that only changes the content comments from you or adds new comments.`,
                });
            }

            if (oldPage.preamble.post.id !== newPage.preamble.post.id) {
                throw new InvalidArgumentError("Can\u2019t update post in post preamble", {
                    displayMessage: errorDisplayMessage`You can only update your \`<comment>\`s. You can\u2019t change which post the comments belong to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.`,
                });
            }
            break;
        }
        default:
            throw exhaustive(oldPage);
    }

    // Only call the `oldPageMetadata` thunk once. We're about to reference it multiple
    // times and don't want each reference to call the underlying thunk again when
    // unwrapped.
    oldPageMetadata = memoMaybeThunk(oldPageMetadata);

    const newPageMetadata = await updateAgentWebMessagingPage<
        AgentWebPostPagePreambleBase,
        AgentWebPostPageCustomBlock
    >(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        pathname,
        room: mapMaybeThunk(oldPageMetadata, oldPageMetadata =>
            mapMaybePromise(oldPageMetadata, oldPageMetadata => ({
                type: "Post",
                id: oldPageMetadata.id,
            })),
        ),
        oldPageMetadata,
        oldPage,
        newPage,
        prepareCustomBlockUpdate: (oldCustomBlock, newCustomBlock) => {
            // Strip response properties from the block before comparing for equality. We don't
            // care if `reference.title`s aren't equal. The `title` might have changed between
            // the old page load time and new page generation time.
            const normalizeBlock = (block: AgentWebPostPageCustomBlock) => {
                return {
                    author: {id: block.author?.id ?? context.botAccount.id},
                    timeAttribute: block.timeAttribute,
                    timeZoneAttribute: block.timeZoneAttribute,
                    content: normalizeApiContent(block.content),
                };
            };

            const normalizedOldBlock = normalizeBlock(oldCustomBlock);
            const normalizedNewBlock = normalizeBlock(newCustomBlock);

            if (isDeepEqual(normalizedOldBlock, normalizedNewBlock)) return {update: asyncNoop};

            if (
                normalizedOldBlock.author.id !== context.botAccount.id ||
                normalizedNewBlock.author.id !== context.botAccount.id
            ) {
                if (normalizedOldBlock.author.id !== context.botAccount.id) {
                    throw new InvalidArgumentError(
                        "Can\u2019t update post created by someone else",
                        {
                            displayMessage: errorDisplayMessage`You can only update your \`<post>\`s. You can\u2019t update a \`<post>\` created by ${oldCustomBlock.author?.shortName ?? context.botAccount.shortName}. \`<post from="${escapeHtml(oldCustomBlock.author?.shortName ?? context.botAccount.shortName)}">\` was changed by this update. Try again with a more specific update that only changes the content of comments from you or adds new comments.`,
                        },
                    );
                } else {
                    // Going to continue from here. The `if (isDeepEqual(...))` immediately below will
                    // throw in this case and will produce a much better error message.
                }
            }

            if (
                !isDeepEqual(
                    omitObject(normalizedOldBlock, ["content"]),
                    omitObject(normalizedNewBlock, ["content"]),
                )
            ) {
                throw new InvalidArgumentError("Can\u2019t update post created by someone else", {
                    displayMessage: errorDisplayMessage`You can only update the content of your \`<post>\`s. Any metadata (the \`from\`/\`timezone\` attributes) must be left unchanged. The metadata of the \`<post>\` was changed by this update. Try again with a more specific update that only changes the content of your post.`,
                });
            }

            return {
                update: async () => {
                    // TODO(#agents-web): Implement post update content endpoint.
                    //
                    // When implementing this content endpoint make sure to update `postKeys` in
                    // metadata!
                    throw new UnimplementedError(
                        "Post update content API endpoint hasn\u2019t been implemented yet",
                    );
                },
            };
        },
    });

    const actualOldPageMetadata = await unwrapMaybeThunk(oldPageMetadata);

    if (!actualOldPageMetadata.isStartOfMessages) {
        assert(!newPageMetadata.isStartOfMessages);
        return {...actualOldPageMetadata, ...newPageMetadata, isStartOfMessages: false};
    } else {
        assert(newPageMetadata.isStartOfMessages);
        return {...actualOldPageMetadata, ...newPageMetadata, isStartOfMessages: true};
    }
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
                case "Head": {
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
                case "Tail": {
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
                block.author ? createAgentWebPageStoredLinkPathname(storage, block.author) : null,
                printApiContentToAgentWebMarkdownTree(storage, block.content),
            ]);

            let openTag = "<post";

            if (block.author !== null) {
                const authorLink: Link = {
                    type: "link",
                    url: assertExists(authorPathname),
                    children: [{type: "text", value: block.author.shortName}],
                };

                openTag += ` from="${escapeHtml(printMarkdownTree(authorLink).trim())}"`;
            }

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
                        return {type: "Head", channel: null};
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
                    return {type: "Head", channel: secondElement.reference};
                }
                case "Comments on ": {
                    if (secondElement.reference.type !== "Post") throw createError();
                    return {type: "Tail", post: secondElement.reference};
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

                const [author, content] = await runAllPromises([
                    fromAttribute === null
                        ? null
                        : parseAgentWebPostPageAccountLink(storage, openTagPosition, fromAttribute),
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

    const postBlockIndexes: Array<number> = [];

    for (const [index, block] of page.blocks.entries()) {
        if (block.type === "Custom" && block.tagName === "post") {
            postBlockIndexes.push(index);
        }
    }

    switch (page.preamble.type) {
        case "Head": {
            const firstPostBlockIndex = postBlockIndexes[0]!;

            const hasPostBlockImmediatelyAfterOpeningTime =
                postBlockIndexes.length === 1 &&
                (firstPostBlockIndex === 0 ||
                    (firstPostBlockIndex === 1 && page.blocks[0]?.type === "Time"));

            if (!hasPostBlockImmediatelyAfterOpeningTime) {
                throw new InvalidArgumentError("Must have one post block at start of head page", {
                    displayMessage: errorDisplayMessage`A \`<post>\` must be the first thing in post markdown and it must be placed after the first line which states what channel the post is in (e.g. \`Post in [My Channel](/channel/my-channel).\`) and there must only be one \`<post>\`. Try again with one \`<post>\` at the start of the markdown.`,
                });
            }

            return {
                ...page,
                type: "Post",
                subType: "Head",
                preamble: page.preamble,
                blocks: page.blocks as AgentWebPostHeadPageBlocks,
            };
        }
        case "Tail": {
            if (postBlockIndexes.length > 0) {
                throw new InvalidArgumentError("Post block on tail post page", {
                    displayMessage: errorDisplayMessage`Can\u2019t add a \`<post>\` to a post\u2019s comments section. Remove the \`<post>\` and try again.`,
                });
            }

            return {
                ...page,
                type: "Post",
                subType: "Tail",
                preamble: page.preamble,
                blocks: page.blocks as ReadonlyArray<AgentWebMessagingPageBlock<never>>,
            };
        }
        default:
            throw exhaustive(page.preamble);
    }
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
