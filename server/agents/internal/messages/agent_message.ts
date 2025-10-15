import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {printAgentContentToMarkdown} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {
    ApiMessage,
    ApiMessageContentPayload,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {DateString} from "~/shared/helpers/date/date_string.js";
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
