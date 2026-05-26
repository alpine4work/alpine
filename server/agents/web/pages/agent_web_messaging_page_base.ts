import {fromDate, toCalendarDate} from "@internationalized/date";
import {differenceInHours, differenceInMinutes} from "date-fns";
import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {produce} from "immer";
import {Html, Link, Node, PhrasingContent, Root, RootContent} from "mdast";
import {getApiMessagesFromEnd, getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageLinkApiMentionTargetIfPossible} from "~/server/agents/web/create_agent_web_page_link_api_mention_target_if_possible.js";
import {createApiTargetAgentWebPageLink} from "~/server/agents/web/create_api_target_agent_web_page_link.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_link_pathname.js";
import {getAgentWebPageLinkByPathname} from "~/server/agents/web/internal/get_agent_web_page_link_by_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {
    normalizeApiContent,
    normalizeApiContentInlineElements,
    normalizeApiTarget,
} from "~/shared/api/markdown/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {intoApiAccountTarget} from "~/shared/api/specification/into_api_account_target.js";
import {
    ApiAccountTargetResponse,
    ApiContentBlockElementResponse,
    ApiContentInlineElementResponse,
    ApiContentResponse,
    ApiMentionTargetResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
    ApiMessageRoomTarget,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {InternalError, InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {alternateIterables} from "~/shared/helpers/iterable/alternate_iterables.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Update messaging page, create messaging room?

export type AgentWebMessagingPageBase = {
    readonly preamble: AgentWebMessagingPageBasePreamble;
    readonly isEndOfMessages: boolean;
    readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock>;
};

export type AgentWebMessagingPageBasePreamble = {
    readonly elements: ReadonlyArray<ApiContentInlineElementResponse>;
    readonly pagination: AgentWebMessagingPageBasePreamblePagination | null;
};

export type AgentWebMessagingPageBasePreamblePagination = {
    readonly target: ApiMentionTargetResponse;
} & (
    | {
          readonly previousLink: {readonly beforeMessageIndex: number};
          readonly nextLink: {readonly afterMessageIndex: number} | null;
      }
    | {
          readonly previousLink: {readonly beforeMessageIndex: number} | null;
          readonly nextLink: {readonly afterMessageIndex: number};
      }
);

export type AgentWebMessagingPageBlock =
    | AgentWebMessagingPageTimeBlock
    | AgentWebMessagingPageMessageBlock;

export type AgentWebMessagingPageTimeBlock = {
    readonly type: "Time";
    readonly timeContent: string;
};

export type AgentWebMessagingPageMessageBlock = {
    readonly type: "Message";
    readonly idAttribute: AgentWebMessagingPageMessageBlockIdAttribute | null;
    readonly author: ApiAccountTargetResponse;
    readonly timeAttribute: string | null;
    readonly timeZoneAttribute: string | null;
    readonly parent: AgentWebMessagingPageMessageBlockParent | null;
    readonly content: ApiContentResponse;
};

export type AgentWebMessagingPageMessageBlockIdAttribute = {
    /** Inclusive */
    readonly startMessageIndex: number;
    /** Exclusive */
    readonly endMessageIndex: number;
};

export type AgentWebMessagingPageMessageBlockParent = {
    readonly citeAttribute: {
        /** Inclusive */
        readonly startMessageIndex: number;
        /** Exclusive */
        readonly endMessageIndex: number;
    };
    readonly author: ApiAccountTargetResponse;
    readonly previewContent: ApiContentResponse;
};

export type AgentWebMessagingPageBaseMetadata = {
    readonly messageIndexesByBlockIndex: ReadonlyArray<{
        /** Inclusive */
        readonly startMessageIndex: number;
        /** Exclusive */
        readonly endMessageIndex: number;
    }>;
};

export type AgentWebMessagingPageBaseWithMetadata = AgentWebMessagingPageBase & {
    readonly metadata: AgentWebMessagingPageBaseMetadata;
};

type AgentWebMessagingPageNouns = {
    readonly noun: string;
    readonly pluralNoun: string;
    readonly startOfSentenceNoun: string;
    readonly startOfSentencePluralNoun: string;
};

export const agentWebMessagingPageMessageNouns: AgentWebMessagingPageNouns = {
    noun: "message",
    pluralNoun: "messages",
    startOfSentenceNoun: "Message",
    startOfSentencePluralNoun: "Messages",
};

export const agentWebMessagingPageCommentNouns: AgentWebMessagingPageNouns = {
    noun: "comment",
    pluralNoun: "comments",
    startOfSentenceNoun: "Comment",
    startOfSentencePluralNoun: "Comments",
};

const agentWebMessagingPageApiMessagesBatchCount = 30;

export async function readAgentWebMessagingPageBase<Page>(
    context: AgentWebContextWithoutStorage,
    messageNouns: AgentWebMessagingPageNouns,
    {
        room,
        roomMetadataPromise,
        defaultDirection,
        searchParams,
        limitLength,
        computeLength,
        buildPage,
    }: {
        room: ApiMessageRoomTarget;
        roomMetadataPromise: Promise<{
            target: ApiMentionTargetResponse;
            description: ReadonlyArray<ApiContentInlineElementResponse>;
        }>;
        defaultDirection: "Start" | "End";
        searchParams: URLSearchParams;
        limitLength: number;
        computeLength: (page: Page) => Promise<number>;
        buildPage: (page: AgentWebMessagingPageBaseWithMetadata) => Page;
    },
): Promise<Page> {
    const beforeMessageIndexSearchParam = searchParams.get("before");
    const afterMessageIndexSearchParam = searchParams.get("after");
    const aroundMessageIndexSearchParam = searchParams.get(messageNouns.noun);

    let beforeMessageIndex: number | null = null;
    let afterMessageIndex: number | null = null;
    let aroundMessageIndex: number | null = null;

    if (beforeMessageIndexSearchParam) {
        beforeMessageIndex = parseInt(beforeMessageIndexSearchParam, 10);

        if (
            !/^(0|[1-9][0-9]*)$/.test(beforeMessageIndexSearchParam) ||
            isNaN(beforeMessageIndex) ||
            !Number.isInteger(beforeMessageIndex) ||
            beforeMessageIndex < 0
        ) {
            throw new InvalidArgumentError(
                "Expected `before` search param to be a positive integer",
                {
                    displayMessage: errorDisplayMessage`Expected \`?before\` URL search param to be a positive integer, but got \`${beforeMessageIndexSearchParam}\`. Try again with an integer or try omitting \`?before\`. We recommend using a value for \`?before\` from a \`<${messageNouns.noun}>\`\u2019s \`id\` attribute.`,
                },
            );
        }
    }

    if (afterMessageIndexSearchParam) {
        afterMessageIndex = parseInt(afterMessageIndexSearchParam, 10);

        if (
            !/^(0|[1-9][0-9]*)$/.test(afterMessageIndexSearchParam) ||
            isNaN(afterMessageIndex) ||
            !Number.isInteger(afterMessageIndex) ||
            afterMessageIndex < 0
        ) {
            throw new InvalidArgumentError(
                "Expected `after` search param to be a positive integer",
                {
                    displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be a positive integer, but got \`${afterMessageIndexSearchParam}\`. Try again with an integer or try omitting \`?after\`. We recommend using a value for \`?after\` from a \`<${messageNouns.noun}>\`\u2019s \`id\` attribute.`,
                },
            );
        }
    }

    if (aroundMessageIndexSearchParam) {
        aroundMessageIndex = parseInt(aroundMessageIndexSearchParam, 10);

        if (
            !/^(0|[1-9][0-9]*)$/.test(aroundMessageIndexSearchParam) ||
            isNaN(aroundMessageIndex) ||
            !Number.isInteger(aroundMessageIndex) ||
            aroundMessageIndex < 0
        ) {
            throw new InvalidArgumentError(
                `Expected \`${messageNouns.noun}\` search param to be a positive integer`,
                {
                    displayMessage: errorDisplayMessage`Expected \`?${messageNouns.noun}\` URL search param to be a positive integer, but got \`${aroundMessageIndexSearchParam}\`. Try again with an integer or try omitting \`?${messageNouns.noun}\`. We recommend using a value for \`?${messageNouns.noun}\` from a \`<${messageNouns.noun}>\`\u2019s \`id\` attribute.`,
                },
            );
        }
    }

    let searchParamCount = 0;
    if (beforeMessageIndex !== null) searchParamCount++;
    if (afterMessageIndex !== null) searchParamCount++;
    if (aroundMessageIndex !== null) searchParamCount++;

    if (searchParamCount > 1) {
        throw new InvalidArgumentError("Expected only one pagination search param", {
            displayMessage: errorDisplayMessage`Expected only one of \`?before\`, \`?after\`, or \`?${messageNouns.noun}\` URL search params. Try again with only one of \`?before\`, \`?after\`, or \`?${messageNouns.noun}\`. We recommend using a value for \`?before\`, \`?after\`, or \`?${messageNouns.noun}\` from a \`<${messageNouns.noun}>\`\u2019s \`id\` attribute.`,
        });
    }

    // If the agent passes in a specific message/comment link then we have a different
    // code path for reading messages around some index. Bail and call that code path.
    if (aroundMessageIndex !== null) {
        return readAgentWebMessagingPageBaseAroundMessage(context, messageNouns, {
            room,
            roomMetadataPromise,
            aroundMessageIndex,
            limitLength,
            computeLength,
            buildPage,
        });
    }

    const direction: "Start" | "End" =
        afterMessageIndex !== null
            ? "Start"
            : beforeMessageIndex !== null
              ? "End"
              : defaultDirection;

    let cursor: number | null = direction === "Start" ? afterMessageIndex : beforeMessageIndex;
    let totalLengthEstimate = 0;
    let hasMoreMessages = false;
    let isEndOfMessages = direction === "End" && beforeMessageIndex === null;
    const messages: Array<ApiMessageResponse> = [];

    // Load messages until we reach our token limit.
    outer: while (totalLengthEstimate < limitLength) {
        const {
            data: {nextCursor, messages: currentMessages},
        } =
            direction === "Start"
                ? await getApiMessagesFromStart(context.span, context.api, room, {
                      limit: agentWebMessagingPageApiMessagesBatchCount,
                      cursor,
                  })
                : await getApiMessagesFromEnd(context.span, context.api, room, {
                      limit: agentWebMessagingPageApiMessagesBatchCount,
                      cursor,
                  });

        cursor = nextCursor;
        hasMoreMessages = cursor !== null;
        if (direction === "Start") isEndOfMessages = cursor === null;

        for (const message of direction === "Start"
            ? currentMessages
            : reverseIterable(currentMessages)) {
            const lengthEstimate = estimateApiMessageLength(message);

            // If this message would put us over our limit then DO NOT add the message and
            // instead return the messages we have.
            //
            // Unless we've filled less than half of our limit. In this case we must be adding
            // a single message with MORE length than half of our limit. Include the full
            // message. The maximum message size is 400kb. If we assume 1 character per bytes
            // that's 400k characters which is approximately 100k tokens using the
            // [one-token-is-about-four-characters rule of thumb][1]. GPT-5's context window is
            // 400k tokens so a max length message would consume a quarter of the context
            // window which is not ideal but still fine.
            //
            // [1]: https://platform.openai.com/tokenizer
            if (
                totalLengthEstimate > limitLength / 2 &&
                totalLengthEstimate + lengthEstimate > limitLength
            ) {
                hasMoreMessages = true;
                if (direction === "Start") isEndOfMessages = false;
                break outer;
            } else {
                totalLengthEstimate += lengthEstimate;
                messages.push(message);
            }
        }

        if (cursor === null) break;
    }

    // Make sure messages are in the right order.
    if (direction !== "Start") messages.reverse();

    // Await the room metadata after we've fetched all our messages. We should have
    // been loading the room metadata in parallel.
    const roomMetadata = await roomMetadataPromise;

    let page: Page;

    // Build the page from the messages we fetched and compute the page's length. If
    // the built page exceeds our limit then we remove one message and try building the
    // page again until we get a page that fits our limit.
    //
    // If we can get a page that's under the limit then the agent doesn't need to call
    // the `scroll` tool!
    while (true) {
        const messagingPage = buildAgentWebMessagingPageFromApiMessages(context, {
            messageNouns,
            direction,
            roomMetadata,
            messages,
            hasMoreMessages,
            isEndOfMessages,
        });

        page = buildPage(messagingPage);

        if (messages.length === 0) break;

        // If there's only one message left then we have to return it. We can't return a
        // page with no messages. This likely means the one message is larger than our
        // limit by itself.
        if (messages.length === 1) break;

        const length = await computeLength(page);
        if (length <= limitLength) break;

        hasMoreMessages = true;

        if (direction === "Start") {
            isEndOfMessages = false;
            messages.pop();
        } else {
            messages.shift();
        }
    }

    return page;
}

export async function readAgentWebMessagingPageBaseAroundMessage<Page>(
    context: AgentWebContextWithoutStorage,
    messageNouns: AgentWebMessagingPageNouns,
    {
        room,
        roomMetadataPromise,
        aroundMessageIndex,
        limitLength,
        computeLength,
        buildPage,
    }: {
        room: ApiMessageRoomTarget;
        roomMetadataPromise: Promise<{
            target: ApiMentionTargetResponse;
            description: ReadonlyArray<ApiContentInlineElementResponse>;
        }>;
        aroundMessageIndex: number;
        limitLength: number;
        computeLength: (page: Page) => Promise<number>;
        buildPage: (page: AgentWebMessagingPageBaseWithMetadata) => Page;
    },
): Promise<Page> {
    const {
        data: {messages: initialMessages},
    } = await getApiMessagesFromStart(context.span, context.api, room, {
        limit: agentWebMessagingPageApiMessagesBatchCount,
        cursor:
            aroundMessageIndex -
            1 -
            Math.floor((agentWebMessagingPageApiMessagesBatchCount - 1) / 2),
    });

    // We expect at least `aroundMessageIndex` to exist.
    assert(initialMessages.length > 0);

    let beforeCursor: number | null = initialMessages[0]!.index;
    let afterCursor: number | null = initialMessages[initialMessages.length - 1]!.index;
    let totalLengthEstimate = 0;
    let hasMoreMessages = false;
    let isEndOfMessages = false;
    const beforeMessages: Array<ApiMessageResponse> = [];
    const afterMessages: Array<ApiMessageResponse> = [];

    // Load messages until we reach our token limit.
    outer: while (
        (beforeCursor !== null || afterCursor !== null) &&
        totalLengthEstimate < limitLength
    ) {
        const [
            {
                data: {messages: currentBeforeMessages, nextCursor: nextBeforeCursor},
            },
            {
                data: {messages: currentAfterMessages, nextCursor: nextAfterCursor},
            },
        ]: [
            {data: {messages: ReadonlyArray<ApiMessageResponse>; nextCursor: number | null}},
            {data: {messages: ReadonlyArray<ApiMessageResponse>; nextCursor: number | null}},
        ] = await runAllPromises([
            beforeCursor === null
                ? {data: {messages: [], nextCursor: null}}
                : getApiMessagesFromEnd(context.span, context.api, room, {
                      limit: Math.floor(agentWebMessagingPageApiMessagesBatchCount / 2),
                      cursor: beforeCursor,
                  }),
            afterCursor === null
                ? {data: {messages: [], nextCursor: null}}
                : getApiMessagesFromStart(context.span, context.api, room, {
                      limit: Math.ceil(agentWebMessagingPageApiMessagesBatchCount / 2),
                      cursor: afterCursor,
                  }),
        ]);

        beforeCursor = nextBeforeCursor;
        afterCursor = nextAfterCursor;

        hasMoreMessages = beforeCursor !== null || afterCursor !== null;
        isEndOfMessages = afterCursor === null;

        for (const {type, message} of alternateIterables(
            mapIterable(currentAfterMessages, message => ({type: "After", message})),
            mapIterable(reverseIterable(currentBeforeMessages), message => ({
                type: "Before",
                message,
            })),
        )) {
            const lengthEstimate = estimateApiMessageLength(message);

            // If this message would put us over our limit then DO NOT add the message and
            // instead return the messages we have.
            //
            // Unless we've filled less than half of our limit. In this case we must be adding
            // a single message with MORE length than half of our limit. Include the full
            // message. The maximum message size is 400kb. If we assume 1 character per bytes
            // that's 400k characters which is approximately 100k tokens using the
            // [one-token-is-about-four-characters rule of thumb][1]. GPT-5's context window is
            // 400k tokens so a max length message would consume a quarter of the context
            // window which is not ideal but still fine.
            //
            // [1]: https://platform.openai.com/tokenizer
            if (
                totalLengthEstimate > limitLength / 2 &&
                totalLengthEstimate + lengthEstimate > limitLength
            ) {
                hasMoreMessages = true;
                if (type === "After") isEndOfMessages = false;
                break outer;
            } else {
                totalLengthEstimate += lengthEstimate;
                if (type === "Before") {
                    beforeMessages.push(message);
                } else {
                    afterMessages.push(message);
                }
            }
        }
    }

    const messages: Array<ApiMessageResponse> = [
        ...reverseIterable(beforeMessages),
        ...initialMessages,
        ...afterMessages,
    ];

    // Await the room metadata after we've fetched all our messages. We should have
    // been loading the room metadata in parallel.
    const roomMetadata = await roomMetadataPromise;

    let page: Page;
    let removeCount = 0;

    // Build the page from the messages we fetched and compute the page's length. If
    // the built page exceeds our limit then we remove one message and try building the
    // page again until we get a page that fits our limit.
    //
    // If we can get a page that's under the limit then the agent doesn't need to call
    // the `scroll` tool!
    while (true) {
        const messagingPage = buildAgentWebMessagingPageFromApiMessages(context, {
            messageNouns,
            direction: "Around",
            roomMetadata,
            messages,
            hasMoreMessages,
            isEndOfMessages,
        });

        page = buildPage(messagingPage);

        if (messages.length === 0) break;

        // If there's only one message left then we have to return it. We can't return a
        // page with no messages. This likely means the one message is larger than our
        // limit by itself.
        if (messages.length === 1) break;

        const length = await computeLength(page);
        if (length <= limitLength) break;

        hasMoreMessages = true;

        // Alternate removing messages from the beginning and end of the page. Always start
        // by removing messages from the beginning.
        //
        // Never remove `aroundMessageIndex`. If that's the first message then always
        // remove from the end. If that's the last message then always remove from the
        // start.
        if (messages[0]!.index === aroundMessageIndex) {
            isEndOfMessages = false;
            messages.pop();
        } else if (messages[messages.length - 1]!.index === aroundMessageIndex) {
            messages.shift();
        } else if (removeCount % 2 === 0) {
            messages.shift();
        } else {
            isEndOfMessages = false;
            messages.pop();
        }

        removeCount++;
    }

    return page;
}

/**
 * Estimate the length of a message after it has been printed to a Markdown string.
 * It's better to under estimate the message length than to over estimate.
 */
function estimateApiMessageLength(message: ApiMessageResponse): number {
    let lengthEstimate = 0;

    if (message.payload.type !== "Content") {
        // `Math.min()` since we'd rather under estimate than over estimate.
        lengthEstimate += Math.min("Delete message".length, "Deleted comment".length);
    } else {
        visitApiContent(message.payload.content, {
            // NOTE(ifitzsimmons): This recurses through the current element and counts the
            // total number of tokens for the root and all children. A slight optimization
            // would be to break out of the recursion loop as soon as a child element pushes
            // the token count over the limit. However, we shouldn't do this unless we have a
            // really strong reason. As is, this would likely only come up for really large
            // tables (because it will visit every cell in the table) and the table would have
            // have to be pretty massive to make a meaningful difference.
            visitInlineElement: element => {
                switch (element.type) {
                    case "Text": {
                        lengthEstimate += element.text.length;
                        break;
                    }
                    case "Mention": {
                        lengthEstimate += (element.target.title?.length ?? 0) + 4;
                        break;
                    }
                    case "Break": {
                        lengthEstimate += 1;
                        break;
                    }
                    default:
                        throw exhaustive(element);
                }
            },
            visitBlockElement: element => {
                switch (element.type) {
                    case "Paragraph": {
                        // "\n\n"
                        lengthEstimate += 2;
                        break;
                    }
                    case "UnorderedList": {
                        // "- "
                        lengthEstimate += element.items.length * 2;
                        break;
                    }
                    case "OrderedList": {
                        // "1. "
                        lengthEstimate += element.items.length * 3;
                        break;
                    }
                    case "CheckList": {
                        // "- [ ] "
                        lengthEstimate += element.items.length * 6;
                        break;
                    }
                    case "Quote": {
                        // "> "
                        lengthEstimate += element.elements.length * 2;
                        break;
                    }
                    case "Heading": {
                        // "## "
                        lengthEstimate += element.level + 2;
                        break;
                    }
                    case "Divider": {
                        // "---"
                        lengthEstimate += 3;
                        break;
                    }
                    case "Table": {
                        // Don't bother. Table length is hard to estimate. Though tables may add a lot of
                        // length if formatted as HTML! We'd rather underestimate than overestimate.
                        break;
                    }
                    case "Code": {
                        // "```\n" x2
                        lengthEstimate += 8;
                        break;
                    }
                    case "File":
                    case "FileGallery":
                    case "FileFloat": {
                        // Don't bother. File length is hard to estimate. We'd rather underestimate than
                        // overestimate.
                        break;
                    }
                    case "Preview": {
                        lengthEstimate += (element.target.title?.length ?? 0) + 5;
                        break;
                    }
                    default:
                        throw exhaustive(element);
                }
            },
            visitInlineElementMark: mark => {
                switch (mark.type) {
                    case "Bold": {
                        // "\*\*" x2
                        lengthEstimate += 4;
                        break;
                    }
                    case "Italic": {
                        // "\*" x2
                        lengthEstimate += 2;
                        break;
                    }
                    case "Strike": {
                        // "~~" x2
                        lengthEstimate += 4;
                        break;
                    }
                    case "Code": {
                        // "`" x2
                        lengthEstimate += 2;
                        break;
                    }
                    case "Link": {
                        // "[]()"
                        lengthEstimate += 4;
                        break;
                    }
                    case "Highlight":
                    case "Comment": {
                        // Don't bother. It's hard to estimate the length of these marks. We'd rather
                        // underestimate than overestimate.
                        break;
                    }
                    default:
                        throw exhaustive(mark);
                }
            },
        });

        if (message.payload.parent) {
            for (const element of message.payload.parent.contentSnippet.elements) {
                lengthEstimate += element.text.length;
            }
        }
    }

    return lengthEstimate;
}

function buildAgentWebMessagingPageFromApiMessages(
    context: AgentWebContextWithoutStorage,
    {
        messageNouns,
        direction,
        roomMetadata,
        messages,
        hasMoreMessages,
        isEndOfMessages,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        direction: "Start" | "End" | "Around";
        roomMetadata: {
            target: ApiMentionTargetResponse;
            description: ReadonlyArray<ApiContentInlineElementResponse>;
        };
        messages: ReadonlyArray<ApiMessageResponse>;
        hasMoreMessages: boolean;
        isEndOfMessages: boolean;
    },
): AgentWebMessagingPageBaseWithMetadata {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));
    const contextFormattedTimeZone = formatTimeZoneAbbreviation(context.timeZone, contextTime);

    const blocks: Array<AgentWebMessagingPageBlock> = [];
    const messageIndexesByBlockIndex: Array<{startMessageIndex: number; endMessageIndex: number}> =
        [];
    let previousTimeInjectionTime: Date | null = null;

    let currentBlock: {
        authorId: AccountId;
        formattedTimeZone: string;
        firstCreatedTime: Date;
        lastCreatedTime: Date;
        differenceInMinutesSinceLastMessage: number;
        messages: Array<ApiMessageResponse>;
    } | null = null;

    for (const message of messages) {
        const createdTime = deserializeDateString(message.createdTime);
        const formattedTimeZone = formatTimeZoneAbbreviation(message.createdTimeZone, createdTime);

        const differenceInMinutesSinceLastMessage: number =
            currentBlock !== null
                ? differenceInMinutes(createdTime, currentBlock.lastCreatedTime)
                : 0;

        // If there are consecutive messages from the same author, we put them within the
        // same message block IF:
        //
        // 1. The current message is not a reply to a previous message.
        // 2. They're less than 10 minutes apart.
        // 3. The author did not switch timezones.
        //
        // Importantly, a user can change Olson Timezones without changing the actual
        // standardized timezone. e.g. America/New_York and America/Toronto both format to
        // EST, so we shouldn't show the timezone attribute if a user takes a flight from
        // NYC to Toronto.
        const shouldContinueBlock =
            (message.payload.type !== "Content" || !message.payload.parent) &&
            currentBlock !== null &&
            currentBlock.authorId === message.author.id &&
            currentBlock.formattedTimeZone === formattedTimeZone &&
            differenceInMinutesSinceLastMessage < 10 &&
            // Never merge the current bot's messages. This makes it easier when we need to
            // update the current bot's message content.
            message.author.id !== context.botAccountId &&
            // Special case: `index` -1 is used for posts which are formatted like a message
            // (see `getPostAgentMessage()`). We don't want the post to be merged with the
            // first comment from the same author as they'll be rendered as two distinct text
            // blocks in the UI.
            //
            // This is a bit of a hack. It relies on the knowledge that `getPostAgentMessage()`
            // uses `index` -1 for posts.
            message.index > 0;

        if (shouldContinueBlock) {
            // shouldContinueBlock can only be true if currentBlock is not null.
            assert(currentBlock !== null);

            currentBlock.messages.push(message);
            currentBlock.lastCreatedTime = createdTime;
            continue;
        }

        // Flush the previous block before starting a new one
        flushCurrentBlock();

        // Inject time tag if needed
        if (
            previousTimeInjectionTime === null ||
            differenceInHours(createdTime, previousTimeInjectionTime) >= 1
        ) {
            const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                defaultLocale,
                context.timeZone,
                contextDate,
                createdTime,
                {withLongMonth: true},
            );
            previousTimeInjectionTime = createdTime;

            blocks.push({
                type: "Time",
                timeContent: `${formattedTime} ${contextFormattedTimeZone}`,
            });

            messageIndexesByBlockIndex.push({
                startMessageIndex: message.index,
                endMessageIndex: message.index,
            });
        }

        currentBlock = {
            authorId: message.author.id,
            formattedTimeZone,
            firstCreatedTime: createdTime,
            lastCreatedTime: createdTime,
            differenceInMinutesSinceLastMessage,
            messages: [message],
        };
    }

    // Flush any remaining block
    flushCurrentBlock();

    const preambleElements: Array<ApiContentInlineElementResponse> = [
        {
            type: "Text",
            text:
                messages.length > 0
                    ? `Some ${messageNouns.pluralNoun} `
                    : `No ${messageNouns.pluralNoun} `,
        },
        ...roomMetadata.description,
        {
            type: "Text",
            text: ".",
        },
    ];

    let pagination: AgentWebMessagingPageBasePreamblePagination | null = null;

    if (hasMoreMessages && messages.length > 0) {
        switch (direction) {
            case "Start": {
                pagination = {
                    target: roomMetadata.target,
                    previousLink: null,
                    nextLink: {afterMessageIndex: messages[messages.length - 1]!.index},
                };
                break;
            }
            case "End": {
                pagination = {
                    target: roomMetadata.target,
                    previousLink: {beforeMessageIndex: messages[0]!.index},
                    nextLink: null,
                };
                break;
            }
            case "Around": {
                pagination = {
                    target: roomMetadata.target,
                    previousLink: {beforeMessageIndex: messages[0]!.index},
                    nextLink: {afterMessageIndex: messages[messages.length - 1]!.index},
                };
                break;
            }
            default:
                throw exhaustive(direction);
        }
    }

    return {
        preamble: {elements: preambleElements, pagination},
        isEndOfMessages,
        blocks,
        metadata: {messageIndexesByBlockIndex},
    };

    function flushCurrentBlock() {
        if (currentBlock === null) return;

        assert(currentBlock.messages.length > 0);
        const firstMessage = currentBlock.messages[0]!;
        const lastMessage = currentBlock.messages[currentBlock.messages.length - 1]!;

        let timeAttribute = null;
        let timeZoneAttribute = null;

        // Include the time difference between this message and the last message. Since it
        // may be important context for the conversation. Whenever messages are more than
        // an hour apart, we inject a `<time/>` tag with the time of the message. The first
        // message after the time injection should never have a relative time. Because we
        // inject the current time between messages that are further than an hour apart,
        // the relative time between two messages between time injection tags will never
        // exceed 1 hour.
        if (
            currentBlock.firstCreatedTime.getTime() !== previousTimeInjectionTime?.getTime() &&
            currentBlock.differenceInMinutesSinceLastMessage >= 10
        ) {
            timeAttribute = `${printPrettyNumber(
                defaultLocale,
                currentBlock.differenceInMinutesSinceLastMessage,
                "minute",
            )} later`;
        }

        // Include timezone attribute for users whose timezone differs from the context
        // timezone
        if (
            !firstMessage.author.botId &&
            currentBlock.formattedTimeZone !== contextFormattedTimeZone
        ) {
            timeZoneAttribute = currentBlock.formattedTimeZone;
        }

        let parent = null;

        if (firstMessage.payload.type === "Content" && firstMessage.payload.parent) {
            const messageParent = firstMessage.payload.parent;

            switch (messageParent.type) {
                case "Message": {
                    parent = {
                        citeAttribute: {
                            startMessageIndex: messageParent.index,
                            endMessageIndex:
                                messageParent.endIndex !== undefined
                                    ? messageParent.endIndex + 1
                                    : messageParent.index + 1,
                        },
                        author: intoApiAccountTarget(messageParent.author),
                        previewContent:
                            convertApiMessageContentPayloadParentContentSnippetToContent(
                                messageParent.contentSnippet,
                            ),
                    };
                    break;
                }
                case "Post": {
                    throw new UnimplementedError(
                        "Post parent quote references are not implemented.",
                    );
                }
                default:
                    throw exhaustive(messageParent);
            }
        }

        const elements: Array<ApiContentBlockElementResponse> = [];

        for (const message of currentBlock.messages) {
            switch (message.payload.type) {
                case "Deleted": {
                    elements.push({
                        type: "Paragraph",
                        elements: [{type: "Text", text: `Deleted ${messageNouns.noun}`}],
                    });
                    break;
                }
                case "Content": {
                    for (const element of message.payload.content.elements) {
                        elements.push(element);
                    }
                    break;
                }
                default:
                    throw exhaustive(message.payload);
            }
        }

        blocks.push({
            type: "Message",
            idAttribute: {
                startMessageIndex: firstMessage.index,
                endMessageIndex: lastMessage.index + 1,
            },
            author: intoApiAccountTarget(firstMessage.author),
            timeAttribute,
            timeZoneAttribute,
            parent,
            content: {elements},
        });

        messageIndexesByBlockIndex.push({
            startMessageIndex: firstMessage.index,
            endMessageIndex: lastMessage.index + 1,
        });

        currentBlock = null;
    }
}

