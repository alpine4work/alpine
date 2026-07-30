import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {differenceInMinutes} from "date-fns";
import {getApiMessagesFromEnd, getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageCustomBlockBase,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageNouns,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPagePaginationPageLink,
    AgentWebMessagingPageWithMetadata,
    parseAgentWebMessagingPageMessageIndex,
    parseAgentWebMessagingPageMessageIndexRange,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {
    truncateAgentWebMessagingPage,
    truncateAgentWebMessagingPageAroundMessage,
} from "~/server/agents/web/pages/messaging/truncate_agent_web_messaging_page.js";
import {unzipKeysFromApiContentResponse} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentBlockElementResponseWithoutKeys,
    ApiContentFileGalleryBlockElementRowItemResponseWithoutKeys,
    ApiContentInlineElementResponse,
    ApiContentResponseWithoutKeys,
    ApiMessageContentPayloadFileResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
    ApiMessageRoomReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InvalidArgumentError, NotFoundError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export const agentWebMessagingPageApiMessagesBatchCount = 30;

export async function readAgentWebMessagingPage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
>(
    context: AgentWebContext,
    {
        messageNouns,
        room,
        getRoomMetadata,
        defaultDirection,
        searchParams,
        limitLength,
        printPage,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        room: ApiMessageRoomReference;
        // May be called multiple times! If we need to load more messages because we
        // haven't filled the limit yet.
        getRoomMetadata: (options: {
            isStartOfMessages: boolean;
            isEndOfMessages: boolean;
        }) => Promise<{
            pageLink: AgentWebMessagingPagePaginationPageLink;
            preamble: Preamble;
            startCustomBlock: {
                time: Date;
                block: CustomBlock;
            } | null;
        }>;
        defaultDirection: "Start" | "End";
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebMessagingPage<Preamble, CustomBlock>) => Promise<string>;
    },
): Promise<{
    response: string;
    metadata: AgentWebMessagingPageMetadata;
}> {
    const parsedSearchParams = parseAgentWebMessagingPageSearchParams({
        messageNouns,
        defaultDirection,
        searchParams,
    });

    switch (parsedSearchParams.type) {
        case "Direction": {
            return await readAgentWebMessagingPageInDirection(context, {
                messageNouns,
                room,
                getRoomMetadata,
                direction: parsedSearchParams.direction,
                startCursor: parsedSearchParams.startCursor,
                untilCursor: parsedSearchParams.untilCursor,
                limitLength,
                printPage,
            });
        }
        case "Around": {
            return await readAgentWebMessagingPageAroundMessage(context, {
                messageNouns,
                room,
                getRoomMetadata,
                around: parsedSearchParams.around,
                limitLength,
                printPage,
            });
        }
        default:
            throw exhaustive(parsedSearchParams);
    }
}

export type AgentWebMessagingPageSearchParams =
    | {
          readonly type: "Direction";
          readonly direction: "Start" | "End";
          readonly startCursor: number | null;
          readonly untilCursor: number | null;
      }
    | {
          readonly type: "Around";
          readonly around: AgentWebMessagingPageMessageRange;
      };

