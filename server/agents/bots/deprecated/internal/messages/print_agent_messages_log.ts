import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {differenceInHours, differenceInMinutes} from "date-fns";
import escapeHtml from "escape-html";
import {RootContent} from "mdast";
import {AgentMessage} from "~/server/agents/bots/deprecated/internal/messages/agent_message.js";
import {printAgentContentMarkdownTree} from "~/server/agents/bots/deprecated/internal/print_api_content_to_agent_markdown.js";
import {ApiMessageContentPayloadParent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {TimeZone, formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.open_source.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * When printing messages to the log, we'll group successive messages from the same
 * author that are less than 10 minutes apart into a single block. This object
 * helps us track the current message block while iterating over the messages.
 */
type MessageBlock = {
    readonly openingTag: string;
    readonly closingTag: string;
    readonly messages: Array<AgentMessage>;
    readonly authorId: AccountId;
    readonly formattedTimeZone: string;
    lastMessageTime: Date;
};

/**
 * Prints messages to a log format that an LLM can use to understand a
 * conversation. Messages are separated by `<human>` and `<bot>` XML tags which is
 * structure an LLM can interpret.
 *
 * If `contextTimeZone` is provided, user messages with a different timezone will
 * have a `timezone` attribute added to their tag.
 */
export function printAgentMessagesLog(
    messages: ReadonlyArray<AgentMessage>,
    /**
     * The time and timezone of the user whose message triggered the durable object
     * creation.
     */
    timeContext: {
        time: Date;
        timeZone: TimeZone;
    },
): string {
    const markdownTree = printAgentMessagesIntoMarkdownTree(messages, timeContext);
    return printAgentContentMarkdownTree({type: "root", children: markdownTree});
}

export function printAgentMessagesIntoMarkdownTree(
    messages: ReadonlyArray<AgentMessage>,
    /**
     * The time and timezone of the user whose message triggered the durable object
     * creation.
     */
    timeContext: {
        time: Date;
        timeZone: TimeZone;
    },
): Array<RootContent> {
    const children: Array<RootContent> = [];
    const conversationFormattedTimeZone = formatTimeZoneAbbreviation(
        timeContext.timeZone,
        timeContext.time,
    );

    let currentBlock: MessageBlock | null = null;
    let previousTimeInjectionTime: Date | null = null;

    for (const message of messages) {
        const currentMessageTime = deserializeDateString(message.createdTime);
        const currentMessageFormattedTimeZone = formatTimeZoneAbbreviation(
            message.createdTimeZone,
            currentMessageTime,
        );

        const differenceInMinutesSinceLastMessage =
            currentBlock !== null
                ? differenceInMinutes(currentMessageTime, currentBlock.lastMessageTime)
                : 0;

        // If there are consecutive messages from the same author, we put them within the
        // same <human> or <bot> tag IF:
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
            message.parent === null &&
            currentBlock !== null &&
            currentBlock.authorId === message.author.id &&
            currentBlock.formattedTimeZone === currentMessageFormattedTimeZone &&
            differenceInMinutesSinceLastMessage < 10 &&
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
            currentBlock.lastMessageTime = currentMessageTime;
            continue;
        }

        // Flush the previous block before starting a new one
        flushCurrentBlock();

        // Inject time tag if needed
        if (
            previousTimeInjectionTime === null ||
            differenceInHours(message.createdTime, previousTimeInjectionTime) >= 1
        ) {
            const currentMessageDate = toCalendarDate(
                parseAbsolute(message.createdTime, timeContext.timeZone),
            );

            const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                defaultLocale,
                timeContext.timeZone,
                currentMessageDate,
                currentMessageTime,
                {withLongMonth: true},
            );
            previousTimeInjectionTime = currentMessageTime;
            children.push({
                type: "html",
                value: `<time>${formattedTime} ${conversationFormattedTimeZone}</time>`,
            });
        }

        // Build opening tag with attributes
        let openingTag = "";
        if (message.author.bot) {
            openingTag += `<bot name="${escapeHtml(message.author.name)}"`;
        } else {
            openingTag += `<human name="${escapeHtml(message.author.name)}"`;
        }

        // Include the time difference between this message and the last message. Since it
        // may be important context for the conversation. Whenever messages are more than
        // an hour apart, we inject a `<time/>` tag with the time of the message. The first
        // message after the time injection should never have a relative time. Because we
        // inject the current time between messages that are further than an hour apart,
        // the relative time between two messages between time injection tags will never
        // exceed 1 hour.
        if (
            currentMessageTime.getTime() !== previousTimeInjectionTime?.getTime() &&
            differenceInMinutesSinceLastMessage >= 10
        ) {
            openingTag += ` time="${printPrettyNumber(
                defaultLocale,
                differenceInMinutesSinceLastMessage,
                "minute",
            )} later"`;
        }

        // Include timezone attribute for users whose timezone differs from the context
        // timezone
        if (
            !message.author.bot &&
            currentMessageFormattedTimeZone !== conversationFormattedTimeZone
        ) {
            const timeZoneAbbreviation = formatTimeZoneAbbreviation(
                message.createdTimeZone,
                currentMessageTime,
            );
            openingTag += ` timezone="${escapeHtml(timeZoneAbbreviation)}"`;
        }

        openingTag += ">";

        currentBlock = {
            openingTag,
            closingTag: message.author.bot ? "</bot>" : "</human>",
            messages: [message],
            authorId: message.author.id,
            lastMessageTime: currentMessageTime,
            formattedTimeZone: currentMessageFormattedTimeZone,
        };
    }

    // Flush any remaining block
    flushCurrentBlock();

    return children;

    function flushCurrentBlock() {
        if (currentBlock === null) return;

        assert(currentBlock.messages.length > 0);

        children.push({
            type: "html",
            value: currentBlock.openingTag,
        });

        for (const message of currentBlock.messages) {
            for (const element of getMessageParentHtml(message.parent)) {
                if (element === null) continue;

                children.push(element);
            }

            for (const elements of message.markdownContent) {
                children.push(elements);
            }
        }

        children.push({type: "html", value: currentBlock.closingTag});
        currentBlock = null;
    }
}

function* getMessageParentHtml(
    parent: (ApiMessageContentPayloadParent & {markdownContent: Array<RootContent>}) | null,
): IterableIterator<RootContent | null> {
    if (parent === null) return null;

    yield {type: "html", value: `<blockquote cite="${escapeHtml(parent.author.name)}">`};

    for (const element of parent.markdownContent.slice(0, -1)) {
        yield element;
    }

    const lastElement = parent.markdownContent[parent.markdownContent.length - 1]!;

    if (!parent.contentSnippet.isTruncated) {
        yield lastElement;
    } else {
        const truncatedTextElement = {type: "text", value: " […]"} as const;

        if (lastElement.type === "paragraph") {
            lastElement.children.push(truncatedTextElement);
            yield lastElement;
        } else {
            yield {type: "paragraph", children: [truncatedTextElement]};
        }
    }

    yield {type: "html", value: "</blockquote>"};
}