function convertApiMessageContentPayloadParentContentSnippetToContent(
    parent: ApiMessageContentPayloadParentContentSnippet,
): ApiContentResponse {
    const elements: ReadonlyArray<ApiContentInlineElementResponse> = !parent.isTruncated
        ? parent.elements
        : [...parent.elements, {type: "Text", text: " […]"}];

    return {elements: [{type: "Paragraph", elements}]};
}

export async function updateAgentWebMessagingPageBase(
    context: AgentWebContextWithoutStorage,
    oldPage: AgentWebMessagingPageBaseWithMetadata,
    newPage: AgentWebMessagingPageBase,
): Promise<void> {
    // Strip response properties from the preamble before comparing for equality. We
    // don't care if `target.title`s aren't equal. The `title` might have changed
    // between the old page load time and new page generation time.
    const normalizePreamble = (preamble: AgentWebMessagingPageBasePreamble) => {
        return {
            elements: normalizeApiContentInlineElements(preamble.elements),
            pagination: preamble.pagination
                ? {
                      ...preamble.pagination,
                      target: normalizeApiTarget(preamble.pagination.target),
                  }
                : null,
        };
    };

    if (!isDeepEqual(normalizePreamble(oldPage.preamble), normalizePreamble(newPage.preamble))) {
        throw new UnimplementedError("NOCOMMIT");
    }

    const commonBlocksLength = Math.min(oldPage.blocks.length, newPage.blocks.length);

    for (let index = 0; index < commonBlocksLength; index++) {
        const oldBlock = oldPage.blocks[index]!;
        const newBlock = newPage.blocks[index]!;

        // Strip response properties from the block before comparing for equality. We don't
        // care if `target.title`s aren't equal. The `title` might have changed between the
        // old page load time and new page generation time.
        const normalizeBlock = (block: AgentWebMessagingPageBlock) => {
            if (block.type === "Time") return block;

            return {
                type: "Message",
                idAttribute: block.idAttribute,
                author: normalizeApiTarget(block.author),
                timeAttribute: block.timeAttribute,
                timeZoneAttribute: block.timeZoneAttribute,
                parent: block.parent
                    ? {
                          citeAttribute: block.parent.citeAttribute,
                          author: normalizeApiTarget(block.parent.author),
                          previewContent: normalizeApiContent(block.parent.previewContent),
                      }
                    : null,
                content: normalizeApiContent(block.content),
            };
        };

        const normalizedOldBlock = normalizeBlock(oldBlock);
        const normalizedNewBlock = normalizeBlock(newBlock);

        if (isDeepEqual(normalizedOldBlock, normalizedNewBlock)) continue;

        if (
            normalizedOldBlock.type !== "Message" ||
            normalizedOldBlock.author.id !== context.botAccountId ||
            normalizedNewBlock.type !== "Message" ||
            normalizedNewBlock.author.id !== context.botAccountId
        ) {
            throw new UnimplementedError("NOCOMMIT");
        }

        if (
            !isDeepEqual(
                omitObject(normalizedOldBlock, ["content"]),
                omitObject(normalizedNewBlock, ["content"]),
            )
        ) {
            throw new UnimplementedError("NOCOMMIT");
        }

        const messageIndexes = oldPage.metadata.messageIndexesByBlockIndex[index]!;

        if (messageIndexes.startMessageIndex !== messageIndexes.endMessageIndex - 1) {
            throw new InternalError("We should never merge the current bot\u2019s messages");
        }

        // NOCOMMIT: Update content! Delete if new content is empty.
    }

    if (oldPage.blocks.length > newPage.blocks.length) {
        throw new UnimplementedError("NOCOMMIT");
    }

    let hasCreatedMessage = false;

    for (let index = commonBlocksLength; index < newPage.blocks.length; index++) {
        const newBlock = newPage.blocks[index]!;

        if (newBlock.type !== "Message" || newBlock.author.id !== context.botAccountId) {
            throw new UnimplementedError("NOCOMMIT");
        }

        hasCreatedMessage = true;

        // NOCOMMIT: Create message! But only if we're at the end of all messages in this
        // room.
    }

    if (oldPage.isEndOfMessages !== newPage.isEndOfMessages) {
        // If the agent replaced our "End of messages." paragraph with a new message, we're
        // ok with that. The "End of messages." paragraph exists as a hook for the agent to
        // easily append a new message to the end of the page.
        const ignore = oldPage.isEndOfMessages && !newPage.isEndOfMessages && hasCreatedMessage;

        if (!ignore) {
            throw new UnimplementedError("NOCOMMIT");
        }
    }
}

