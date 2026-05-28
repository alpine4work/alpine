import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {differenceInMinutes} from "date-fns";
import {getApiMessagesFromEnd, getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageNouns,
    AgentWebMessagingPagePreamblePagination,
    AgentWebMessagingPageWithMetadata,
    parseAgentWebMessagingPageMessageIndexRange,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {truncateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/truncate_agent_web_messaging_page.js";
import {intoApiAccountTarget} from "~/shared/api/specification/into_api_account_target.js";
import {
    ApiContentBlockElementResponse,
    ApiContentInlineElementResponse,
    ApiContentResponse,
    ApiMentionTargetResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
    ApiMessageRoomTarget,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const agentWebMessagingPageApiMessagesBatchCount = 30;

export async function readAgentWebMessagingPage(
    messageNouns: AgentWebMessagingPageNouns,
    context: AgentWebContextWithoutStorage,
    {
        room,
        roomMetadataPromise,
        defaultDirection,
        searchParams,
        limitLength,
        printPage,
        createPageLinkPathname,
    }: {
        room: ApiMessageRoomTarget;
        roomMetadataPromise: Promise<{
            target: ApiMentionTargetResponse;
            description: ReadonlyArray<ApiContentInlineElementResponse>;
        }>;
        defaultDirection: "Start" | "End";
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebMessagingPageWithMetadata) => Promise<string>;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{
    response: string;
    metadata: AgentWebMessagingPageMetadata;
}> {
    // Ignore any errors thrown by this promise. Don't crash the process.
    roomMetadataPromise.catch(() => {});

    const beforeMessageIndexSearchParam = searchParams.get("before");
    const afterMessageIndexSearchParam = searchParams.get("after");
    const aroundMessageRangeSearchParam = searchParams.get(messageNouns.noun);
    const startSearchParam = searchParams.get("start");
    const endSearchParam = searchParams.get("end");

    let beforeMessageIndex: number | null = null;
    let afterMessageIndex: number | null = null;
    let around: AgentWebMessagingPageMessageRange | null = null;

    if (beforeMessageIndexSearchParam !== null) {
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

    if (afterMessageIndexSearchParam !== null) {
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

    if (aroundMessageRangeSearchParam !== null) {
        around = parseAgentWebMessagingPageMessageIndexRange(aroundMessageRangeSearchParam);

        if (around === null) {
            throw new InvalidArgumentError(
                `Expected \`${messageNouns.noun}\` search param to be a positive integer or range`,
                {
                    displayMessage: errorDisplayMessage`Expected \`?${messageNouns.noun}\` URL search param to be a positive integer or integer range, but got \`${aroundMessageRangeSearchParam}\`. Try again with an integer, an integer range, or try omitting \`?${messageNouns.noun}\`. We recommend using a value for \`?${messageNouns.noun}\` from a \`<${messageNouns.noun}>\`\u2019s \`id\` attribute.`,
                },
            );
        }
    }

    if (startSearchParam !== null && startSearchParam !== "") {
        throw new InvalidArgumentError("Expected `start` search param to be empty", {
            displayMessage: errorDisplayMessage`Expected \`?start\` URL search param to not have a value, but got \`${startSearchParam}\`. Try again without a value (no \`?start=...\`, just \`?start\`).`,
        });
    }

    if (endSearchParam !== null && endSearchParam !== "") {
        throw new InvalidArgumentError("Expected `end` search param to be empty", {
            displayMessage: errorDisplayMessage`Expected \`?end\` URL search param to not have a value, but got \`${endSearchParam}\`. Try again without a value (no \`?end=...\`, just \`?end\`).`,
        });
    }

    let searchParamCount = 0;
    if (beforeMessageIndex !== null) searchParamCount++;
    if (afterMessageIndex !== null) searchParamCount++;
    if (around !== null) searchParamCount++;
    if (startSearchParam !== null) searchParamCount++;
    if (endSearchParam !== null) searchParamCount++;

    if (searchParamCount > 1) {
        throw new InvalidArgumentError("Expected only one pagination search param", {
            displayMessage: errorDisplayMessage`Expected only one of \`?before\`, \`?after\`, \`?${messageNouns.noun}\`, \`?start\`, or \`?end\` URL search params. Try again with only one of \`?before\`, \`?after\`, \`?${messageNouns.noun}\`, \`?start\`, or \`?end\`. We recommend using a value for \`?before\`, \`?after\`, or \`?${messageNouns.noun}\` from a \`<${messageNouns.noun}>\`\u2019s \`id\` attribute.`,
        });
    }

    // If the agent passes in a specific message/comment link then we have a different
    // code path for reading messages around some index. Bail and call that code path.
    if (around !== null) {
        return readAgentWebMessagingPageAroundMessage(messageNouns, context, {
            room,
            roomMetadataPromise,
            around,
            limitLength,
            printPage,
        });
    }

    const direction: "Start" | "End" =
        afterMessageIndex !== null || startSearchParam !== null
            ? "Start"
            : beforeMessageIndex !== null || endSearchParam !== null
              ? "End"
              : defaultDirection;

    let cursor: number | null = direction === "Start" ? afterMessageIndex : beforeMessageIndex;
    let messages: Array<ApiMessageResponse> = [];

    while (true) {
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

        // Add messages in the right order.
        if (direction === "Start") {
            for (const message of currentMessages) messages.push(message);
        } else {
            messages = [...currentMessages, ...messages];
        }

        // Await the room metadata after we've fetched all our messages. We should have
        // been loading the room metadata in parallel.
        const roomMetadata = await roomMetadataPromise;

        const {contextDate, contextFormattedTimeZone, page} =
            buildAgentWebMessagingPageFromApiMessages(context, {
                messageNouns,
                direction,
                roomMetadata,
                messages,
                isStartOfMessages:
                    direction === "End" ? cursor === null : afterMessageIndex === null,
                isEndOfMessages:
                    direction === "Start" ? cursor === null : beforeMessageIndex === null,
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
        const result = await truncateAgentWebMessagingPage(messageNouns, {
            limitLength,
            roomMetadataTarget: roomMetadata.target,
            direction,
            messages,
            contextTimeZone: context.timeZone,
            contextDate,
            contextFormattedTimeZone,
            page,
            response,
            createPageLinkPathname,
        });

        if (result === null) return {response, metadata: page.metadata};
        return {response: result.truncatedResponse, metadata: result.truncatedMetadata};
    }
}

export async function readAgentWebMessagingPageAroundMessage<Page>(
    messageNouns: AgentWebMessagingPageNouns,
    context: AgentWebContextWithoutStorage,
    {
        room,
        roomMetadataPromise,
        around,
        limitLength,
        printPage,
    }: {
        room: ApiMessageRoomTarget;
        roomMetadataPromise: Promise<{
            target: ApiMentionTargetResponse;
            description: ReadonlyArray<ApiContentInlineElementResponse>;
        }>;
        around: AgentWebMessagingPageMessageRange;
        limitLength: number;
        printPage: (page: AgentWebMessagingPage) => Promise<string>;
    },
): Promise<Page> {
    // Ignore any errors thrown by this promise. Don't crash the process.
    roomMetadataPromise.catch(() => {});

    assert(around.endMessageIndex > around.startMessageIndex);

    assert(Number.isInteger(around.startMessageIndex));
    assert(around.startMessageIndex >= 0);

    assert(Number.isInteger(around.endMessageIndex));
    assert(around.endMessageIndex >= 0);

    const {
        data: {messages: initialMessages, nextCursor: initialNextCursor},
    } = await getApiMessagesFromStart(context.span, context.api, room, {
        limit: agentWebMessagingPageApiMessagesBatchCount,
        cursor:
            around.startMessageIndex -
            Math.floor(
                (agentWebMessagingPageApiMessagesBatchCount -
                    (around.endMessageIndex - around.startMessageIndex)) /
                    2,
            ) -
            1,
    });

    // We expect at least one message in `around` to exist.
    assert(initialMessages.length > 0);

    let beforeCursor = initialMessages[0]!.index !== 0 ? initialMessages[0]!.index : null;
    let afterCursor = initialNextCursor;
    let messages: ReadonlyArray<ApiMessageResponse> = initialMessages;

    while (true) {
        // Await the room metadata after we've fetched all our messages. We should have
        // been loading the room metadata in parallel.
        const roomMetadata = await roomMetadataPromise;

        const messagingPage = buildAgentWebMessagingPageFromApiMessages(context, {
            messageNouns,
            direction: "Around",
            roomMetadata,
            messages,
            isStartOfMessages: beforeCursor === null,
            isEndOfMessages: afterCursor === null,
        });

        const page = buildPage(messagingPage);

        // If there's no more messages or we've exceeded the limit then stop loading
        // messages and return the page we have.
        if (
            (beforeCursor === null && afterCursor === null) ||
            (await computeLength(page)) >= limitLength
        ) {
            return page;
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

function buildAgentWebMessagingPageFromApiMessages(
    context: AgentWebContextWithoutStorage,
    {
        messageNouns,
        direction,
        roomMetadata,
        messages,
        isStartOfMessages,
        isEndOfMessages,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        direction: "Start" | "End" | "Around";
        roomMetadata: {
            target: ApiMentionTargetResponse;
            description: ReadonlyArray<ApiContentInlineElementResponse>;
        };
        messages: ReadonlyArray<ApiMessageResponse>;
        isStartOfMessages: boolean;
        isEndOfMessages: boolean;
    },
): {
    contextTime: Date;
    contextDate: CalendarDate;
    contextFormattedTimeZone: string;
    page: AgentWebMessagingPageWithMetadata;
} {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));
    const contextFormattedTimeZone = formatTimeZoneAbbreviation(context.timeZone, contextTime);

    const blocks: Array<AgentWebMessagingPageBlock> = [];

    let currentBlock: {
        authorId: AccountId;
        formattedTimeZone: string;
        firstCreatedTime: Date;
        lastCreatedTime: Date;
        differenceInMinutesSinceLastMessage: number;
        messages: Array<ApiMessageResponse>;
    } | null = null;

    const continueBlockBeforeMinutesSinceLastMessage = 5;
    const insertTimeBlockAfterMinutesSinceLastMessage = 60;

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
            differenceInMinutesSinceLastMessage < continueBlockBeforeMinutesSinceLastMessage &&
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

    let pagination: AgentWebMessagingPagePreamblePagination | null = null;

    if (messages.length > 0) {
        switch (direction) {
            case "Start": {
                if (!isEndOfMessages) {
                    pagination = {
                        target: roomMetadata.target,
                        previousLink: null,
                        nextLink: {afterMessageIndex: messages[messages.length - 1]!.index},
                    };
                }
                break;
            }
            case "End": {
                if (!isStartOfMessages) {
                    pagination = {
                        target: roomMetadata.target,
                        previousLink: {beforeMessageIndex: messages[0]!.index},
                        nextLink: null,
                    };
                }
                break;
            }
            case "Around": {
                if (!isEndOfMessages && !isStartOfMessages) {
                    pagination = {
                        target: roomMetadata.target,
                        previousLink: {beforeMessageIndex: messages[0]!.index},
                        nextLink: {afterMessageIndex: messages[messages.length - 1]!.index},
                    };
                } else if (!isEndOfMessages) {
                    pagination = {
                        target: roomMetadata.target,
                        previousLink: null,
                        nextLink: {afterMessageIndex: messages[messages.length - 1]!.index},
                    };
                } else if (!isStartOfMessages) {
                    pagination = {
                        target: roomMetadata.target,
                        previousLink: {beforeMessageIndex: messages[0]!.index},
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
            preamble: {elements: preambleElements, pagination},
            isEndOfMessages,
            blocks,
            metadata: {
                messages: messages.map(message => ({index: message.index})),
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
