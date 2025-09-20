import {differenceInHours} from "date-fns";
import escapeHtml from "escape-html";
import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {printAgentContentToMarkdown} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {
    ApiMessage,
    ApiMessageContentPayload,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {DateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export class AgentMessage {
    public readonly index: number;
    public readonly author: ApiMessage["author"];
    public readonly createdTime: DateString;
    public readonly text: string;
    private _tokenCount: number | null = null;

    private constructor(
        {
            index,
            author,
            createdTime,
        }: {
            index: number;
            author: ApiMessage["author"];
            createdTime: DateString;
        },
        text: string,
    ) {
        this.index = index;
        this.author = author;
        this.createdTime = createdTime;
        this.text = text;
    }

    public static async new(
        transaction: DurableObjectTransactionInterface,
        message: {
            spaceId: SpaceId;
            index: number;
            author: ApiMessage["author"];
            createdTime: DateString;
            payload: ApiMessageContentPayload;
        },
    ) {
        const text = await printAgentContentToMarkdown(transaction, message.payload.content, {
            spaceId: message.spaceId,
        });

        return new AgentMessage(message, text);
    }

    public getTokenCount() {
        this._tokenCount ??= countO200kBaseTokens(this.text);
        return this._tokenCount;
    }
}

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