export function normalizeAgentWebMessagingPageBase<Page extends AgentWebMessagingPageBase>(
    page: Page,
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizer.normalizeInlineElements(page.preamble.elements);

            if (page.preamble.pagination)
                normalizer.normalizeTarget(page.preamble.pagination.target);

            for (const block of page.blocks) {
                if (block.type !== "Message") continue;

                // The order of these normalization calls matters and needs to match the order of
                // `createAgentWebPageLinkPathname()` calls in `printAgentWebMessagingPageBase()`.

                normalizer.normalizeTarget(block.author);

                if (block.parent) {
                    normalizer.normalizeTarget(block.parent.author);
                    normalizer.normalize(block.parent.previewContent);
                }

                normalizer.normalize(block.content);
            }
        });
    });
}

const previousPageLinkTextWithEndArrow = "Previous page »";
const previousPageLinkTextWithStartArrow = "« Previous page";
const nextPageLinkText = "Next page »";

export async function printAgentWebMessagingPageBase<PageLink>(
    messageNouns: AgentWebMessagingPageNouns,
    storage: AgentWebSessionStorage,
    pageLink: PageLink,
    page: AgentWebMessagingPageBase,
): Promise<Root> {
    const children: Array<RootContent> = [];

    const [, blocks] = await runAllPromises([
        (async () => {
            const [, paginationLinks] = await runAllPromises([
                (async () => {
                    if (page.preamble.elements.length === 0) return;

                    const preambleTree = await printApiContentToAgentWebMarkdownTree(storage, {
                        elements: [{type: "Paragraph", elements: page.preamble.elements}],
                    });

                    for (const node of preambleTree.children) {
                        children.push(node);
                    }
                })(),
                (async () => {
                    const pagination = page.preamble.pagination;
                    if (!pagination) return [];

                    const pageLink = createApiTargetAgentWebPageLink(pagination.target);
                    const pathname = await createAgentWebPageLinkPathname(storage, pageLink);

                    const paginationLinks: Array<PhrasingContent> = [];

                    if (pagination.previousLink) {
                        paginationLinks.push({
                            type: "link",
                            url: `${pathname}?before=${pagination.previousLink.beforeMessageIndex}`,
                            children: [
                                {
                                    type: "text",
                                    value: pagination.nextLink
                                        ? previousPageLinkTextWithStartArrow
                                        : previousPageLinkTextWithEndArrow,
                                },
                            ],
                        });
                    }

                    if (pagination.previousLink && pagination.nextLink) {
                        paginationLinks.push({type: "text", value: " | "});
                    }

                    if (pagination.nextLink) {
                        paginationLinks.push({
                            type: "link",
                            url: `${pathname}?after=${pagination.nextLink.afterMessageIndex}`,
                            children: [
                                {
                                    type: "text",
                                    value: nextPageLinkText,
                                },
                            ],
                        });
                    }

                    return paginationLinks;
                })(),
            ]);

            if (paginationLinks.length > 0) {
                const lastChild = children[children.length - 1];

                if (lastChild?.type === "paragraph") {
                    lastChild.children.push({type: "text", value: " "}, ...paginationLinks);
                } else {
                    children.push({type: "paragraph", children: paginationLinks});
                }
            }
        })(),
        runAllPromises(
            page.blocks.map(async block => {
                if (block.type !== "Message") return block;

                // The order of calls in this function matters and needs to match the normalization
                // order in `normalizeAgentWebMessagingPageBase()`.
                const [authorPathname, parent, contentTree] = await runAllPromises([
                    createAgentWebPageLinkPathname(storage, block.author),
                    block.parent
                        ? runAllObjectPromises({
                              authorPathname: createAgentWebPageLinkPathname(
                                  storage,
                                  block.parent.author,
                              ),
                              previewContentTree: printApiContentToAgentWebMarkdownTree(
                                  storage,
                                  block.parent.previewContent,
                              ),
                          })
                        : null,
                    printApiContentToAgentWebMarkdownTree(storage, block.content),
                ]);

                return {
                    ...block,
                    authorPathname,
                    contentTree,
                    parent: block.parent ? {...block.parent, ...assertExists(parent)} : null,
                };
            }),
        ),
    ]);

    for (const block of blocks) {
        switch (block.type) {
            case "Time": {
                // This is the format our Markdown parser would return when parsing
                // `<time>test</time>`. Use the same format here when printing.
                children.push({
                    type: "paragraph",
                    children: [
                        {type: "html", value: "<time>"},
                        {type: "text", value: block.timeContent},
                        {type: "html", value: "</time>"},
                    ],
                });
                break;
            }
            case "Message": {
                const authorLink: Link = {
                    type: "link",
                    url: block.authorPathname,
                    children: [{type: "text", value: block.author.shortName}],
                };

                let openTag = `<${messageNouns.noun}`;

                if (block.idAttribute !== null) {
                    openTag += ` id="${printAgentWebMessagingPageMessageIndexRange(block.idAttribute)}"`;
                }

                openTag += ` from="${escapeHtml(printMarkdownTree(authorLink).trim())}"`;

                if (block.timeAttribute !== null) {
                    openTag += ` time="${escapeHtml(block.timeAttribute)}"`;
                }

                if (block.timeZoneAttribute !== null) {
                    openTag += ` timezone="${escapeHtml(block.timeZoneAttribute)}"`;
                }

                openTag += ">";

                children.push({
                    type: "html",
                    value: openTag,
                });

                if (block.parent !== null) {
                    children.push({
                        type: "html",
                        value: `<blockquote cite="${escapeHtml(
                            printAgentWebMessagingPageParentCiteAttribute(
                                messageNouns,
                                block.parent.citeAttribute,
                            ),
                        )}">`,
                    });

                    for (const childNode of printAgentWebMessagingPageParentPreviewContentTree(
                        block.parent,
                    )) {
                        children.push(childNode);
                    }

                    children.push({
                        type: "html",
                        value: "</blockquote>",
                    });
                }

                for (const childNode of block.contentTree.children) {
                    children.push(childNode);
                }

                children.push({
                    type: "html",
                    value: `</${messageNouns.noun}>`,
                });
                break;
            }
            default:
                throw exhaustive(block);
        }
    }

    if (page.isEndOfMessages) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: `End of ${messageNouns.pluralNoun}.`}],
        });
    }

    return {type: "root", children};
}