export function parseAgentWebMessagingPageSearchParams({
    messageNouns,
    defaultDirection,
    searchParams,
}: {
    messageNouns: AgentWebMessagingPageNouns;
    defaultDirection: "Start" | "End";
    searchParams: URLSearchParams;
}): AgentWebMessagingPageSearchParams {
    const beforeMessageIndexSearchParam = searchParams.get("before");
    const afterMessageIndexSearchParam = searchParams.get("after");
    const aroundMessageRangeSearchParam = searchParams.get(messageNouns.noun);
    const startSearchParam = searchParams.get("start");
    const endSearchParam = searchParams.get("end");
    const fromSearchParam = searchParams.get("from");

    let beforeMessageIndex: number | null = null;
    let afterMessageIndex: number | null = null;
    let around: AgentWebMessagingPageMessageRange | null = null;

    if (beforeMessageIndexSearchParam !== null) {
        beforeMessageIndex = parseAgentWebMessagingPageMessageIndex(beforeMessageIndexSearchParam);

        if (beforeMessageIndex === null) {
            throw new InvalidArgumentError("Expected `before` search param to be an integer", {
                displayMessage: errorDisplayMessage`Expected \`?before\` URL search param to be an integer, but got ${quote(beforeMessageIndexSearchParam)}. Try again with an integer or try omitting \`?before\`. We recommend using a value for \`?before\` from a ${quote(`<${messageNouns.noun}>`)}\u2019s \`id\` attribute.`,
            });
        }
    }

    if (afterMessageIndexSearchParam !== null) {
        afterMessageIndex = parseAgentWebMessagingPageMessageIndex(afterMessageIndexSearchParam);

        if (afterMessageIndex === null) {
            throw new InvalidArgumentError("Expected `after` search param to be an integer", {
                displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be an integer, but got ${quote(afterMessageIndexSearchParam)}. Try again with an integer or try omitting \`?after\`. We recommend using a value for \`?after\` from a ${quote(`<${messageNouns.noun}>`)}\u2019s \`id\` attribute.`,
            });
        }
    }

    if (aroundMessageRangeSearchParam !== null) {
        around = parseAgentWebMessagingPageMessageIndexRange(aroundMessageRangeSearchParam);

        if (around === null) {
            throw new InvalidArgumentError(
                `Expected \`${messageNouns.noun}\` search param to be an integer or range`,
                {
                    displayMessage: errorDisplayMessage`Expected ${quote(`?${messageNouns.noun}`)} URL search param to be an integer or integer range, but got ${quote(aroundMessageRangeSearchParam)}. Try again with an integer, an integer range, or try omitting ${quote(`?${messageNouns.noun}`)}. We recommend using a value for ${quote(`?${messageNouns.noun}`)} from a ${quote(`<${messageNouns.noun}>`)}\u2019s \`id\` attribute.`,
                },
            );
        }
    }

    if (startSearchParam !== null && startSearchParam !== "") {
        throw new InvalidArgumentError("Expected `start` search param to be empty", {
            displayMessage: errorDisplayMessage`Expected \`?start\` URL search param to not have a value, but got ${quote(startSearchParam)}. Try again without a value (no \`?start=...\`, just \`?start\`).`,
        });
    }

    if (endSearchParam !== null && endSearchParam !== "") {
        throw new InvalidArgumentError("Expected `end` search param to be empty", {
            displayMessage: errorDisplayMessage`Expected \`?end\` URL search param to not have a value, but got ${quote(endSearchParam)}. Try again without a value (no \`?end=...\`, just \`?end\`).`,
        });
    }

    if (fromSearchParam !== null && fromSearchParam !== "start" && fromSearchParam !== "end") {
        throw new InvalidArgumentError("Expected `from` search param to be `start` or `end`", {
            displayMessage: errorDisplayMessage`Expected \`?from\` URL search param to be either \`start\` or \`end\`, but got ${quote(fromSearchParam)}. Try again with \`?from=start\`, \`?from=end\`, or try omitting \`?from\`.`,
        });
    }

    let searchParamCount = 0;
    if (beforeMessageIndex !== null || afterMessageIndex !== null || fromSearchParam !== null) {
        searchParamCount++;
    }
    if (around !== null) searchParamCount++;
    if (startSearchParam !== null) searchParamCount++;
    if (endSearchParam !== null) searchParamCount++;

    if (searchParamCount > 1) {
        throw new InvalidArgumentError("Expected only one pagination search param", {
            displayMessage: errorDisplayMessage`Expected only one of \`?before\`, \`?after\`, ${quote(`?${messageNouns.noun}`)}, \`?start\`, or \`?end\` URL search params. Try again with only one of \`?before\`, \`?after\`, ${quote(`?${messageNouns.noun}`)}, \`?start\`, or \`?end\`. We recommend using a value for \`?before\`, \`?after\`, or ${quote(`?${messageNouns.noun}`)} from a ${quote(`<${messageNouns.noun}>`)}\u2019s \`id\` attribute. (You may use \`?before\` and \`?after\` together as long as you provide \`?from=start\` or \`?from=end\` as well.)`,
        });
    }

    // If the agent passes in a specific message/comment link then we have a different
    // code path for reading messages around some index. Bail and call that code path.
    if (around !== null) {
        return {type: "Around", around};
    }

    if (beforeMessageIndex !== null && afterMessageIndex !== null) {
        if (fromSearchParam === null) {
            throw new InvalidArgumentError("Expected `from` search param for a message range", {
                displayMessage: errorDisplayMessage`Expected a \`?from\` URL search param when both \`?before\` and \`?after\` are present. Try again with either \`?from=start\` or \`?from=end\`.`,
            });
        }

        if (beforeMessageIndex <= afterMessageIndex) {
            throw new InvalidArgumentError(
                "Expected `before` search param to be after `after` search param",
                {
                    displayMessage: errorDisplayMessage`Expected the \`?before\` URL search param to be after the \`?after\` URL search param. Try again and flip the values in \`?before\` and \`?after\` (and make sure they have different values).`,
                },
            );
        }
    }

    if (beforeMessageIndex !== null && afterMessageIndex === null && fromSearchParam === "start") {
        throw new InvalidArgumentError("Expected `from=end` with only `before`", {
            displayMessage: errorDisplayMessage`Expected \`?from=end\` when the \`?before\` URL search param is present without \`?after\`. Try again with \`?from=end\` or try omitting \`?from\`.`,
        });
    }

    if (afterMessageIndex !== null && beforeMessageIndex === null && fromSearchParam === "end") {
        throw new InvalidArgumentError("Expected `from=start` with only `after`", {
            displayMessage: errorDisplayMessage`Expected \`?from=start\` when the \`?after\` URL search param is present without \`?before\`. Try again with \`?from=start\` or try omitting \`?from\`.`,
        });
    }

    if (beforeMessageIndex === null && afterMessageIndex === null && fromSearchParam !== null) {
        throw new InvalidArgumentError("Expected `before` or `after` with `from`", {
            displayMessage: errorDisplayMessage`Expected a \`?before\` or an \`?after\` URL search param when \`?from\` is present. Try again with a \`?before\` or \`?after\` URL search param, or try omitting \`?from\`.`,
        });
    }

    const direction: "Start" | "End" =
        fromSearchParam === "start"
            ? "Start"
            : fromSearchParam === "end"
              ? "End"
              : afterMessageIndex !== null || startSearchParam !== null
                ? "Start"
                : beforeMessageIndex !== null || endSearchParam !== null
                  ? "End"
                  : defaultDirection;

    return {
        type: "Direction",
        direction,
        startCursor: direction === "Start" ? afterMessageIndex : beforeMessageIndex,
        untilCursor: direction === "Start" ? beforeMessageIndex : afterMessageIndex,
    };
}

