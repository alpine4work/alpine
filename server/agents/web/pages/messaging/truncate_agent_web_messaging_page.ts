import {CalendarDate} from "@internationalized/date";
import escapeHtml from "escape-html";
import {Paragraph, Parent, PhrasingContent, RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.js";
import {
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageCustomBlockBase,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageNouns,
    AgentWebMessagingPagePaginationPageLink,
    AgentWebMessagingPageWithMetadata,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {
    agentWebMessagingNextPageLinkText,
    agentWebMessagingPreviousPageLinkTextWithEndArrow,
    agentWebMessagingPreviousPageLinkTextWithStartArrow,
} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {ApiMessageResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {alternateIterables} from "~/shared/helpers/iterable/alternate_iterables.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {createIterableWithLength} from "~/shared/helpers/iterable/create_iterable_with_length.js";
import {exhaustIterable} from "~/shared/helpers/iterable/exhaust_iterable.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";

export async function truncateAgentWebMessagingPage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    storage: AgentWebSessionStorage,
    {
        messageNouns,
        limitLength,
        roomMetadataPageLink,
        direction,
        isStartOfMessages,
        isEndOfMessages,
        messages,
        contextTimeZone,
        contextDate,
        contextFormattedTimeZone,
        page,
        response,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        limitLength: number;
        roomMetadataPageLink: AgentWebMessagingPagePaginationPageLink;
        direction: "Start" | "End";
        isStartOfMessages: boolean;
        isEndOfMessages: boolean;
        messages: ReadonlyArray<ApiMessageResponse>;
        contextTimeZone: TimeZone;
        contextDate: CalendarDate;
        contextFormattedTimeZone: string;
        page: AgentWebMessagingPageWithMetadata<Preamble, CustomBlock>;
        response: string;
    },
): Promise<{
    truncatedResponse: string;
    truncatedMetadata: AgentWebMessagingPageMetadata;
} | null> {
    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);

    const customBlockTagNames = new Set<string>();
    for (const block of page.blocks) {
        if (block.type === "Custom") {
            customBlockTagNames.add(block.tagName);
        }
    }

    switch (direction) {
        case "Start": {
            let lastMessageBlockOrCustomBlockEndOffset: number | null = null;
            let truncateMessageBlockOrCustomBlockEndOffset: number | null = null;
            let truncateMessageBlockOrCustomBlockCount = 0;

            let truncateLength = limitLengthDifference;

            let roomReferencePathname: string | null = null;

            // Edge case: if we need to add a pagination link then expect more to be truncated
            // so we can add the pagination link while still fitting into `limitLength`.
            if (!page.pagination?.nextLink) {
                roomReferencePathname = await createAgentWebPageLinkPathname(
                    storage,
                    roomMetadataPageLink,
                );

                truncateLength +=
                    // We need double newlines when adding after a heading and a single space when
                    // adding into a paragraph. Given double newlines is the longer of the two use that
                    // in our character count.
                    "\n\n[".length +
                    agentWebMessagingNextPageLinkText.length +
                    "](".length +
                    roomReferencePathname.length +
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
                        hasHtmlCloseTag(
                            childNode.value,
                            tagName =>
                                tagName === messageNouns.noun || customBlockTagNames.has(tagName),
                        )
                    ) {
                        const endOffset = assertExists(childNode.position?.end.offset);

                        lastMessageBlockOrCustomBlockEndOffset ??= endOffset;
                        truncateMessageBlockOrCustomBlockEndOffset = endOffset;
                        truncateMessageBlockOrCustomBlockCount++;

                        if (
                            lastMessageBlockOrCustomBlockEndOffset -
                                truncateMessageBlockOrCustomBlockEndOffset >=
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

            // We don't truncate the last block traverse sees.
            truncateMessageBlockOrCustomBlockCount--;

            // There are no messages in this page so we don't truncate.
            if (truncateMessageBlockOrCustomBlockEndOffset === null) return null;

            // Always set when `truncateMessageEndOffset` is set.
            assert(lastMessageBlockOrCustomBlockEndOffset !== null);

            // No truncation occurred!
            if (
                truncateMessageBlockOrCustomBlockEndOffset ===
                lastMessageBlockOrCustomBlockEndOffset
            ) {
                return null;
            }

            let truncateMessageCount = 0;
            const truncatedBlocks: Array<AgentWebMessagingPageBlock<CustomBlock>> = [];

            for (const block of reverseIterable(page.blocks)) {
                if (truncateMessageBlockOrCustomBlockCount > 0) {
                    if (block.type === "Message" || block.type === "Custom") {
                        truncateMessageBlockOrCustomBlockCount--;

                        // Count the number of messages (not blocks) we truncate by dropping this block.
                        if (block.type === "Message") {
                            truncateMessageCount += block.idAttribute
                                ? block.idAttribute.endMessageIndex -
                                  block.idAttribute.startMessageIndex
                                : 1;
                        }
                    }
                    continue;
                }

                truncatedBlocks.push(block);
            }

            truncatedBlocks.reverse();

            // Our truncation always skips over time blocks. So remove any time blocks at the
            // end of the `truncatedBlocks` array.
            while (
                truncatedBlocks.length > 0 &&
                truncatedBlocks[truncatedBlocks.length - 1]!.type === "Time"
            ) {
                truncatedBlocks.pop();
            }

            assert(page.metadata.messages.length === messages.length);
            const truncatedMessages = page.metadata.messages.slice(
                0,
                messages.length - truncateMessageCount,
            );

            // There should always be at least one block left after we truncate.
            assert(truncatedBlocks.length > 0);

            const lastTruncatedBlock = truncatedBlocks[truncatedBlocks.length - 1]!;

            let afterSearchParam: string;

            switch (lastTruncatedBlock.type) {
                case "Message": {
                    assert(truncatedMessages.length > 0);
                    afterSearchParam = String(
                        truncatedMessages[truncatedMessages.length - 1]!.index,
                    );
                    break;
                }
                case "Custom": {
                    afterSearchParam = lastTruncatedBlock.tagName;
                    break;
                }
                default: {
                    // The last truncated block shouldn't be `<time>` since we only truncate at message
                    // or custom block boundaries.
                    assert(lastTruncatedBlock.type !== "Time");

                    throw exhaustive(lastTruncatedBlock);
                }
            }

            // We're intentionally dropping everything after `lastMessageBlockEndOffset`. Which
            // will include the `isEndOfMessages` paragraph. If we're truncating in the `Start`
            // `direction` then we're implicitly not at the end of messages anymore.
            let truncatedResponse = response.slice(0, truncateMessageBlockOrCustomBlockEndOffset);

            // Update the "Next page" link to reflect the new last message index after
            // truncation.
            if (page.pagination?.nextLink) {
                const paragraph = getAgentWebMessagingPagePreamblePaginationParagraph(responseTree);
                const link = paragraph.children[paragraph.children.length - 1];
                assert(link?.type === "link");

                const linkStartOffset = assertExists(link.position?.start.offset);
                const linkEndOffset = assertExists(link.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, linkStartOffset) +
                    response
                        .slice(linkStartOffset, linkEndOffset)
                        .replace(/\?after=(0|[1-9][0-9]*)/, `?after=${afterSearchParam}`) +
                    truncatedResponse.slice(linkEndOffset);
            } else {
                assert(roomReferencePathname !== null);

                truncatedResponse = insertAgentWebMessagingPagePreamblePaginationLink(
                    responseTree,
                    truncatedResponse,
                    `[${agentWebMessagingNextPageLinkText}](${roomReferencePathname}?after=${afterSearchParam})`,
                ).truncatedResponse;
            }

            return {
                truncatedResponse,
                truncatedMetadata: {
                    isStartOfMessages,
                    // If we truncated some messages from the end even if we were at the end we're
                    // definitely not at the end now.
                    isEndOfMessages: false,
                    messages: truncatedMessages,
                },
            };
        }
        case "End": {
            let firstTimeBlockStartOffset: number | null = null;
            let firstMessageBlockOrCustomBlockStartOffset: number | null = null;
            let truncateMessageBlockOrCustomBlockStartOffset: number | null = null;
            let truncateMessageBlockOrCustomBlockCount = 0;

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

            let roomReferencePathname: string | null = null;

            // Edge case: if we need to add a pagination link then expect more to be truncated
            // so we can add the pagination link while still fitting into `limitLength`.
            if (!page.pagination?.previousLink) {
                roomReferencePathname = await createAgentWebPageLinkPathname(
                    storage,
                    roomMetadataPageLink,
                );

                truncateLength +=
                    // We need double newlines when adding after a heading and a single space when
                    // adding into a paragraph. Given double newlines is the longer of the two use that
                    // in our character count.
                    "\n\n[".length +
                    agentWebMessagingPreviousPageLinkTextWithEndArrow.length +
                    "](".length +
                    roomReferencePathname.length +
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
                                tagName =>
                                    tagName === messageNouns.noun ||
                                    customBlockTagNames.has(tagName),
                            )
                        ) {
                            const startOffset = assertExists(childNode.position?.start.offset);

                            firstMessageBlockOrCustomBlockStartOffset ??= startOffset;
                            truncateMessageBlockOrCustomBlockStartOffset = startOffset;
                            truncateMessageBlockOrCustomBlockCount++;

                            if (
                                truncateMessageBlockOrCustomBlockStartOffset -
                                    (firstTimeBlockStartOffset ??
                                        firstMessageBlockOrCustomBlockStartOffset) >=
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

            // We don't truncate the last block traverse sees.
            truncateMessageBlockOrCustomBlockCount--;

            // There are no messages in this page so we don't truncate.
            if (truncateMessageBlockOrCustomBlockStartOffset === null) return null;

            // Always set when `truncateMessageBlockStartOffset` is set.
            assert(firstMessageBlockOrCustomBlockStartOffset !== null);

            // No truncation occurred!
            if (
                truncateMessageBlockOrCustomBlockStartOffset ===
                firstMessageBlockOrCustomBlockStartOffset
            ) {
                return null;
            }

            let truncateMessageCount = 0;
            const truncatedBlocks: Array<AgentWebMessagingPageBlock<CustomBlock>> = [];

            for (const block of page.blocks) {
                if (truncateMessageBlockOrCustomBlockCount > 0) {
                    if (block.type === "Message" || block.type === "Custom") {
                        truncateMessageBlockOrCustomBlockCount--;

                        // Count the number of messages (not blocks) we truncate by dropping this block.
                        if (block.type === "Message") {
                            truncateMessageCount += block.idAttribute
                                ? block.idAttribute.endMessageIndex -
                                  block.idAttribute.startMessageIndex
                                : 1;
                        }
                    }
                    continue;
                }

                truncatedBlocks.push(block);
            }

            assert(page.metadata.messages.length === messages.length);
            const truncatedMessages = page.metadata.messages.slice(truncateMessageCount);

            // There should always be at least one message block left after we truncate.
            //
            // NOCOMMIT: Might not be the case anymore!
            assert(truncatedMessages.length > 0);

            let truncatedResponse =
                response.slice(
                    0,
                    firstTimeBlockStartOffset ?? firstMessageBlockOrCustomBlockStartOffset,
                ) + response.slice(truncateMessageBlockOrCustomBlockStartOffset);

            // `truncatedResponse` currently doesn't include an initial `<time>` element. So
            // add one back. Either by using `timeContent` from `truncatedBlocks` or adding a
            // new `Time` block to `truncatedBlocks` and using that.
            if (
                truncatedBlocks[0]!.type === "Time" ||
                (truncatedBlocks[0]!.type === "Custom" && truncatedBlocks[1]?.type === "Time")
            ) {
                // `<time>` still exists in truncated blocks.
            } else {
                const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                    defaultLocale,
                    contextTimeZone,
                    contextDate,
                    deserializeDateString(messages[truncateMessageCount]!.createdTime),
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
                        firstTimeBlockStartOffset ?? firstMessageBlockOrCustomBlockStartOffset,
                    ) +
                    `<time>${timeContentHtml}</time>\n\n` +
                    truncatedResponse.slice(
                        firstTimeBlockStartOffset ?? firstMessageBlockOrCustomBlockStartOffset,
                    );
            }

            // Remove the `time` attribute from the first message block. We add a `<time>`
            // block above to communicate the time.
            if (truncatedBlocks[1]!.type !== "Time" && truncatedBlocks[1]!.timeAttribute !== null) {
                truncatedBlocks[1] = {...truncatedBlocks[1]!, timeAttribute: null};

                truncatedResponse =
                    truncatedResponse.slice(
                        0,
                        firstTimeBlockStartOffset ?? firstMessageBlockOrCustomBlockStartOffset,
                    ) +
                    truncatedResponse
                        .slice(
                            firstTimeBlockStartOffset ?? firstMessageBlockOrCustomBlockStartOffset,
                        )
                        .replace(/ time="[^"]*"/, "");
            }

            // Update the "Previous page" link to reflect the new last message index after
            // truncation.
            //
            // If there is no "Previous page" link and truncation occurred then we need to add
            // a "Previous page" link.
            if (page.pagination?.previousLink) {
                const beforeMessageIndex = truncatedMessages[0]!.index;

                const paragraph = getAgentWebMessagingPagePreamblePaginationParagraph(responseTree);
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
                assert(roomReferencePathname !== null);

                const beforeMessageIndex = truncatedMessages[0]!.index;

                truncatedResponse = insertAgentWebMessagingPagePreamblePaginationLink(
                    responseTree,
                    truncatedResponse,
                    `[${agentWebMessagingPreviousPageLinkTextWithEndArrow}](${roomReferencePathname}?before=${beforeMessageIndex})`,
                ).truncatedResponse;
            }

            return {
                truncatedResponse,
                truncatedMetadata: {
                    // If we truncated some messages from the start even if we were at the start we're
                    // definitely not at the start now.
                    isStartOfMessages: false,
                    isEndOfMessages,
                    messages: truncatedMessages,
                },
            };
        }
        default:
            throw exhaustive(direction);
    }
}

export async function truncateAgentWebMessagingPageAroundMessage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    storage: AgentWebSessionStorage,
    {
        messageNouns,
        limitLength,
        roomMetadataPageLink,
        around,
        isStartOfMessages,
        isEndOfMessages,
        messages,
        contextTimeZone,
        contextDate,
        contextFormattedTimeZone,
        page,
        response,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        limitLength: number;
        roomMetadataPageLink: AgentWebMessagingPagePaginationPageLink;
        around: AgentWebMessagingPageMessageRange;
        isStartOfMessages: boolean;
        isEndOfMessages: boolean;
        messages: ReadonlyArray<ApiMessageResponse>;
        contextTimeZone: TimeZone;
        contextDate: CalendarDate;
        contextFormattedTimeZone: string;
        page: AgentWebMessagingPageWithMetadata<Preamble, CustomBlock>;
        response: string;
    },
): Promise<{
    truncatedResponse: string;
    truncatedMetadata: AgentWebMessagingPageMetadata;
} | null> {
    let messageCountBeforeAround = 0;
    let messageCountAfterAround = 0;

    for (const message of messages) {
        if (message.index < around.startMessageIndex) {
            messageCountBeforeAround++;
        } else {
            break;
        }
    }

    for (const message of reverseIterable(messages)) {
        if (message.index > around.endMessageIndex - 1) {
            messageCountAfterAround++;
        } else {
            break;
        }
    }

    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);

    const customBlockTagNames = new Set<string>();
    for (const block of page.blocks) {
        if (block.type === "Custom") {
            customBlockTagNames.add(block.tagName);
        }
    }

    let lastMessageBlockOrCustomBlockEndOffset: number | null = null;
    let truncateMessageBlockOrCustomBlockEndOffset: number | null = null;
    let truncateMessageBlockCountOrCustomBlockFromEnd = 0;
    let blockIndexFromEnd: number | null = null;

    let firstTimeBlockStartOffset: number | null = null;
    let firstMessageBlockStartOrCustomBlockOffset: number | null = null;
    let truncateMessageBlockOrCustomBlockStartOffset: number | null = null;
    let truncateMessageBlockOrCustomBlockCountFromStart = 0;
    let blockIndexFromStart: number | null = null;

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

    let roomReferencePathname: string | null = null;

    // Edge case: if we need to add a pagination link then expect more to be truncated
    // so we can add the pagination link while still fitting into `limitLength`.
    if (!page.pagination?.previousLink) {
        roomReferencePathname ??= await createAgentWebPageLinkPathname(
            storage,
            roomMetadataPageLink,
        );

        truncateLength +=
            // We need double newlines when adding after a heading and a single space when
            // adding into a paragraph. Given double newlines is the longer of the two use that
            // in our character count.
            "\n\n[".length +
            agentWebMessagingPreviousPageLinkTextWithEndArrow.length +
            "](".length +
            roomReferencePathname.length +
            "?before=".length +
            // Max length of an index we'd include after `?before`.
            messages[messages.length - 1]!.index.toString().length +
            ")".length;
    }

    // Edge case: if we need to add a pagination link then expect more to be truncated
    // so we can add the pagination link while still fitting into `limitLength`.
    if (!page.pagination?.nextLink) {
        roomReferencePathname ??= await createAgentWebPageLinkPathname(
            storage,
            roomMetadataPageLink,
        );

        truncateLength +=
            // We need double newlines when adding after a heading and a single space when
            // adding into a paragraph. Given double newlines is the longer of the two use that
            // in our character count.
            "\n\n[".length +
            agentWebMessagingNextPageLinkText.length +
            "](".length +
            roomReferencePathname.length +
            "?after=".length +
            // Max length of an index we'd include after `?after`.
            messages[messages.length - 1]!.index.toString().length +
            ")".length;

        // If we have both a next page and a previous page link then we'll also be adding a
        // separator.
        if (!page.pagination?.previousLink) {
            truncateLength += " | ".length;
        }
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

    const getCurrentTruncateLength = () =>
        (truncateMessageBlockOrCustomBlockEndOffset !== null
            ? assertExists(lastMessageBlockOrCustomBlockEndOffset) -
              truncateMessageBlockOrCustomBlockEndOffset
            : 0) +
        (truncateMessageBlockOrCustomBlockStartOffset !== null
            ? truncateMessageBlockOrCustomBlockStartOffset -
              (firstTimeBlockStartOffset ?? assertExists(firstMessageBlockStartOrCustomBlockOffset))
            : 0);

    function* traverseFromEnd(node: Parent): IterableIterator<void, boolean> {
        // Very important: for the `End` direction we need to traverse from the bottom of
        // the tree to the top!
        for (const childNode of reverseIterable(node.children)) {
            if (
                childNode.type === "html" &&
                hasHtmlCloseTag(
                    childNode.value,
                    tagName => tagName === messageNouns.noun || customBlockTagNames.has(tagName),
                )
            ) {
                const endOffset = assertExists(childNode.position?.end.offset);

                lastMessageBlockOrCustomBlockEndOffset ??= endOffset;
                truncateMessageBlockOrCustomBlockEndOffset = endOffset;
                truncateMessageBlockCountOrCustomBlockFromEnd++;

                // Have we truncated enough?
                if (getCurrentTruncateLength() >= truncateLength) {
                    return true;
                }

                // Test if this block intersects with `around`.
                {
                    blockIndexFromEnd ??= page.blocks.length;

                    let found = false;
                    while (blockIndexFromEnd - 1 >= 0) {
                        blockIndexFromEnd--;

                        const block = page.blocks[blockIndexFromEnd]!;

                        if (block.type === "Custom") {
                            found = true;
                            break;
                        }

                        if (block.type !== "Message") continue;

                        found = true;

                        // We don't want to truncate any messages in the `around` range. So if this block
                        // intersects with the `around` range then `return true` so we don't truncate this
                        // block.
                        if (
                            block.idAttribute &&
                            areRangesOverlapping(
                                block.idAttribute.startMessageIndex,
                                block.idAttribute.endMessageIndex - 1,
                                around.startMessageIndex,
                                around.endMessageIndex - 1,
                            )
                        ) {
                            return true;
                        }
                        break;
                    }

                    assert(found);
                }

                // Yield after every message block we find to the other iterator in our
                // `alternateIterables()` call.
                yield;

                // When we yielded to the alternate iterable, did it finish truncating? If so
                // `return true` so we don't truncate any more messages.
                if (getCurrentTruncateLength() >= truncateLength) {
                    return true;
                }
            }

            if ("children" in childNode) {
                const done: boolean = yield* traverseFromEnd(childNode);
                if (done) return true;
            }
        }

        return false;
    }

    function* traverseFromStart(node: Parent): IterableIterator<void, boolean> {
        for (const childNode of node.children) {
            if (childNode.type === "html") {
                if (
                    firstTimeBlockStartOffset === null &&
                    hasHtmlOpenTag(childNode.value, tagName => tagName === "time")
                ) {
                    firstTimeBlockStartOffset = assertExists(childNode.position?.start.offset);
                }

                if (
                    hasHtmlOpenTag(
                        childNode.value,
                        tagName =>
                            tagName === messageNouns.noun || customBlockTagNames.has(tagName),
                    )
                ) {
                    const startOffset = assertExists(childNode.position?.start.offset);

                    firstMessageBlockStartOrCustomBlockOffset ??= startOffset;
                    truncateMessageBlockOrCustomBlockStartOffset = startOffset;
                    truncateMessageBlockOrCustomBlockCountFromStart++;

                    if (getCurrentTruncateLength() >= truncateLength) {
                        return true;
                    }

                    // Test if this block intersects with `around`.
                    {
                        blockIndexFromStart ??= 0;

                        let found = false;
                        while (blockIndexFromStart + 1 < page.blocks.length) {
                            blockIndexFromStart++;

                            const block = page.blocks[blockIndexFromStart]!;

                            if (block.type === "Custom") {
                                found = true;
                                break;
                            }

                            if (block.type !== "Message") continue;

                            found = true;

                            // We don't want to truncate any messages in the `around` range. So if this block
                            // intersects with the `around` range then `return true` so we don't truncate this
                            // block.
                            if (
                                block.idAttribute &&
                                areRangesOverlapping(
                                    block.idAttribute.startMessageIndex,
                                    block.idAttribute.endMessageIndex - 1,
                                    around.startMessageIndex,
                                    around.endMessageIndex - 1,
                                )
                            ) {
                                return true;
                            }
                            break;
                        }

                        assert(found);
                    }

                    // Yield after every message block we find to the other iterator in our
                    // `alternateIterables()` call.
                    yield;

                    // When we yielded to the alternate iterable, did it finish truncating? If so
                    // `return true` so we don't truncate any more messages.
                    if (getCurrentTruncateLength() >= truncateLength) {
                        return true;
                    }
                }
            }

            if ("children" in childNode) {
                const done: boolean = yield* traverseFromStart(childNode);
                if (done) return true;
            }
        }

        return false;
    }

    // Alternate between start and end traversal. So we remove a message block from the
    // start, then the end, then the start, then the end. Until we hit our target
    // truncation length.
    exhaustIterable(
        alternateIterables(
            concatIterables(
                // Fix imbalance in messages before/after `around` range. If there are more
                // messages before our around range than after we will `yield` the difference so we
                // don't truncate messages close to the `around` range.
                createIterableWithLength(messageCountAfterAround - messageCountBeforeAround, noop),
                traverseFromStart(responseTree),
            ),
            concatIterables(
                // Fix imbalance in messages before/after `around` range. If there are more
                // messages after our around range than before we will `yield` the difference so we
                // don't truncate messages close to the `around` range.
                createIterableWithLength(messageCountBeforeAround - messageCountAfterAround, noop),
                traverseFromEnd(responseTree),
            ),
        ),
    );

    // We don't truncate the last block traverse sees.
    truncateMessageBlockOrCustomBlockCountFromStart--;

    // We don't truncate the last block traverse sees.
    truncateMessageBlockCountOrCustomBlockFromEnd--;

    // TypeScript is dumb and doesn't realize these variables are assigned when we call
    // `traverseFromStart()`.
    truncateMessageBlockOrCustomBlockStartOffset =
        truncateMessageBlockOrCustomBlockStartOffset as any;
    firstTimeBlockStartOffset = firstTimeBlockStartOffset as any;
    firstMessageBlockStartOrCustomBlockOffset = firstMessageBlockStartOrCustomBlockOffset as any;

    // TypeScript is dumb and doesn't realize these variables are assigned when we call
    // `traverseFromStart()`.
    truncateMessageBlockOrCustomBlockEndOffset = truncateMessageBlockOrCustomBlockEndOffset as any;
    lastMessageBlockOrCustomBlockEndOffset = lastMessageBlockOrCustomBlockEndOffset as any;

    // There are no messages in this page so we don't truncate.
    if (
        truncateMessageBlockOrCustomBlockEndOffset === null ||
        truncateMessageBlockOrCustomBlockStartOffset === null
    ) {
        return null;
    }

    // Always set when `truncateMessageEndOffset`/`truncateMessageBlockStartOffset` is
    // set.
    assert(lastMessageBlockOrCustomBlockEndOffset !== null);
    assert(firstMessageBlockStartOrCustomBlockOffset !== null);

    const didTruncateFromEnd =
        truncateMessageBlockOrCustomBlockEndOffset !== lastMessageBlockOrCustomBlockEndOffset;
    const didTruncateFromStart =
        truncateMessageBlockOrCustomBlockStartOffset !== firstMessageBlockStartOrCustomBlockOffset;

    // No truncation occurred!
    if (!didTruncateFromEnd && !didTruncateFromStart) {
        return null;
    }

    let truncateMessageCountFromStart = 0;
    let truncateMessageCountFromEnd = 0;
    const intermediateTruncatedBlocks: Array<AgentWebMessagingPageBlock<CustomBlock>> = [];
    const truncatedBlocks: Array<AgentWebMessagingPageBlock<CustomBlock>> = [];

    for (const block of page.blocks) {
        if (truncateMessageBlockOrCustomBlockCountFromStart > 0) {
            if (block.type === "Message" || block.type === "Custom") {
                truncateMessageBlockOrCustomBlockCountFromStart--;

                // Count the number of messages (not blocks) we truncate by dropping this block.
                if (block.type === "Message") {
                    truncateMessageCountFromStart += block.idAttribute
                        ? block.idAttribute.endMessageIndex - block.idAttribute.startMessageIndex
                        : 1;
                }
            }
            continue;
        }

        intermediateTruncatedBlocks.push(block);
    }

    for (const block of reverseIterable(intermediateTruncatedBlocks)) {
        if (truncateMessageBlockCountOrCustomBlockFromEnd > 0) {
            if (block.type === "Message" || block.type === "Custom") {
                truncateMessageBlockCountOrCustomBlockFromEnd--;

                // Count the number of messages (not blocks) we truncate by dropping this block.
                if (block.type === "Message") {
                    truncateMessageCountFromEnd += block.idAttribute
                        ? block.idAttribute.endMessageIndex - block.idAttribute.startMessageIndex
                        : 1;
                }
            }
            continue;
        }

        truncatedBlocks.push(block);
    }

    truncatedBlocks.reverse();

    // Our truncation always skips over time blocks. So remove any time blocks at the
    // end of the `truncatedBlocks` array.
    while (
        truncatedBlocks.length > 0 &&
        truncatedBlocks[truncatedBlocks.length - 1]!.type === "Time"
    ) {
        truncatedBlocks.pop();
    }

    assert(page.metadata.messages.length === messages.length);
    const truncatedMessages = page.metadata.messages.slice(
        truncateMessageCountFromStart,
        messages.length - truncateMessageCountFromEnd,
    );

    // There should always be at least one message block left after we truncate.
    //
    // NOCOMMIT: Might not be the case anymore!
    assert(truncatedMessages.length > 0);

    let truncatedResponse =
        response.slice(0, firstTimeBlockStartOffset ?? firstMessageBlockStartOrCustomBlockOffset) +
        response.slice(
            truncateMessageBlockOrCustomBlockStartOffset,
            // We're intentionally dropping everything after `lastMessageBlockEndOffset`. Which
            // will include the `isEndOfMessages` paragraph. If we're truncating in the `Start`
            // `direction` then we're implicitly not at the end of messages anymore.
            didTruncateFromEnd ? truncateMessageBlockOrCustomBlockEndOffset : undefined,
        );

    // `truncatedResponse` currently doesn't include an initial `<time>` element. So
    // add one back. Either by using `timeContent` from `truncatedBlocks` or adding a
    // new `Time` block to `truncatedBlocks` and using that.
    if (
        truncatedBlocks[0]!.type === "Time" ||
        (truncatedBlocks[0]!.type === "Custom" && truncatedBlocks[1]?.type === "Time")
    ) {
        // `<time>` still exists in truncated blocks.
    } else {
        const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
            defaultLocale,
            contextTimeZone,
            contextDate,
            deserializeDateString(messages[truncateMessageCountFromStart]!.createdTime),
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
                firstTimeBlockStartOffset ?? firstMessageBlockStartOrCustomBlockOffset,
            ) +
            `<time>${timeContentHtml}</time>\n\n` +
            truncatedResponse.slice(
                firstTimeBlockStartOffset ?? firstMessageBlockStartOrCustomBlockOffset,
            );
    }

    // Remove the `time` attribute from the first message block. We add a `<time>`
    // block above to communicate the time.
    if (truncatedBlocks[1]!.type !== "Time" && truncatedBlocks[1]!.timeAttribute !== null) {
        truncatedBlocks[1] = {...truncatedBlocks[1]!, timeAttribute: null};

        truncatedResponse =
            truncatedResponse.slice(
                0,
                firstTimeBlockStartOffset ?? firstMessageBlockStartOrCustomBlockOffset,
            ) +
            truncatedResponse
                .slice(firstTimeBlockStartOffset ?? firstMessageBlockStartOrCustomBlockOffset)
                .replace(/ time="[^"]*"/, "");
    }

    if (
        didTruncateFromEnd &&
        didTruncateFromStart &&
        !page.pagination?.nextLink &&
        !page.pagination?.previousLink
    ) {
        assert(roomReferencePathname !== null);

        const beforeMessageIndex = truncatedMessages[0]!.index;
        const afterMessageIndex = truncatedMessages[truncatedMessages.length - 1]!.index;

        truncatedResponse = insertAgentWebMessagingPagePreamblePaginationLink(
            responseTree,
            truncatedResponse,
            `[${agentWebMessagingPreviousPageLinkTextWithStartArrow}](${roomReferencePathname}?before=${beforeMessageIndex}) | [${agentWebMessagingNextPageLinkText}](${roomReferencePathname}?after=${afterMessageIndex})`,
        ).truncatedResponse;
    }

    // Update the "Next page" link to reflect the new last message index after
    // truncation.
    if (didTruncateFromEnd) {
        if (page.pagination?.nextLink) {
            const afterMessageIndex = truncatedMessages[truncatedMessages.length - 1]!.index;

            const paragraph = getAgentWebMessagingPagePreamblePaginationParagraph(responseTree);
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
        } else if (page.pagination?.previousLink || !didTruncateFromStart) {
            assert(roomReferencePathname !== null);

            const afterMessageIndex = truncatedMessages[truncatedMessages.length - 1]!.index;

            if (!page.pagination?.previousLink) {
                const insertResult = insertAgentWebMessagingPagePreamblePaginationLink(
                    responseTree,
                    truncatedResponse,
                    `[${agentWebMessagingNextPageLinkText}](${roomReferencePathname}?after=${afterMessageIndex})`,
                );
                truncatedResponse = insertResult.truncatedResponse;
            } else {
                const paragraph = getAgentWebMessagingPagePreamblePaginationParagraph(responseTree);
                const paragraphEndOffset = assertExists(paragraph.position?.end.offset);
                const link = paragraph.children[paragraph.children.length - 1];
                assert(link?.type === "link");

                const linkStartOffset = assertExists(link.position?.start.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, linkStartOffset) +
                    truncatedResponse
                        .slice(linkStartOffset, paragraphEndOffset)
                        .replace(
                            agentWebMessagingPreviousPageLinkTextWithEndArrow,
                            agentWebMessagingPreviousPageLinkTextWithStartArrow,
                        ) +
                    ` | [${agentWebMessagingNextPageLinkText}](${roomReferencePathname}?after=${afterMessageIndex})` +
                    truncatedResponse.slice(paragraphEndOffset);
            }
        }
    }

    // Update the "Previous page" link to reflect the new last message index after
    // truncation.
    //
    // If there is no "Previous page" link and truncation occurred then we need to add
    // a "Previous page" link.
    if (didTruncateFromStart) {
        if (page.pagination?.previousLink) {
            const beforeMessageIndex = truncatedMessages[0]!.index;

            const paragraph = getAgentWebMessagingPagePreamblePaginationParagraph(responseTree);

            let link: PhrasingContent | undefined;

            if (!page.pagination?.nextLink) {
                link = paragraph.children[paragraph.children.length - 1];
            } else {
                link = paragraph.children[paragraph.children.length - 3];
            }

            assert(link?.type === "link");

            const linkStartOffset = assertExists(link.position?.start.offset);
            const linkEndOffset = assertExists(link.position?.end.offset);

            truncatedResponse =
                truncatedResponse.slice(0, linkStartOffset) +
                truncatedResponse
                    .slice(linkStartOffset, linkEndOffset)
                    .replace(/\?before=(0|[1-9][0-9]*)/, `?before=${beforeMessageIndex}`) +
                truncatedResponse.slice(linkEndOffset);
        } else if (page.pagination?.nextLink || !didTruncateFromEnd) {
            assert(roomReferencePathname !== null);

            const beforeMessageIndex = truncatedMessages[0]!.index;

            if (!page.pagination?.nextLink) {
                const insertResult = insertAgentWebMessagingPagePreamblePaginationLink(
                    responseTree,
                    truncatedResponse,
                    `[${agentWebMessagingPreviousPageLinkTextWithEndArrow}](${roomReferencePathname}?before=${beforeMessageIndex})`,
                );
                truncatedResponse = insertResult.truncatedResponse;
            } else {
                const paragraph = getAgentWebMessagingPagePreamblePaginationParagraph(responseTree);
                const link = paragraph.children[paragraph.children.length - 1];
                assert(link?.type === "link");

                const linkStartOffset = assertExists(link.position?.start.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, linkStartOffset) +
                    `[${agentWebMessagingPreviousPageLinkTextWithStartArrow}](${roomReferencePathname}?before=${beforeMessageIndex}) | ` +
                    truncatedResponse.slice(linkStartOffset);
            }
        }
    }

    return {
        truncatedResponse,
        truncatedMetadata: {
            // If we truncated some messages from the start even if we were at the start we're
            // definitely not at the start now.
            isStartOfMessages: !didTruncateFromStart && isStartOfMessages,
            // If we truncated some messages from the end even if we were at the end we're
            // definitely not at the end now.
            isEndOfMessages: !didTruncateFromEnd && isEndOfMessages,
            messages: truncatedMessages,
        },
    };
}

function getAgentWebMessagingPagePreamblePaginationParagraph(responseTree: Parent): Paragraph {
    const firstNode = responseTree.children[0] as RootContent | undefined;
    if (firstNode?.type === "paragraph") return firstNode;

    assert(firstNode?.type === "heading");

    const paginationParagraph = responseTree.children[1] as RootContent | undefined;
    assert(paginationParagraph?.type === "paragraph");
    return paginationParagraph;
}

function insertAgentWebMessagingPagePreamblePaginationLink(
    responseTree: Parent,
    truncatedResponse: string,
    linkMarkdown: string,
): {
    truncatedResponse: string;
    linkStartOffset: number;
    paragraphEndOffset: number;
} {
    const firstNode = responseTree.children[0] as RootContent | undefined;
    assert(firstNode?.type === "paragraph" || firstNode?.type === "heading");

    const insertionOffset = assertExists(firstNode.position?.end.offset);
    const prefix = firstNode.type === "paragraph" ? " " : "\n\n";
    const linkStartOffset = insertionOffset + prefix.length;
    const paragraphEndOffset = linkStartOffset + linkMarkdown.length;

    return {
        truncatedResponse:
            truncatedResponse.slice(0, insertionOffset) +
            prefix +
            linkMarkdown +
            truncatedResponse.slice(insertionOffset),
        linkStartOffset,
        paragraphEndOffset,
    };
}