function printAgentWebMessagingPageMessageIndexRange({
    startMessageIndex,
    endMessageIndex,
}: {
    readonly startMessageIndex: number;
    readonly endMessageIndex: number;
}): string {
    const endMessageIndexInclusive = endMessageIndex - 1;

    assert(startMessageIndex >= 0);
    assert(Number.isInteger(startMessageIndex));

    assert(endMessageIndexInclusive >= 0);
    assert(Number.isInteger(endMessageIndexInclusive));

    if (startMessageIndex === endMessageIndexInclusive) {
        return `${startMessageIndex}`;
    }

    return `${startMessageIndex}-${endMessageIndexInclusive}`;
}

function printAgentWebMessagingPageParentCiteAttribute(
    messageNouns: AgentWebMessagingPageNouns,
    citeAttribute: AgentWebMessagingPageMessageBlockParent["citeAttribute"],
): string {
    return `?${messageNouns.noun}=${printAgentWebMessagingPageMessageIndexRange(citeAttribute)}`;
}

function printAgentWebMessagingPageParentPreviewContentTree(parent: {
    author: ApiAccountTargetResponse;
    authorPathname: string;
    previewContentTree: Root;
}): ReadonlyArray<RootContent> {
    const authorLink: Link = {
        type: "link",
        url: parent.authorPathname,
        children: [{type: "text", value: parent.author.shortName}],
    };

    const firstChild = parent.previewContentTree.children[0];

    if (firstChild?.type === "paragraph") {
        return [
            {
                ...firstChild,
                children: [authorLink, {type: "text", value: ": "}, ...firstChild.children],
            },
            ...parent.previewContentTree.children.slice(1),
        ];
    }

    return [
        {
            type: "paragraph",
            children: [authorLink, {type: "text", value: ":"}],
        },
        ...parent.previewContentTree.children,
    ];
}

