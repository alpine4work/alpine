import {CalendarDate} from "@internationalized/date";
import escapeHtml from "escape-html";
import {Parent} from "mdast";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {ApiMessageResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";

export function truncateAgentWebMessagingPage(
    messageNouns: AgentWebMessagingPageNouns,
    {
        limitLength,
        direction,
        messages,
        contextTimeZone,
        contextDate,
        contextFormattedTimeZone,
        page,
        response,
    }: {
        limitLength: number;
        direction: "Start" | "End";
        messages: ReadonlyArray<ApiMessageResponse>;
        contextTimeZone: TimeZone;
        contextDate: CalendarDate;
        contextFormattedTimeZone: string;
        page: AgentWebMessagingPage;
        response: string;
    },
): {
    truncatedResponse: string;
    truncatedMetadata: AgentWebMessagingPageMetadata;
} | null {
    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);

    switch (direction) {
        case "Start": {
            let lastMessageBlockEndOffset: number | null = null;
            let truncateMessageBlockEndOffset: number | null = null;
            let truncateMessageBlockCount = 0;

            const traverse = (node: Parent): boolean => {
                // Very important: for the `End` direction we need to traverse from the bottom of
                // the tree to the top!
                for (const childNode of reverseIterable(node.children)) {
                    if (
                        childNode.type === "html" &&
                        hasHtmlCloseTag(childNode.value, tagName => tagName === messageNouns.noun)
                    ) {
                        const endOffset = assertExists(childNode.position?.end.offset);

                        lastMessageBlockEndOffset ??= endOffset;
                        truncateMessageBlockEndOffset = endOffset;
                        truncateMessageBlockCount++;

                        if (
                            lastMessageBlockEndOffset - truncateMessageBlockEndOffset >=
                            limitLengthDifference
                        ) {
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

            // The last message `traverse()` sees will not be truncated.
            truncateMessageBlockCount--;

            // There are no messages in this page so we don't truncate.
            if (truncateMessageBlockEndOffset === null) return null;

            // Always set when `truncateMessageEndOffset` is set.
            assert(lastMessageBlockEndOffset !== null);

            // No truncation occurred!
            if (truncateMessageBlockEndOffset === lastMessageBlockEndOffset) return null;

            let truncatedResponse =
                response.slice(0, truncateMessageBlockEndOffset) +
                response.slice(lastMessageBlockEndOffset);

            let truncateMessageCount = 0;
            const truncatedBlocks: Array<AgentWebMessagingPageBlock> = [];

            for (const block of reverseIterable(page.blocks)) {
                if (truncateMessageBlockCount > 0) {
                    if (block.type === "Message") {
                        truncateMessageBlockCount--;

                        // Count the number of messages (not blocks) we truncate by dropping this block.
                        truncateMessageCount += block.idAttribute
                            ? block.idAttribute.endMessageIndex -
                              block.idAttribute.startMessageIndex
                            : 1;
                    }
                    continue;
                }

                truncatedBlocks.push(block);
            }

            truncatedBlocks.reverse();

            const truncatedMessages = messages.slice(0, messages.length - truncateMessageCount);

            // There should always be at least one message block left after we truncate.
            assert(truncatedMessages.length > 0);

            // NOCOMMIT: Remove `isEndOfMessages` from `truncatedPrintedPage`

            // Update the "Next page" link to reflect the new last message index after
            // truncation.
            if (page.preamble.pagination?.nextLink) {
                const afterMessageIndex = truncatedMessages[truncatedMessages.length - 1]!.index;

                const paragraph = responseTree.children[0];
                assert(paragraph?.type === "paragraph");
                const link = paragraph.children[paragraph.children.length - 1];
                assert(link?.type === "link");

                const linkStartOffset = assertExists(link.position?.start.offset);
                const linkEndOffset = assertExists(link.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, linkStartOffset) +
                    response
                        .slice(linkStartOffset, linkEndOffset)
                        .replace(/\?after=(0|[1-9][0-9]*)/, `?after=${afterMessageIndex}`) +
                    truncatedResponse.slice(linkEndOffset);
            }

            return {
                truncatedResponse,
                truncatedMetadata: {
                    messages: truncatedMessages.map(message => ({index: message.index})),
                },
            };
        }
        case "End": {
            let firstTimeBlockStartOffset: number | null = null;
            let firstMessageBlockStartOffset: number | null = null;
            let truncateMessageBlockStartOffset: number | null = null;
            let truncateMessageBlockCount = 0;

            let truncateLength = limitLengthDifference;

            // Edge case: when truncating from the start of the list we may need to update
            // `?before` to a later index. For example 12 instead of 4. In that case "12" is
            // one character longer than "4". Prepare for this by requiring more characters to
            // be truncated based on how much bigger the last index is compared to the first.
            if (messages.length > 0) {
                truncateLength +=
                    messages[messages.length - 1]!.index.toString().length -
                    messages[0]!.index.toString().length;
            }

            const traverse = (node: Parent): boolean => {
                for (const childNode of node.children) {
                    if (childNode.type === "html") {
                        if (
                            firstTimeBlockStartOffset === null &&
                            hasHtmlOpenTag(childNode.value, tagName => tagName === "time")
                        ) {
                            firstTimeBlockStartOffset = assertExists(
                                childNode.position?.start.offset,
                            );
                        }

                        if (
                            hasHtmlOpenTag(
                                childNode.value,
                                tagName => tagName === messageNouns.noun,
                            )
                        ) {
                            const startOffset = assertExists(childNode.position?.start.offset);

                            firstMessageBlockStartOffset ??= startOffset;
                            truncateMessageBlockStartOffset = startOffset;
                            truncateMessageBlockCount++;

                            if (
                                truncateMessageBlockStartOffset - firstMessageBlockStartOffset >=
                                truncateLength
                            ) {
                                return true;
                            }
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

            // The last message `traverse()` sees will not be truncated.
            truncateMessageBlockCount--;

            // There are no messages in this page so we don't truncate.
            if (truncateMessageBlockStartOffset === null) return null;

            // Always set when `truncateMessageBlockStartOffset` is set.
            assert(firstMessageBlockStartOffset !== null);

            // No truncation occurred!
            if (truncateMessageBlockStartOffset === firstMessageBlockStartOffset) return null;

            let truncatedResponse =
                response.slice(0, firstTimeBlockStartOffset ?? firstMessageBlockStartOffset) +
                response.slice(truncateMessageBlockStartOffset);

            let truncateMessageCount = 0;
            const truncatedBlocks: Array<AgentWebMessagingPageBlock> = [];

            for (const block of page.blocks) {
                if (truncateMessageBlockCount > 0) {
                    if (block.type === "Message") {
                        truncateMessageBlockCount--;

                        // Count the number of messages (not blocks) we truncate by dropping this block.
                        truncateMessageCount += block.idAttribute
                            ? block.idAttribute.endMessageIndex -
                              block.idAttribute.startMessageIndex
                            : 1;
                    }
                    continue;
                }

                truncatedBlocks.push(block);
            }

            const truncatedMessages = messages.slice(truncateMessageCount);

            // There should always be at least one message block left after we truncate.
            assert(truncatedMessages.length > 0);

            // NOCOMMIT: Additional space for time change?
            if (truncatedBlocks[0]!.type !== "Time") {
                const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                    defaultLocale,
                    contextTimeZone,
                    contextDate,
                    deserializeDateString(truncatedMessages[0]!.createdTime),
                    {withLongMonth: true},
                );

                const timeContent = `${formattedTime} ${contextFormattedTimeZone}`;

                truncatedBlocks.unshift({
                    type: "Time",
                    timeContent,
                });

                truncatedResponse =
                    truncatedResponse.slice(
                        0,
                        firstTimeBlockStartOffset ?? firstMessageBlockStartOffset,
                    ) +
                    `<time>${escapeHtml(timeContent)}</time>\n\n` +
                    truncatedResponse.slice(
                        firstTimeBlockStartOffset ?? firstMessageBlockStartOffset,
                    );
            }

            // Remove the `time` attribute from the first message block. We add a `<time>`
            // block above to communicate the time.
            if (truncatedBlocks[1]!.type !== "Time" && truncatedBlocks[1]!.timeAttribute !== null) {
                truncatedBlocks[1] = {...truncatedBlocks[1]!, timeAttribute: null};

                truncatedResponse =
                    truncatedResponse.slice(
                        0,
                        firstTimeBlockStartOffset ?? firstMessageBlockStartOffset,
                    ) +
                    truncatedResponse
                        .slice(firstTimeBlockStartOffset ?? firstMessageBlockStartOffset)
                        .replace(/ time="[^"]*"/, "");
            }

            // Update the "Next page" link to reflect the new last message index after
            // truncation.
            if (page.preamble.pagination?.previousLink) {
                const beforeMessageIndex = truncatedMessages[0]!.index;

                const printedPagePreamble = responseTree.children[0];
                assert(printedPagePreamble?.type === "paragraph");
                const printedPagePaginationLink =
                    printedPagePreamble.children[printedPagePreamble.children.length - 1];
                assert(printedPagePaginationLink?.type === "link");

                const paginationLinkStartOffset = assertExists(
                    printedPagePaginationLink.position?.start.offset,
                );
                const paginationLinkEndOffset = assertExists(
                    printedPagePaginationLink.position?.end.offset,
                );

                truncatedResponse =
                    truncatedResponse.slice(0, paginationLinkStartOffset) +
                    response
                        .slice(paginationLinkStartOffset, paginationLinkEndOffset)
                        .replace(/\?before=(0|[1-9][0-9]*)/, `?before=${beforeMessageIndex}`) +
                    truncatedResponse.slice(paginationLinkEndOffset);
            }

            return {
                truncatedResponse,
                truncatedMetadata: {
                    messages: truncatedMessages.map(message => ({index: message.index})),
                },
            };
        }
        default:
            throw exhaustive(direction);
    }
}