export async function readAgentWebMessagingPageInDirection<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    context: AgentWebContext,
    {
        messageNouns,
        room,
        getRoomMetadata,
        direction,
        startCursor,
        untilCursor,
        limitLength,
        additionalTruncateLength = 0,
        printPage,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        room: ApiMessageRoomReference;
        // May be called multiple times! If we need to load more messages because we
        // haven't filled the limit yet.
        getRoomMetadata: (options: {
            isStartOfMessages: boolean;
            isEndOfMessages: boolean;
        }) => Promise<{
            pageLink: AgentWebMessagingPagePaginationPageLink;
            preamble: Preamble;
            startCustomBlock: {
                time: Date | null;
                block: CustomBlock;
            } | null;
        }>;
        direction: "Start" | "End";
        startCursor: number | null;
        untilCursor: number | null;
        limitLength: number;
        additionalTruncateLength?: number;
        printPage: (page: AgentWebMessagingPage<Preamble, CustomBlock>) => Promise<string>;
    },
): Promise<{
    response: string;
    metadata: AgentWebMessagingPageMetadata;
}> {
    let cursor = startCursor;
    let messages: Array<ApiMessageResponse> = [];

    while (true) {
        const remainingRangeMessageCount =
            untilCursor === null
                ? agentWebMessagingPageApiMessagesBatchCount
                : direction === "Start"
                  ? untilCursor - Math.max(0, assertExists(cursor) + 1)
                  : assertExists(cursor) - Math.max(0, untilCursor + 1);

        const apiMessagesLimit = Math.min(
            agentWebMessagingPageApiMessagesBatchCount,
            remainingRangeMessageCount,
        );
        assert(apiMessagesLimit > 0);

        const {
            data: {nextCursor, messages: apiMessages, totalMessageCount},
        } =
            direction === "Start"
                ? await getApiMessagesFromStart(context.span, context.api, room, {
                      limit: apiMessagesLimit,
                      cursor,
                  })
                : await getApiMessagesFromEnd(context.span, context.api, room, {
                      limit: apiMessagesLimit,
                      cursor,
                  });

        // The limit is enough to enforce the range when both cursors are in the room.
        // Filter as well so a cursor beyond the end of the room can't pull messages from
        // outside the requested range when the API clamps it to the room's message count.
        const currentMessages =
            untilCursor === null
                ? apiMessages
                : apiMessages.filter(message =>
                      direction === "Start"
                          ? message.index < untilCursor
                          : message.index > untilCursor,
                  );

        const reachedUntilCursor =
            untilCursor !== null &&
            (direction === "Start"
                ? currentMessages[currentMessages.length - 1]?.index === untilCursor - 1
                : currentMessages[0]?.index === untilCursor + 1 ||
                  untilCursor >= totalMessageCount - 1);

        cursor = reachedUntilCursor ? null : nextCursor;

        // Add messages in the right order.
        if (direction === "Start") {
            for (const message of currentMessages) messages.push(message);
        } else {
            messages = [...currentMessages, ...messages];
        }

        const isStartOfMessages =
            direction === "End"
                ? cursor === null && (untilCursor === null || untilCursor < 0)
                : startCursor === null ||
                  // Edge case where there are 5 messages but cursor is set to something crazy like
                  // -20.
                  (messages.length > 0 && messages[0]!.index !== startCursor + 1);

        const isEndOfMessages =
            direction === "Start"
                ? cursor === null && (untilCursor === null || untilCursor >= totalMessageCount)
                : startCursor === null ||
                  // Edge case where there are 5 messages but cursor is set to something crazy
                  // like 100.
                  (messages.length > 0 && messages[messages.length - 1]!.index !== startCursor - 1);

        // Await the room metadata after we've fetched all our messages. We should have
        // been loading the room metadata in parallel.
        const roomMetadata = await getRoomMetadata({isStartOfMessages, isEndOfMessages});

        const {contextDate, contextFormattedTimeZone, page} =
            buildAgentWebMessagingPageFromApiMessages(context, {
                direction,
                roomMetadata,
                messages,
                hasMoreMessagesInDirection: cursor !== null,
                isStartOfMessages,
                isEndOfMessages,
            });

        const response = await printPage(page);

        // If there's more messages and we haven't exceeded the limit then continue loading
        // messages.
        if (cursor !== null && response.length < limitLength) continue;

        // If the response is within the limit, return it! No truncation needed.
        if (response.length <= limitLength) return {response, metadata: page.metadata};

        // Truncate the response to fit within the limit length. This function is carefully
        // written such that we return a string that can be parsed back into a valid
        // messaging page.
        const result = await truncateAgentWebMessagingPage(context.storage, {
            messageNouns,
            limitLength,
            additionalTruncateLength,
            roomMetadataPageLink: roomMetadata.pageLink,
            direction,
            isStartOfMessages,
            isEndOfMessages,
            messages,
            contextTimeZone: context.timeZone,
            contextDate,
            contextFormattedTimeZone,
            page,
            response,
        });

        if (result === null) return {response, metadata: page.metadata};
        return {response: result.truncatedResponse, metadata: result.truncatedMetadata};
    }
}