export async function parseAgentWebMessagingPageBase<PageLink>(
    messageNouns: AgentWebMessagingPageNouns,
    storage: AgentWebSessionStorage,
    pageLink: PageLink | null,
    root: Root,
): Promise<AgentWebMessagingPageBase> {
    const blockPromises: Array<MaybePromise<AgentWebMessagingPageBlock>> = [];

    try {
        const result = await actuallyParseAgentWebMessagingPageBase(
            messageNouns,
            storage,
            pageLink,
            root,
            blockPromises,
        );

        return {
            ...result,
            blocks: await runAllPromises(blockPromises),
        };
    } catch (error) {
        try {
            await runAllPromises(blockPromises);
        } catch (otherError) {
            throw createAggregateError([error, otherError]);
        }
        throw error;
    }
}

async function actuallyParseAgentWebMessagingPageBase<PageLink>(
    messageNouns: AgentWebMessagingPageNouns,
    storage: AgentWebSessionStorage,
    pageLink: PageLink | null,
    root: Root,
    blockPromises: Array<MaybePromise<AgentWebMessagingPageBlock>>,
): Promise<Omit<AgentWebMessagingPageBase, "blocks">> {
    let hasFinishedPreamble = false;
    let isEndOfMessages = false;
    const preamble: Array<RootContent> = [];

    let state: {
        openTagPosition: Node["position"];
        hasEndedOpenTag: boolean;
        startedAttribute: "id" | "from" | "time" | "timezone" | null;
        idAttribute: string | null;
        fromAttribute: string | null;
        timeAttribute: string | null;
        timeZoneAttribute: string | null;
        parent: {
            openTagPosition: Node["position"];
            hasEndedOpenTag: boolean;
            hasCloseTag: boolean;
            startedAttribute: "cite" | null;
            citeAttribute: string | null;
            children: Array<RootContent>;
        } | null;
        children: Array<RootContent>;
    } | null = null;

    const parseHtml = (node: Html) => {
        let hasUnknownHtml = false;
        let firstHtmlTextIndex: number | null = null;
        let handledHtml: {tagName: string; tagType: "open" | "close"} | null = null;

        const tokenizer = new HtmlTokenizer(
            {},
            {
                onopentagname: (start, end) => {
                    const tagName = node.value.slice(start, end).toLowerCase();

                    switch (tagName) {
                        case messageNouns.noun: {
                            if (state) {
                                throw new InvalidArgumentError("Invalid message element open tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t open a new \`<${messageNouns.noun}>\` element on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open \`<${messageNouns.noun}>\` element and you can\u2019t nest ${messageNouns.noun} elements.`,
                                });
                            }

                            state = {
                                openTagPosition: node.position,
                                hasEndedOpenTag: false,
                                startedAttribute: null,
                                idAttribute: null,
                                fromAttribute: null,
                                timeAttribute: null,
                                timeZoneAttribute: null,
                                parent: null,
                                children: [],
                            };

                            handledHtml ??= {tagName, tagType: "open"};
                            break;
                        }
                        case "blockquote": {
                            // Special case error for nested `<blockquote>`s with a more specific error
                            // message.
                            if (state?.parent && !state.parent.hasCloseTag) {
                                throw new InvalidArgumentError(
                                    "Invalid parent element open tag (another parent tag was already opened)",
                                    {
                                        displayMessage: errorDisplayMessage`Can\u2019t open a new \`<blockquote>\` element on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open \`<blockquote>\` element and you can\u2019t nest \`<blockquote>\` elements. If you\u2019re trying to reply to a ${messageNouns.noun} that itself is replying to another ${messageNouns.noun} then just include the content of the ${messageNouns.noun} you\u2019re replying to and omit the extra \`<blockquote>\` element.`,
                                    },
                                );
                            }

                            if (!state || state.parent || state.children.length > 0) {
                                throw new InvalidArgumentError("Invalid parent element open tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t add \`<blockquote>\` element on line ${node.position?.start.line ?? "unknown"}. \`<blockquote>\` elements can only be used at the beginning of a \`<${messageNouns.noun}>\` element to indicate that the ${messageNouns.noun} is a reply to some other ${messageNouns.noun}.`,
                                });
                            }

                            state.parent = {
                                openTagPosition: node.position,
                                hasEndedOpenTag: false,
                                hasCloseTag: false,
                                startedAttribute: null,
                                citeAttribute: null,
                                children: [],
                            };

                            handledHtml ??= {tagName, tagType: "open"};
                            break;
                        }
                        default: {
                            hasUnknownHtml = true;
                            break;
                        }
                    }
                },
                onopentagend: () => {
                    if (state) {
                        if (!state.hasEndedOpenTag) {
                            assert(!state.startedAttribute);
                            state.hasEndedOpenTag = true;
                        } else if (state.parent && !state.parent.hasEndedOpenTag) {
                            assert(!state.parent.startedAttribute);
                            state.parent.hasEndedOpenTag = true;
                        }
                    }
                },
                onclosetag: (start, end) => {
                    const tagName = node.value.slice(start, end).toLowerCase();

                    switch (tagName) {
                        case messageNouns.noun: {
                            if (!state) {
                                throw new InvalidArgumentError(
                                    "Invalid message element close tag",
                                    {
                                        displayMessage: errorDisplayMessage`Can\u2019t close \`</${messageNouns.noun}>\` element on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching \`<${messageNouns.noun}>\` open tag.`,
                                    },
                                );
                            }

                            if (!state.hasEndedOpenTag || state.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            if (typeof state.fromAttribute !== "string") {
                                throw new InvalidArgumentError(
                                    "Message element is missing author link",
                                    {
                                        displayMessage: errorDisplayMessage`\`<${messageNouns.noun}>\` element on line ${state.openTagPosition?.start.line ?? "unknown"} is missing the \`from\` attribute. All ${messageNouns.pluralNoun} must include a link to the author.`,
                                    },
                                );
                            }

                            if (state.parent && !state.parent.hasCloseTag) {
                                throw new InvalidArgumentError("Missing parent element close tag", {
                                    displayMessage: errorDisplayMessage`\`<blockquote>\` element on line ${state.parent.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a \`</blockquote>\` closing tag and try again.`,
                                });
                            }

                            const parseAccountLink = async (
                                position: Node["position"],
                                string: string,
                            ) => {
                                const createError = () => {
                                    const quotedString = quoteMarkdown([
                                        {type: "text", value: string},
                                    ]);

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

                                const pageLinkResult = await getAgentWebPageLinkByPathname(
                                    storage,
                                    firstGrandchild.url,
                                );
                                if (!pageLinkResult) throw createError();

                                const {pageLink} = pageLinkResult;
                                if (pageLink.type !== "Account") throw createError();

                                return pageLink;
                            };

                            const idAttribute = parseAgentWebMessagingPageMessageBlockIdAttribute(
                                messageNouns,
                                state.openTagPosition,
                                state.idAttribute,
                            );

                            let parent: Promise<AgentWebMessagingPageMessageBlockParent> | null =
                                null;

                            if (state.parent) {
                                if (typeof state.parent.citeAttribute !== "string") {
                                    throw new InvalidArgumentError(
                                        "Parent element is missing message link",
                                        {
                                            displayMessage: errorDisplayMessage`\`<blockquote>\` element on line ${state.openTagPosition?.start.line ?? "unknown"} is missing the \`cite\` attribute. Must include a relative link to the ${messageNouns.noun} you\u2019re replying to.`,
                                        },
                                    );
                                }

                                const citeAttribute = parseAgentWebMessagingPageParentCiteAttribute(
                                    messageNouns,
                                    state.parent.openTagPosition,
                                    state.parent.citeAttribute,
                                );
                                const {authorLink, previewChildren} =
                                    takeAgentWebMessagingPageParentAuthorLinkFromChildren(
                                        messageNouns,
                                        state.parent.openTagPosition,
                                        state.parent.children,
                                    );

                                parent = runAllObjectPromises({
                                    citeAttribute,
                                    author: parseAccountLink(
                                        state.parent.openTagPosition,
                                        authorLink,
                                    ),
                                    previewContent: parseApiContentFromAgentWebMarkdownTree(
                                        storage,
                                        {type: "root", children: previewChildren},
                                    ),
                                });
                            }

                            const block: Replace<
                                AgentWebMessagingPageMessageBlock,
                                {
                                    author: Promise<ApiAccountTargetResponse>;
                                    content: Promise<ApiContentResponse>;
                                    parent: Promise<AgentWebMessagingPageMessageBlockParent> | null;
                                }
                            > = {
                                type: "Message",
                                idAttribute,
                                author: parseAccountLink(
                                    state.openTagPosition,
                                    state.fromAttribute,
                                ),
                                timeAttribute: state.timeAttribute,
                                timeZoneAttribute: state.timeZoneAttribute,
                                parent,
                                content: parseApiContentFromAgentWebMarkdownTree(storage, {
                                    type: "root",
                                    children: state.children,
                                }),
                            };

                            blockPromises.push(runAllObjectPromises(block));

                            state = null;
                            handledHtml ??= {tagName, tagType: "close"};
                            break;
                        }
                        case "blockquote": {
                            if (!state?.parent || state.parent.hasCloseTag) {
                                throw new InvalidArgumentError("Invalid parent element close tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t close \`</blockquote>\` element on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching \`<blockquote>\` open tag.`,
                                });
                            }

                            if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            state.parent.hasCloseTag = true;
                            handledHtml ??= {tagName, tagType: "close"};
                            break;
                        }
                        default: {
                            hasUnknownHtml = true;
                            break;
                        }
                    }
                },
                onselfclosingtag: () => {
                    hasUnknownHtml = true;
                },

                onattribname: (start, end) => {
                    if (state) {
                        const attributeName = node.value.slice(start, end).toLowerCase();

                        switch (attributeName) {
                            case "id": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "id";
                                    state.idAttribute = "";
                                }
                                break;
                            }
                            case "from": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "from";
                                    state.fromAttribute = "";
                                }
                                break;
                            }
                            case "time": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "time";
                                    state.timeAttribute = "";
                                }
                                break;
                            }
                            case "timezone": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "timezone";
                                    state.timeZoneAttribute = "";
                                }
                                break;
                            }
                            case "cite": {
                                if (state.parent && !state.parent.hasEndedOpenTag) {
                                    state.parent.startedAttribute = "cite";
                                    state.parent.citeAttribute = "";
                                }
                                break;
                            }
                        }
                    }
                },
                onattribdata: (start, end) => {
                    if (state) {
                        const attributeData = node.value.slice(start, end);

                        if (!state.hasEndedOpenTag) {
                            switch (state.startedAttribute) {
                                case "id": {
                                    state.idAttribute += attributeData;
                                    break;
                                }
                                case "from": {
                                    state.fromAttribute += attributeData;
                                    break;
                                }
                                case "time": {
                                    state.timeAttribute += attributeData;
                                    break;
                                }
                                case "timezone": {
                                    state.timeZoneAttribute += attributeData;
                                    break;
                                }
                            }
                        } else if (state.parent && !state.parent.hasEndedOpenTag) {
                            switch (state.parent.startedAttribute) {
                                case "cite": {
                                    state.parent.citeAttribute += attributeData;
                                    break;
                                }
                            }
                        }
                    }
                },
                onattribentity: codepoint => {
                    if (state) {
                        const attributeData = String.fromCodePoint(codepoint);

                        if (!state.hasEndedOpenTag) {
                            switch (state.startedAttribute) {
                                case "id": {
                                    state.idAttribute += attributeData;
                                    break;
                                }
                                case "from": {
                                    state.fromAttribute += attributeData;
                                    break;
                                }
                                case "time": {
                                    state.timeAttribute += attributeData;
                                    break;
                                }
                                case "timezone": {
                                    state.timeZoneAttribute += attributeData;
                                    break;
                                }
                            }
                        } else if (state.parent && !state.parent.hasEndedOpenTag) {
                            switch (state.parent.startedAttribute) {
                                case "cite": {
                                    state.parent.citeAttribute += attributeData;
                                    break;
                                }
                            }
                        }
                    }
                },
                onattribend: () => {
                    if (state) {
                        if (!state.hasEndedOpenTag && state.startedAttribute) {
                            state.startedAttribute = null;
                        } else if (
                            state.parent &&
                            !state.parent.hasEndedOpenTag &&
                            state.parent.startedAttribute
                        ) {
                            state.parent.startedAttribute = null;
                        }
                    }
                },

                ontext: start => {
                    hasUnknownHtml = true;
                    firstHtmlTextIndex ??= start;
                },
                ontextentity: start => {
                    hasUnknownHtml = true;
                    firstHtmlTextIndex ??= start;
                },

                oncdata: noop,
                oncomment: noop,
                ondeclaration: noop,
                onprocessinginstruction: noop,
                onend: noop,
            },
        );

        tokenizer.write(node.value);
        tokenizer.end();

        // TypeScript doesn't realize that `handledHtml` here could be assigned by the
        // callbacks above annoyingly.
        handledHtml = handledHtml as any;

        // If this tokenizer state machine handled our HTML then don't add it to state
        // children. If there was any unknown HTML then we throw an error since we won't
        // have handled that unknown HTML.
        if (handledHtml) {
            if (hasUnknownHtml) {
                if (typeof firstHtmlTextIndex !== "number") {
                    throw createUnexpectedMarkdownError(messageNouns, node.position);
                } else {
                    const {tagName, tagType} = handledHtml;
                    const tag = tagType === "open" ? `<${tagName}>` : `</${tagName}>`;

                    let line = node.position?.start.line;

                    if (typeof line === "number") {
                        for (let i = 0; i <= firstHtmlTextIndex; i++) {
                            if (node.value[i] === "\n") {
                                line++;
                            }
                        }
                    }

                    throw new InvalidArgumentError(
                        "Unexpected text in the same HTML Markdown node as an open or close tag",
                        {
                            displayMessage: errorDisplayMessage`Must add an empty new line between the \`${tag}\` ${tagType} tag and markdown text. Otherwise, due to a quirk in markdown, the text on line ${line ?? "unknown"} will be parsed as HTML instead of markdown. The \`<${tagName}>\` element must be formatted like this: \`<${tagName}>\\n\\n...\\n\\n</${tagName}>\`.`,
                        },
                    );
                }
            }
            return true;
        }

        return false;
    };

    for (let nodeIndex = 0; nodeIndex < root.children.length; nodeIndex++) {
        let node = root.children[nodeIndex]!;

        if (
            nodeIndex === root.children.length - 1 &&
            state === null &&
            isAgentWebMessagingPageEndOfMessagesParagraph(messageNouns, node)
        ) {
            isEndOfMessages = true;
            hasFinishedPreamble = true;
            continue;
        }

        if (node.type === "html" && parseHtml(node)) {
            hasFinishedPreamble = true;
            continue;
        }

        if (node.type === "paragraph") {
            const timeBlock: AgentWebMessagingPageTimeBlock | null = (() => {
                if (state) return null;

                if (node.children.length < 2) return null;

                const firstChildNode = node.children[0]!;
                const lastChildNode = node.children[node.children.length - 1]!;

                if (firstChildNode.type !== "html") return null;
                if (lastChildNode.type !== "html") return null;

                // The Markdown parsing library we use parses open and close HTML tags as separate
                // nodes even when they're adjacent to each other which is nice.
                if (!hasHtmlOpenTag(firstChildNode.value, tagName => tagName === "time"))
                    return null;
                if (!hasHtmlCloseTag(lastChildNode.value, tagName => tagName === "time"))
                    return null;

                const otherChildNodes = node.children.slice(1, -1);

                return {
                    type: "Time",
                    timeContent: printMarkdownPhrasingContentText(otherChildNodes),
                };
            })();

            if (timeBlock) {
                blockPromises.push(timeBlock);
                hasFinishedPreamble = true;
                continue;
            }

            let lastPushedIndex = 0;

            for (let index = 0; index < node.children.length; index++) {
                const childNode = node.children[index]!;
                if (childNode.type !== "html") continue;

                let childrenToPop: Array<Node> | undefined;

                // Pre-emptively try pushing a paragraph with everything except the HTML into our
                // state. If `parseHtml()` succeeds then the partial paragraph needs to be at the
                // end of our message content.
                if (lastPushedIndex < index) {
                    if (!hasFinishedPreamble) {
                        preamble.push({
                            type: "paragraph",
                            children: node.children.slice(lastPushedIndex, index),
                        });

                        childrenToPop = preamble;
                    } else {
                        if (!state || !state.hasEndedOpenTag || state.startedAttribute) {
                            throw createUnexpectedMarkdownError(messageNouns, node.position);
                        }

                        if (state.parent && !state.parent.hasCloseTag) {
                            if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            state.parent.children.push({
                                type: "paragraph",
                                children: node.children.slice(lastPushedIndex, index),
                            });

                            childrenToPop = state.parent.children;
                        } else {
                            state.children.push({
                                type: "paragraph",
                                children: node.children.slice(lastPushedIndex, index),
                            });

                            childrenToPop = state.children;
                        }
                    }
                }

                if (parseHtml(childNode)) {
                    lastPushedIndex = index + 1;
                    hasFinishedPreamble = true;
                    continue;
                }

                // `parseHtml()` didn't succeed. Let's clean up the pre-emptive paragraph we
                // pushed.
                childrenToPop?.pop();
            }

            if (lastPushedIndex > 0) {
                // The paragraph is now empty, skip.
                if (lastPushedIndex >= node.children.length) {
                    hasFinishedPreamble = true;
                    continue;
                }

                node = {
                    type: "paragraph",
                    children: node.children.slice(lastPushedIndex),
                };
            }
        }

        if (!hasFinishedPreamble) {
            preamble.push(node);
            continue;
        }

        // Annoyingly, TypeScript doesn't understand that `state` can be assigned inside
        // the `HtmlTokenizer` callbacks that run synchronously. This hack gets TypeScript
        // to treat `state` as possibly non-null.
        state = state as any;

        if (!state || !state.hasEndedOpenTag || state.startedAttribute) {
            throw createUnexpectedMarkdownError(messageNouns, node.position);
        }

        if (state.parent && !state.parent.hasCloseTag) {
            if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                throw createUnexpectedMarkdownError(messageNouns, node.position);
            }
            state.parent.children.push(node);
        } else {
            state.children.push(node);
        }
    }

    if (state) {
        throw new InvalidArgumentError("Missing message element close tag", {
            displayMessage: errorDisplayMessage`\`<${messageNouns.noun}>\` element on line ${state.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a \`</${messageNouns.noun}>\` closing tag and try again.`,
        });
    }

    const pagination = await takeAgentWebMessagingPagePaginationFromPreamble(
        messageNouns,
        storage,
        pageLink,
        preamble,
    );

    const preambleContent = await parseApiContentFromAgentWebMarkdownTree(storage, {
        type: "root",
        children: preamble,
    });

    let actualPreamble: ReadonlyArray<ApiContentInlineElementResponse> = [];

    if (preambleContent.elements.length === 0) {
        // noop
    } else if (
        preambleContent.elements.length === 1 &&
        preambleContent.elements[0]!.type === "Paragraph"
    ) {
        actualPreamble = preambleContent.elements[0].elements;
    } else {
        throw new InvalidArgumentError("Preamble isn\u2019t a single paragraph", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line 1. ${messageNouns.startOfSentencePluralNoun} markdown must be a list of \`<${messageNouns.noun}>\` elements. Though it may start with a single paragraph with a short description of what we\u2019re looking at.`,
        });
    }

    return {
        preamble: {elements: actualPreamble, pagination},
        isEndOfMessages,
    };
}

