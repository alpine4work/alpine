import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {differenceInHours, differenceInMinutes} from "date-fns";
import escapeHtml from "escape-html";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone, formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";

/**
 * Prints messages to a log format that an LLM can use to understand a
 * conversation. Messages are separated by `<human>` and `<bot>` XML tags which
 * is structure an LLM can interpret.
 *
 * If `contextTimeZone` is provided, user messages with a different timezone will
 * have a `timezone` attribute added to their tag.
 */
export function printAgentMessagesLog(
    messages: ReadonlyArray<AgentMessage>,
    /**
     * The time and timezone of the user whose message triggered the durable object creation.
     */
    timeContext: {
        time: Date;
        timeZone: TimeZone;
    },
): string {
    let text = "";
    const conversationFormattedTimeZone = formatTimeZoneAbbreviation(
        timeContext.timeZone,
        timeContext.time,
    );
    let previous: {
        message: AgentMessage;
        formattedTimeZone: string;
    } | null = null;
    let previousTimeInjectionTime: Date | null = null;

    for (const message of messages) {
        const currentMessageTime = deserializeDateString(message.createdTime);
        const currentMessageFormattedTimeZone = formatTimeZoneAbbreviation(
            message.createdTimeZone,
            currentMessageTime,
        );

        const differenceInMinutesSinceLastMessage =
            previous !== null
                ? differenceInMinutes(message.createdTime, previous.message.createdTime)
                : 0;

        // If there are consecutive messages from the same author, we put them
        // within the same <human> or <bot> tag IF:
        // 1. They're less than 1 hour apart.
        // 2. The author did not switch timezones.
        //
        // Importantly, a user can change Olson Timezones without changing the actual
        // standardized timezone. e.g. America/New_York and America/Toronto both format to
        // EST, so we shouldn't show the timezone attribute if a user takes a flight from
        // NYC to Toronto.
        if (
            previous !== null &&
            previous.message.author.id === message.author.id &&
            previous.formattedTimeZone === currentMessageFormattedTimeZone &&
            differenceInMinutesSinceLastMessage < 10
        ) {
            text += "\n";
        } else {
            /* eslint-disable string-quotes */

            if (previous && previous.message !== null) {
                if (previous.message.author.botId) {
                    text += "</bot>";
                } else {
                    text += "</human>";
                }

                text += "\n\n";
            }

            if (
                previousTimeInjectionTime === null ||
                differenceInHours(message.createdTime, previousTimeInjectionTime) >= 1
            ) {
                const currentMessageTime = deserializeDateString(message.createdTime);
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
                text += `<time>${formattedTime} ${conversationFormattedTimeZone}</time>`;
                text += "\n\n";
            }

            if (message.author.botId) {
                text += `<bot name="${escapeHtml(message.author.name)}"`;
            } else {
                text += `<human name="${escapeHtml(message.author.name)}"`;
            }

            // Include the time difference between this message and the last message. Since
            // it may be important context for the conversation. Whenever messages are more
            // than an hour apart, we inject a `<time/> tag with the time of the message.
            // The first message after the time injection should never have a relative time.
            // Because we inject the current time between messages that are further than an hour
            // apart, the relative time between two messages between time injection tags will
            // never exceed 1 hour.
            if (
                currentMessageTime.getTime() !== previousTimeInjectionTime?.getTime() &&
                differenceInMinutesSinceLastMessage >= 10
            ) {
                text += ` time="${printPrettyNumber(
                    defaultLocale,
                    differenceInMinutesSinceLastMessage,
                    "minute",
                )} later"`;
            }

            // Include timezone attribute for users whose timezone differs from the context
            // timezone
            if (
                !message.author.botId &&
                currentMessageFormattedTimeZone !== conversationFormattedTimeZone
            ) {
                const timeZoneAbbreviation = formatTimeZoneAbbreviation(
                    message.createdTimeZone,
                    currentMessageTime,
                );
                text += ` timezone="${escapeHtml(timeZoneAbbreviation)}"`;
            }

            text += ">\n";

            /* eslint-enable string-quotes */
        }

        // Trim trailing newline.
        if (message.text.endsWith("\n")) {
            text += message.text.slice(0, -1);
        } else {
            text += message.text;
        }

        text += "\n";

        previous = {
            message,
            formattedTimeZone: currentMessageFormattedTimeZone,
        };
    }

    if (previous && previous.message !== null) {
        if (previous.message.author.botId) {
            text += "</bot>";
        } else {
            text += "</human>";
        }

        text += "\n";
    }

    return text;
}