export function getReadAgentWebMessagingPageAroundMessageStartCursor(
    around: AgentWebMessagingPageMessageRange,
) {
    return (
        around.startMessageIndex -
        Math.floor(
            (agentWebMessagingPageApiMessagesBatchCount -
                (around.endMessageIndex - around.startMessageIndex)) /
                2,
        ) -
        1
    );
}

export async function readAgentWebMessagingPageAroundMessage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
>(
    context: AgentWebContext,
    {
        messageNouns,
        room,
        getRoomMetadata,
        around,
        limitLength,
        additionalTruncateLength = 0,
        printPage,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        room: ApiMessageRoomReference;
        // May be called multiple times! If we need to load more messages because we
        // haven't filled the limit yet.
        getRoomMetadata: (options: {
            isStartOfMessages: boolean;
            isEndOfMessages: boolean;
        }) => Promise<{
            pageLink: AgentWebMessagingPagePaginationPageLink;
            preamble: Preamble;
            startCustomBlock: {
                time: Date | null;
                block: CustomBlock;
            } | null;
        }>;
        around: AgentWebMessagingPageMessageRange;
        limitLength: number;
        additionalTruncateLength?: number;
        printPage: (
            page: AgentWebMessagingPageWithMetadata<Preamble, CustomBlock>,
        ) => Promise<string>;
    },
): Promise<{
    response: string;
    metadata: AgentWebMessagingPageMetadata;
}> {
    assert(around.endMessageIndex > around.startMessageIndex);

    assert(Number.isInteger(around.startMessageIndex));
    assert(Number.isInteger(around.endMessageIndex));

    const {
        data: {messages: initialMessages, totalMessageCount, nextCursor: initialNextCursor},
    } = await getApiMessagesFromStart(context.span, context.api, room, {
        limit: agentWebMessagingPageApiMessagesBatchCount,
        cursor: getReadAgentWebMessagingPageAroundMessageStartCursor(around),
    });

    if (initialMessages.length === 0) {
        const {pageLink, preamble} = await getRoomMetadata({
            isStartOfMessages: true,
            isEndOfMessages: true,
        });

        const metadata: AgentWebMessagingPageMetadata = {
            isStartOfMessages: true,
            isEndOfMessages: true,
            messages: [],
        };

        return {
            response: await printPage({
                preamble,
                pagination: {
                    pageLink,
                    nextLink: null,
                    previousLink: {type: "Message", beforeMessageIndex: totalMessageCount},
                },
                isEndOfMessages: true,
                blocks: [],
                metadata,
            }),
            metadata,
        };
    }

    if (
        !initialMessages.some(
            message =>
                message.index >= around.startMessageIndex && message.index < around.endMessageIndex,
        )
    ) {
        const aroundMessageIndexRange =
            around.startMessageIndex === around.endMessageIndex - 1
                ? String(around.startMessageIndex)
                : `${around.startMessageIndex}-${around.endMessageIndex - 1}`;

        throw new NotFoundError("No messages found in around range", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find any ${messageNouns.pluralNoun} in the requested range ${quote(aroundMessageIndexRange)}. Try again with a \`<${messageNouns.noun}>\` \`id\` attribute you\u2019ve seen before.`,
        });
    }

    let beforeCursor = initialMessages[0]!.index !== 0 ? initialMessages[0]!.index : null;
    let afterCursor = initialNextCursor;
    let messages: ReadonlyArray<ApiMessageResponse> = initialMessages;

    while (true) {
        const isStartOfMessages = beforeCursor === null;
        const isEndOfMessages = afterCursor === null;

        // Await the room metadata after we've fetched all our messages. We should have
        // been loading the room metadata in parallel.
        const roomMetadata = await getRoomMetadata({isStartOfMessages, isEndOfMessages});

        const {contextDate, contextFormattedTimeZone, page} =
            buildAgentWebMessagingPageFromApiMessages(context, {
                direction: "Around",
                roomMetadata,
                messages,
                isStartOfMessages,
                isEndOfMessages,
            });

        const response = await printPage(page);

        // If there's no more messages or we've exceeded the limit then stop loading
        // messages and return the page we have.
        if ((beforeCursor === null && afterCursor === null) || response.length >= limitLength) {
            // If the response is within the limit, return it! No truncation needed.
            if (response.length <= limitLength) return {response, metadata: page.metadata};

            // Truncate the response to fit within the limit length. This function is carefully
            // written such that we return a string that can be parsed back into a valid
            // messaging page.
            const result = await truncateAgentWebMessagingPageAroundMessage(context.storage, {
                messageNouns,
                limitLength,
                additionalTruncateLength,
                roomMetadataPageLink: roomMetadata.pageLink,
                around,
                isStartOfMessages,
                isEndOfMessages,
                messages,
                contextTimeZone: context.timeZone,
                contextDate,
                contextFormattedTimeZone,
                page,
                response,
            });

            if (result === null) return {response, metadata: page.metadata};
            return {response: result.truncatedResponse, metadata: result.truncatedMetadata};
        }

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

        messages = [...currentBeforeMessages, ...messages, ...currentAfterMessages];
    }
}