function isAgentWebMessagingPageEndOfMessagesParagraph(
    messageNouns: AgentWebMessagingPageNouns,
    node: RootContent,
): boolean {
    if (node.type !== "paragraph") return false;
    if (node.children.length !== 1) return false;

    const child = node.children[0]!;
    return child.type === "text" && child.value === `End of ${messageNouns.pluralNoun}.`;
}

function parseAgentWebMessagingPageParentCiteAttribute(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
    citeAttribute: string,
): AgentWebMessagingPageMessageBlockParent["citeAttribute"] {
    const searchParamName = messageNouns.noun;
    const createError = () =>
        new InvalidArgumentError("Invalid parent `cite` attribute", {
            displayMessage: errorDisplayMessage`Invalid \`<blockquote>\` \`cite\` attribute on line ${position?.start.line ?? "unknown"}. Expected \`cite\` to be a relative link like \`?${searchParamName}=42\` or \`?${searchParamName}=4-7\`. Try again with a valid \`cite\` attribute.`,
        });

    if (!citeAttribute.startsWith("?")) throw createError();

    const searchParams = new URLSearchParams(citeAttribute.slice(1));
    const value = searchParams.get(searchParamName);

    if (value === null || iterableSome(searchParams.keys(), key => key !== searchParamName)) {
        throw createError();
    }

    const integerPattern = "(0|[1-9][0-9]*)";
    const singleMessageIndexMatch = new RegExp(`^${integerPattern}$`).exec(value);

    if (singleMessageIndexMatch) {
        const messageIndex = parseInt(singleMessageIndexMatch[1]!, 10);
        return {startMessageIndex: messageIndex, endMessageIndex: messageIndex + 1};
    }

    const messageIndexRangeMatch = new RegExp(`^${integerPattern}-${integerPattern}$`).exec(value);

    if (messageIndexRangeMatch) {
        const startMessageIndex = parseInt(messageIndexRangeMatch[1]!, 10);
        const endMessageIndexInclusive = parseInt(messageIndexRangeMatch[2]!, 10);

        if (endMessageIndexInclusive >= startMessageIndex) {
            return {
                startMessageIndex,
                endMessageIndex: endMessageIndexInclusive + 1,
            };
        }
    }

    throw createError();
}

