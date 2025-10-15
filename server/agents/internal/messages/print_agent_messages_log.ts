import {differenceInHours} from "date-fns";
import escapeHtml from "escape-html";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";

/**
 * Prints messages to a log format that an LLM can use to understand a
 * conversation. Messages are separated by `<human>` and `<bot>` XML tags which
 * is structure an LLM can interpret.
 */
export function printAgentMessagesLog(messages: ReadonlyArray<AgentMessage>): string {
    let text = "";
    let lastMessage: AgentMessage | null = null;

    for (const message of messages) {
        const differenceInHoursFromLastMessage =
            lastMessage !== null
                ? differenceInHours(message.createdTime, lastMessage.createdTime)
                : 0;

        if (
            lastMessage !== null &&
            lastMessage.author.id === message.author.id &&
            differenceInHoursFromLastMessage < 1
        ) {
            text += "\n";
        } else {
            /* eslint-disable string-quotes */

            if (lastMessage !== null) {
                if (lastMessage.author.botId) {
                    text += "</bot>";
                } else {
                    text += "</human>";
                }

                text += "\n\n";
            }

            if (message.author.botId) {
                text += `<bot name="${escapeHtml(message.author.name)}"`;
            } else {
                text += `<human name="${escapeHtml(message.author.name)}"`;
            }

            // Include the time difference between this message and the last message. Since
            // it may be important context for the conversation. We don't include the time
            // (e.g. 12:51pm) or the date (e.g. 7/12/25) because those are time zone
            // dependent and we haven't made a choice on what time zone to use across all
            // the participants.
            if (differenceInHoursFromLastMessage >= 1) {
                if (differenceInHoursFromLastMessage < 24) {
                    text += ` time="${printPrettyNumber(
                        defaultLocale,
                        differenceInHoursFromLastMessage,
                        "hour",
                    )} later"`;
                } else {
                    const differenceInDaysFromLastMessage = Math.floor(
                        differenceInHoursFromLastMessage / 24,
                    );
                    text += ` time="${printPrettyNumber(
                        defaultLocale,
                        differenceInDaysFromLastMessage,
                        "day",
                    )} later"`;
                }
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

        lastMessage = message;
    }

    if (lastMessage !== null) {
        if (lastMessage.author.botId) {
            text += "</bot>";
        } else {
            text += "</human>";
        }

        text += "\n";
    }

    return text;
}