function buildAgentWebMessagingPageFromApiMessages<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    context: AgentWebContext,
    {
        direction,
        roomMetadata,
        messages,
        hasMoreMessagesInDirection,
        isStartOfMessages,
        isEndOfMessages,
    }: {
        direction: "Start" | "End" | "Around";
        roomMetadata: {
            pageLink: AgentWebMessagingPagePaginationPageLink;
            preamble: Preamble;
            startCustomBlock: {
                time: Date | null;
                block: CustomBlock;
            } | null;
        };
        messages: ReadonlyArray<ApiMessageResponse>;
        hasMoreMessagesInDirection?: boolean;
        isStartOfMessages: boolean;
        isEndOfMessages: boolean;
    },
): {
    contextTime: Date;
    contextDate: CalendarDate;
    contextFormattedTimeZone: string;
    page: AgentWebMessagingPageWithMetadata<Preamble, CustomBlock>;
} {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));
    const contextFormattedTimeZone = formatTimeZoneAbbreviation(context.timeZone, contextTime);

    const blocks: Array<AgentWebMessagingPageBlock<CustomBlock>> = [];
    const unzippedMessageKeys: Array<ReadonlyArray<ApiContentKey>> = [];

    let currentBlock: {
        authorId: AccountId;
        formattedTimeZone: string;
        firstCreatedTime: Date;
        lastCreatedTime: Date;
        differenceInMinutesSinceLastMessage: number;
        hasFiles: boolean;
        isDeleted: boolean;
        messages: Array<ApiMessageResponse>;
    } | null = null;

    const continueBlockBeforeMinutesSinceLastMessage = 5;
    const insertTimeBlockAfterMinutesSinceLastMessage = 60;

    if (isStartOfMessages && roomMetadata.startCustomBlock !== null) {
        if (roomMetadata.startCustomBlock.time !== null) {
            const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                defaultLocale,
                context.timeZone,
                contextDate,
                roomMetadata.startCustomBlock.time,
                {withLongMonth: true},
            );

            blocks.push({
                type: "Time",
                timeContent: `${formattedTime} ${contextFormattedTimeZone}`,
            });
        }

        blocks.push(roomMetadata.startCustomBlock.block);
    }

    for (const message of messages) {
        const createdTime = deserializeDateString(message.createdTime);
        const formattedTimeZone = formatTimeZoneAbbreviation(message.createdTimeZone, createdTime);

        const differenceInMinutesSinceLastMessage: number =
            message.index === 0 &&
            roomMetadata.startCustomBlock !== null &&
            roomMetadata.startCustomBlock.time !== null
                ? // If this is the first page of messages then get the difference in messages
                  // between this message and the start block.
                  differenceInMinutes(createdTime, roomMetadata.startCustomBlock.time)
                : currentBlock !== null
                  ? differenceInMinutes(createdTime, currentBlock.lastCreatedTime)
                  : // In this case we're the first message after a custom block. In this case, we
                    // don't want to attempt any kind of merging with the previous block. The main
                    // place we observe this is the first comment in a document comment thread after
                    // the `<blockquote>`. We want to add `<time>` after the `<blockquote>` which does
                    // not include the time.
                    Infinity;

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
            differenceInMinutesSinceLastMessage < continueBlockBeforeMinutesSinceLastMessage &&
            // Don't merge if the previous message block had files. This mirrors the UI, where
            // file attachments always render their own message header.
            !currentBlock.hasFiles &&
            // Only merge adjacent deleted messages or adjacent not-deleted messages.
            currentBlock.isDeleted === (message.payload.type === "Deleted") &&
            // Never merge the current bot's messages. This makes it easier when we need to
            // update the current bot's message content.
            message.author.id !== context.botAccount.id &&
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
            currentBlock.hasFiles ||=
                message.payload.type === "Content" && message.payload.files.length > 0;
            continue;
        }

        // Flush the previous block before starting a new one
        flushCurrentBlock();

        // Inject time tag if needed
        if (
            blocks.length === 0 ||
            differenceInMinutesSinceLastMessage >= insertTimeBlockAfterMinutesSinceLastMessage
        ) {
            const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                defaultLocale,
                context.timeZone,
                contextDate,
                createdTime,
                {withLongMonth: true},
            );

            blocks.push({
                type: "Time",
                timeContent: `${formattedTime} ${contextFormattedTimeZone}`,
            });
        }

        currentBlock = {
            authorId: message.author.id,
            formattedTimeZone,
            firstCreatedTime: createdTime,
            lastCreatedTime: createdTime,
            differenceInMinutesSinceLastMessage,
            hasFiles: message.payload.type === "Content" && message.payload.files.length > 0,
            isDeleted: message.payload.type === "Deleted",
            messages: [message],
        };
    }

    // Flush any remaining block
    flushCurrentBlock();

    let pagination: AgentWebMessagingPagePagination<CustomBlock> | null = null;

    if (messages.length > 0) {
        switch (direction) {
            case "Start": {
                if (hasMoreMessagesInDirection) {
                    pagination = {
                        pageLink: roomMetadata.pageLink,
                        previousLink: null,
                        nextLink: {
                            type: "Message",
                            afterMessageIndex: messages[messages.length - 1]!.index,
                        },
                    };
                }
                break;
            }
            case "End": {
                if (hasMoreMessagesInDirection) {
                    pagination = {
                        pageLink: roomMetadata.pageLink,
                        previousLink: {
                            type: "Message",
                            beforeMessageIndex: messages[0]!.index,
                        },
                        nextLink: null,
                    };
                }
                break;
            }
            case "Around": {
                if (!isEndOfMessages && !isStartOfMessages) {
                    pagination = {
                        pageLink: roomMetadata.pageLink,
                        previousLink: {
                            type: "Message",
                            beforeMessageIndex: messages[0]!.index,
                        },
                        nextLink: {
                            type: "Message",
                            afterMessageIndex: messages[messages.length - 1]!.index,
                        },
                    };
                } else if (!isEndOfMessages) {
                    pagination = {
                        pageLink: roomMetadata.pageLink,
                        previousLink: null,
                        nextLink: {
                            type: "Message",
                            afterMessageIndex: messages[messages.length - 1]!.index,
                        },
                    };
                } else if (!isStartOfMessages) {
                    pagination = {
                        pageLink: roomMetadata.pageLink,
                        previousLink: {
                            type: "Message",
                            beforeMessageIndex: messages[0]!.index,
                        },
                        nextLink: null,
                    };
                }
                break;
            }
            default:
                throw exhaustive(direction);
        }
    }

    return {
        contextTime,
        contextDate,
        contextFormattedTimeZone,
        page: {
            preamble: roomMetadata.preamble,
            pagination,
            isEndOfMessages,
            blocks,
            metadata: {
                isStartOfMessages,
                isEndOfMessages,
                messages: messages.map((message, index) => {
                    const keys = assertExists(unzippedMessageKeys[index]);
                    return {index: message.index, keys};
                }),
            },
        },
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
            currentBlock.differenceInMinutesSinceLastMessage >=
                continueBlockBeforeMinutesSinceLastMessage &&
            currentBlock.differenceInMinutesSinceLastMessage <
                insertTimeBlockAfterMinutesSinceLastMessage
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
            !firstMessage.author.bot?.id &&
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
                        // TODO(calebmer): Ideally we have a proper `match` attribute for messages on read
                        // to match the one agents add on write. However, implementing that properly is a
                        // little complex so choosing to not to implement right now. But we should
                        // implement eventually for symmetry between the read and write format.
                        matchAttribute: null,
                        author: intoApiAccountReference(messageParent.author),
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

        const elements: Array<ApiContentBlockElementResponseWithoutKeys> = [];

        for (const message of currentBlock.messages) {
            switch (message.payload.type) {
                case "Deleted": {
                    unzippedMessageKeys.push([]);
                    break;
                }
                case "Content": {
                    const {content, keys} = unzipKeysFromApiContentResponse(
                        message.payload.content,
                    );

                    unzippedMessageKeys.push(keys);

                    for (const element of content.elements) {
                        elements.push(element);
                    }

                    for (const element of convertApiMessageFilesToElements(message.payload.files)) {
                        elements.push(element);
                    }
                    break;
                }
                default:
                    throw exhaustive(message.payload);
            }
        }

        const blockBase = {
            type: "Message",
            idAttribute: {
                startMessageIndex: firstMessage.index,
                endMessageIndex: lastMessage.index + 1,
            },
            author: intoApiAccountReference(firstMessage.author),
            timeAttribute,
            timeZoneAttribute,
        } as const;

        if (currentBlock.isDeleted) {
            assert(parent === null);
            assert(elements.length === 0);

            blocks.push({
                ...blockBase,
                deletedAttribute: true,
                parent: null,
                content: {elements: []},
            });
        } else {
            blocks.push({
                ...blockBase,
                deletedAttribute: null,
                parent,
                content: {elements},
            });
        }

        currentBlock = null;
    }
}

function convertApiMessageContentPayloadParentContentSnippetToContent(
    parent: ApiMessageContentPayloadParentContentSnippet,
): ApiContentResponseWithoutKeys {
    const elements: ReadonlyArray<ApiContentInlineElementResponse> = !parent.isTruncated
        ? parent.elements
        : [...parent.elements, {type: "Text", text: " […]"}];

    return {elements: [{type: "Paragraph", elements}]};
}

function convertApiMessageFilesToElements(
    files: ReadonlyArray<ApiMessageContentPayloadFileResponse>,
): ReadonlyArray<ApiContentBlockElementResponseWithoutKeys> {
    if (files.length === 0) return [];

    const rows = new DefaultMap<
        number,
        Array<ApiContentFileGalleryBlockElementRowItemResponseWithoutKeys>
    >(() => []);

    for (const file of files) {
        rows.getOrSetDefault(file.rowIndex).push({width: file.width, element: file.element});
    }

    const sortedRows = Array.from(rows.entries())
        .sort(([rowIndex1], [rowIndex2]) => rowIndex1 - rowIndex2)
        .map(([, items]) => ({items}));

    return [{type: "FileGallery", rows: sortedRows}];
}