function takeAgentWebMessagingPageParentAuthorLinkFromChildren(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
    children: ReadonlyArray<RootContent>,
): {authorLink: string; previewChildren: Array<RootContent>} {
    const createError = () =>
        new InvalidArgumentError("Parent content is missing author prefix", {
            displayMessage: errorDisplayMessage`\`<blockquote>\` content on line ${position?.start.line ?? "unknown"} must start with a link to the ${messageNouns.noun} author followed by a colon. For example: \`[John](/human/john-doe): quoted text\`. Try again with a link to the ${messageNouns.noun} author.`,
        });

    const firstChild = children[0];
    if (firstChild?.type !== "paragraph") throw createError();

    const authorLinkNode = firstChild.children[0];
    const separatorNode = firstChild.children[1];

    if (authorLinkNode?.type !== "link") throw createError();
    if (separatorNode?.type !== "text" || !separatorNode.value.startsWith(":")) {
        throw createError();
    }

    const separatorValue = separatorNode.value.startsWith(": ")
        ? separatorNode.value.slice(2)
        : separatorNode.value.slice(1);
    const firstPreviewParagraphChildren: typeof firstChild.children = [
        ...(separatorValue.length > 0 ? [{...separatorNode, value: separatorValue}] : []),
        ...firstChild.children.slice(2),
    ];

    const authorLink = printMarkdownTree({
        type: "paragraph",
        children: [authorLinkNode],
    }).trim();

    if (firstPreviewParagraphChildren.length === 0) {
        if (children.length === 1 || children[1]?.type !== "paragraph") {
            return {authorLink, previewChildren: children.slice(1)};
        }
    }

    return {
        authorLink,
        previewChildren: [
            {...firstChild, children: firstPreviewParagraphChildren},
            ...children.slice(1),
        ],
    };
}

