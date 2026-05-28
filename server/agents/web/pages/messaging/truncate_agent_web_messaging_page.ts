import {CalendarDate} from "@internationalized/date";
import escapeHtml from "escape-html";
import {Parent} from "mdast";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {
    agentWebMessagingNextPageLinkText,
    agentWebMessagingPreviousPageLinkTextWithEndArrow,
} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiMentionTargetResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";

export async function truncateAgentWebMessagingPage(
    messageNouns: AgentWebMessagingPageNouns,
    {
        limitLength,
        roomMetadataTarget,
        direction,
        messages,
        contextTimeZone,
        contextDate,
        contextFormattedTimeZone,
        page,
        response,
        createPageLinkPathname,
    }: {
        limitLength: number;
        roomMetadataTarget: ApiMentionTargetResponse;
        direction: "Start" | "End";
        messages: ReadonlyArray<ApiMessageResponse>;
        contextTimeZone: TimeZone;
        contextDate: CalendarDate;
        contextFormattedTimeZone: string;
        page: AgentWebMessagingPage;
        response: string;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{
    truncatedResponse: string;
    truncatedMetadata: AgentWebMessagingPageMetadata;
} | null> {
    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);

    switch (direction) {
        case "Start": {
            let lastMessageBlockEndOffset: number | null = null;
            let truncateMessageBlockEndOffset: number | null = null;
            let truncateMessageBlockCount = 0;

            let truncateLength = limitLengthDifference;

            let roomTargetPathname: string | null = null;

            // Edge case: if we need to add a pagination link then expect more to be truncated
            // so we can add the pagination link while still fitting into `limitLength`.
            if (!page.preamble.pagination?.nextLink) {
                roomTargetPathname = await createPageLinkPathname(roomMetadataTarget);

                truncateLength +=
                    " [".length +
                    agentWebMessagingNextPageLinkText.length +
                    "](".length +
                    roomTargetPathname.length +
                    "?after=".length +
                    // Max length of an index we'd include after `?after`.
                    messages[messages.length - 1]!.index.toString().length +
                    ")".length;
            }

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
                            truncateLength
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

            // We're intentionally dropping everything after `lastMessageBlockEndOffset`. Which
            // will include the `isEndOfMessages` paragraph. If we're truncating in the `Start`
            // `direction` then we're implicitly not at the end of messages anymore.
            let truncatedResponse = response.slice(0, truncateMessageBlockEndOffset);

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
            } else {
                assert(roomTargetPathname !== null);

                const afterMessageIndex = truncatedMessages[truncatedMessages.length - 1]!.index;

                const paragraph = responseTree.children[0];
                assert(paragraph?.type === "paragraph");

                const paragraphEndOffset = assertExists(paragraph.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, paragraphEndOffset) +
                    ` [${agentWebMessagingNextPageLinkText}](${roomTargetPathname}?after=${afterMessageIndex})` +
                    truncatedResponse.slice(paragraphEndOffset);
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

            let roomTargetPathname: string | null = null;

            // Edge case: if we need to add a pagination link then expect more to be truncated
            // so we can add the pagination link while still fitting into `limitLength`.
            if (!page.preamble.pagination?.previousLink) {
                roomTargetPathname = await createPageLinkPathname(roomMetadataTarget);

                truncateLength +=
                    " [".length +
                    agentWebMessagingPreviousPageLinkTextWithEndArrow.length +
                    "](".length +
                    roomTargetPathname.length +
                    "?before=".length +
                    // Max length of an index we'd include after `?before`.
                    messages[messages.length - 1]!.index.toString().length +
                    ")".length;
            }

            const maxTimeContentLength =
                // The longest month in characters for `defaultLocale` (which we use to print
                // times).
                "September ".length +
                2 +
                "th at ".length +
                2 +
                ":".length +
                2 +
                "pm ".length +
                contextFormattedTimeZone.length;

            // Edge case: When we truncate we'll always be updating the `<time>` tag at the
            // start of the page. Since we don't know what the new time will be, use the max
            // possible length for the new `<time>` tag. We should be within ~7-8 characters of
            // the max width.
            truncateLength += "<time>".length + maxTimeContentLength + "</time>\n\n".length;

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
                                truncateMessageBlockStartOffset -
                                    (firstTimeBlockStartOffset ?? firstMessageBlockStartOffset) >=
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

            let truncatedResponse =
                response.slice(0, firstTimeBlockStartOffset ?? firstMessageBlockStartOffset) +
                response.slice(truncateMessageBlockStartOffset);

            // `truncatedResponse` currently doesn't include an initial `<time>` element. So
            // add one back. Either by using `timeContent` from `truncatedBlocks` or adding a
            // new `Time` block to `truncatedBlocks` and using that.
            if (truncatedBlocks[0]!.type === "Time") {
                truncatedResponse =
                    truncatedResponse.slice(
                        0,
                        firstTimeBlockStartOffset ?? firstMessageBlockStartOffset,
                    ) +
                    `<time>${escapeHtml(truncatedBlocks[0]!.timeContent)}</time>\n\n` +
                    truncatedResponse.slice(
                        firstTimeBlockStartOffset ?? firstMessageBlockStartOffset,
                    );
            } else {
                const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                    defaultLocale,
                    contextTimeZone,
                    contextDate,
                    deserializeDateString(truncatedMessages[0]!.createdTime),
                    {withLongMonth: true},
                );

                const timeContent = `${formattedTime} ${contextFormattedTimeZone}`;
                const timeContentHtml = escapeHtml(timeContent);

                // Normally we have a rule: no user data in error messages since it leaks user data
                // into our logs. However, we don't expect this error to _ever_ be thrown so given
                // we don't expect this to ever throw and having the data which caused us to throw
                // would be _very_ useful we include the time content string.
                //
                // Also, a message created time isn't sensitive data to begin with. You can
                // trivially find the time at which users send messages by scanning our logs.
                if (timeContentHtml.length > maxTimeContentLength) {
                    throw new InternalError(
                        quote`Time content was greater than our max length of ${maxTimeContentLength} (time content: ${timeContentHtml})`,
                    );
                }

                truncatedBlocks.unshift({
                    type: "Time",
                    timeContent,
                });

                truncatedResponse =
                    truncatedResponse.slice(
                        0,
                        firstTimeBlockStartOffset ?? firstMessageBlockStartOffset,
                    ) +
                    `<time>${timeContentHtml}</time>\n\n` +
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

            // Update the "Previous page" link to reflect the new last message index after
            // truncation.
            //
            // If there is no "Previous page" link and truncation occurred then we need to add
            // a "Previous page" link.
            if (page.preamble.pagination?.previousLink) {
                const beforeMessageIndex = truncatedMessages[0]!.index;

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
                        .replace(/\?before=(0|[1-9][0-9]*)/, `?before=${beforeMessageIndex}`) +
                    truncatedResponse.slice(linkEndOffset);
            } else {
                assert(roomTargetPathname !== null);

                const beforeMessageIndex = truncatedMessages[0]!.index;

                const paragraph = responseTree.children[0];
                assert(paragraph?.type === "paragraph");

                const paragraphEndOffset = assertExists(paragraph.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, paragraphEndOffset) +
                    ` [${agentWebMessagingPreviousPageLinkTextWithEndArrow}](${roomTargetPathname}?before=${beforeMessageIndex})` +
                    truncatedResponse.slice(paragraphEndOffset);
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