function parseAgentWebMessagingPageMessageBlockIdAttribute(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
    idAttribute: string | null,
): AgentWebMessagingPageMessageBlockIdAttribute | null {
    if (idAttribute === null) return null;

    const integerPattern = "(0|[1-9][0-9]*)";
    const singleMessageIndexMatch = new RegExp(`^${integerPattern}$`).exec(idAttribute);

    if (singleMessageIndexMatch) {
        const messageIndex = parseInt(singleMessageIndexMatch[1]!, 10);
        return {startMessageIndex: messageIndex, endMessageIndex: messageIndex + 1};
    }

    const messageIndexRangeMatch = new RegExp(`^${integerPattern}-${integerPattern}$`).exec(
        idAttribute,
    );

    if (messageIndexRangeMatch) {
        const startMessageIndex = parseInt(messageIndexRangeMatch[1]!, 10);
        const endMessageIndexInclusive = parseInt(messageIndexRangeMatch[2]!, 10);

        if (endMessageIndexInclusive >= startMessageIndex) {
            return {
                startMessageIndex,
                endMessageIndex: endMessageIndexInclusive + 1,
            };
        }
    }

    throw new InvalidArgumentError("Invalid message `id` attribute", {
        displayMessage: errorDisplayMessage`Invalid \`<${messageNouns.noun}>\` \`id\` attribute on line ${position?.start.line ?? "unknown"}. Expected \`id\` to be an integer like \`42\` or an integer range like \`4-7\`. Try again with a valid \`id\` attribute.`,
    });
}

function createUnexpectedMarkdownError(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
) {
    return new InvalidArgumentError("Unexpected markdown node type", {
        displayMessage: errorDisplayMessage`Unexpected markdown on line ${position?.start.line ?? "unknown"}. ${messageNouns.startOfSentencePluralNoun} markdown must be a list of \`<${messageNouns.noun}>\` elements.`,
    });
}

async function takeAgentWebMessagingPagePaginationFromPreamble<PageLink>(
    messageNouns: AgentWebMessagingPageNouns,
    storage: AgentWebSessionStorage,
    pageLink: PageLink | null,
    preamble: Array<RootContent>,
): Promise<AgentWebMessagingPageBasePreamblePagination | null> {
    const lastNode = preamble[preamble.length - 1];
    if (lastNode?.type !== "paragraph") return null;

    const lastChildIndex = lastNode.children.length - 1;
    const lastChild = lastNode.children[lastChildIndex];
    if (lastChild?.type !== "link") return null;

    const text = printMarkdownPhrasingContentText(lastChild.children);
    let previousPaginationLink: AgentWebMessagingPageParsedPaginationLink | null = null;
    let nextPaginationLink: AgentWebMessagingPageParsedPaginationLink | null = null;
    let removeStartIndex: number | null = null;

    // Not a pagination link.
    if (text !== previousPageLinkTextWithEndArrow && text !== nextPageLinkText) return null;

    // Pagination links always point to a route inside the Markdown web.
    if (/^[a-zA-Z0-9]+:/.test(lastChild.url)) return null;

    if (pageLink === null) {
        const quotedText = quoteMarkdown(lastChild.children);

        throw new InvalidArgumentError("Can\u2019t add pagination link to new messaging room", {
            displayMessage: errorDisplayMessage`Can\u2019t add ${quotedText} link when creating ${messageNouns.pluralNoun} markdown. Try again without the ${quotedText} link.`,
        });
    }

    if (text === previousPageLinkTextWithEndArrow) {
        previousPaginationLink = await parseAgentWebMessagingPagePaginationLink({
            messageNouns,
            storage,
            link: lastChild,
            searchParamName: "before",
        });

        removeStartIndex = lastChildIndex;
    } else {
        assert(text === nextPageLinkText);

        nextPaginationLink = await parseAgentWebMessagingPagePaginationLink({
            messageNouns,
            storage,
            link: lastChild,
            searchParamName: "after",
        });

        removeStartIndex = lastChildIndex;

        const separatorChild = lastNode.children[lastChildIndex - 1];
        const previousLinkChild = lastNode.children[lastChildIndex - 2];

        if (
            separatorChild?.type === "text" &&
            separatorChild.value === " | " &&
            previousLinkChild?.type === "link" &&
            printMarkdownPhrasingContentText(previousLinkChild.children) ===
                previousPageLinkTextWithStartArrow
        ) {
            previousPaginationLink = await parseAgentWebMessagingPagePaginationLink({
                messageNouns,
                storage,
                link: previousLinkChild,
                searchParamName: "before",
            });
            removeStartIndex = lastChildIndex - 2;
        }
    }

    assert(removeStartIndex !== null);

    if (
        previousPaginationLink &&
        nextPaginationLink &&
        !isDeepEqual(previousPaginationLink.target, nextPaginationLink.target)
    ) {
        throw new InvalidArgumentError("Pagination links point to different pages", {
            displayMessage: errorDisplayMessage`\u201D${previousPageLinkTextWithStartArrow}\u201D and \u201C${nextPageLinkText}\u201D links must link to the same page. \u201C${previousPageLinkTextWithStartArrow}\u201D links to \`${previousPaginationLink.pathname.slice(0, 75)}\` and \u201C${nextPageLinkText}\u201D links to \`${nextPaginationLink.pathname.slice(0, 75)}\`. Try again and make sure both links point to the same page (it\u2019s ok if the URL search params like \`?before\` and \`?after\` are different but the pathname must be the same).`,
        });
    }

    lastNode.children.splice(removeStartIndex);

    const previousChild = lastNode.children[lastNode.children.length - 1];
    if (previousChild?.type === "text" && previousChild.value.endsWith(" ")) {
        if (previousChild.value === " ") {
            lastNode.children.pop();
        } else {
            previousChild.value = previousChild.value.slice(0, -1);
        }
    }

    if (lastNode.children.length === 0) preamble.pop();

    if (previousPaginationLink) {
        return {
            target: previousPaginationLink.target,
            previousLink: {beforeMessageIndex: previousPaginationLink.messageIndex},
            nextLink: nextPaginationLink
                ? {afterMessageIndex: nextPaginationLink.messageIndex}
                : null,
        };
    }

    assert(nextPaginationLink !== null);

    return {
        target: nextPaginationLink.target,
        previousLink: null,
        nextLink: {afterMessageIndex: nextPaginationLink.messageIndex},
    };
}

type AgentWebMessagingPageParsedPaginationLink = {
    readonly pathname: string;
    readonly target: ApiMentionTargetResponse;
    readonly messageIndex: number;
};

async function parseAgentWebMessagingPagePaginationLink({
    messageNouns,
    storage,
    link,
    searchParamName,
}: {
    messageNouns: AgentWebMessagingPageNouns;
    storage: AgentWebSessionStorage;
    link: Link;
    searchParamName: "before" | "after";
}): Promise<AgentWebMessagingPageParsedPaginationLink> {
    const {pathname, searchParams} = normalizeAgentWebPath(link.url);
    const searchParam = searchParams.get(searchParamName);

    if (searchParam === null || !/^(0|[1-9][0-9]*)$/.test(searchParam)) {
        throw createInvalidAgentWebMessagingPagePaginationLinkUrlError({
            messageNouns,
            link,
            searchParamName,
        });
    }

    const paginationPageLinkResult = await getAgentWebPageLinkByPathname(storage, pathname);

    if (!paginationPageLinkResult) {
        throw createInvalidAgentWebMessagingPagePaginationLinkUrlError({
            messageNouns,
            link,
            searchParamName,
        });
    }

    const mentionTargetResult = createAgentWebPageLinkApiMentionTargetIfPossible(
        storage.spaceId,
        paginationPageLinkResult.pageLink,
    );

    if (mentionTargetResult.type !== "MentionTarget") {
        throw createInvalidAgentWebMessagingPagePaginationLinkUrlError({
            messageNouns,
            link,
            searchParamName,
        });
    }

    return {
        pathname,
        target: mentionTargetResult.target,
        messageIndex: parseInt(searchParam, 10),
    };
}

function createInvalidAgentWebMessagingPagePaginationLinkUrlError({
    messageNouns,
    link,
    searchParamName,
}: {
    messageNouns: AgentWebMessagingPageNouns;
    link: Link;
    searchParamName: "before" | "after";
}) {
    const quotedText = quoteMarkdown(link.children);

    return new InvalidArgumentError("Invalid pagination link URL", {
        displayMessage: errorDisplayMessage`Invalid link for ${quotedText}. Expected a link to more ${messageNouns.pluralNoun} with a \`${searchParamName}\` URL search param. Example: \`/chat/my-chat?${searchParamName}=8\`. Try again with a different link.`,
    });
}
