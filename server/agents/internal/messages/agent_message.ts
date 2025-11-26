import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {RootContent} from "mdast";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {printAgentContentToMarkdownTree} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {visitApiContent} from "~/server/agents/internal/visit_api_content.js";
import {
    ApiContent,
    ApiMessageContentPayloadResponse,
    ApiMessageResponse,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export class AgentMessage {
    public readonly index: number;
    public readonly author: ApiMessageResponse["author"];
    public readonly createdTime: DateString;

    public readonly createdTimeZone: TimeZone;
    public readonly markdownContent: Array<RootContent>;

    public readonly content: ApiContent;

    private _tokenCount: number | null = null;

    private constructor(
        {
            index,
            author,
            createdTime,
            createdTimeZone,
            payload,
        }: {
            index: number;
            author: ApiMessageResponse["author"];
            createdTime: DateString;
            createdTimeZone: TimeZone;
            payload: ApiMessageContentPayloadResponse;
        },
        markdownContent: Array<RootContent>,
    ) {
        this.index = index;
        this.author = author;
        this.createdTime = createdTime;
        this.createdTimeZone = createdTimeZone;
        this.content = payload.content;
        this.markdownContent = markdownContent;
    }

    public static async new(
        transaction: DurableObjectTransactionInterface,
        message: {
            spaceId: SpaceId;
            index: number;
            author: ApiMessageResponse["author"];
            createdTime: DateString;
            createdTimeZone: TimeZone;
            payload: ApiMessageContentPayloadResponse;
        },
    ) {
        const markdownTree = await printAgentContentToMarkdownTree(
            transaction,
            message.payload.content,
            {
                spaceId: message.spaceId,
            },
        );

        return new AgentMessage(message, markdownTree.children);
    }

    public estimateTokenCount() {
        this._tokenCount ??= this._estimateTokenCount();
        return this._tokenCount;
    }

    private _estimateTokenCount() {
        const content = this.content;
        let tokenCount = 0;

        visitApiContent(content, {
            // NOTE(ifitzsimmons): This recurses through the current element and counts the
            // total number of tokens for the root and all children. A slight optimization
            // would be to break out of the recursion loop as soon as a child element pushes
            // the token count over the limit. However, we shouldn't do this unless we have a
            // really strong reason. As is, this would likely only come up for really large
            // tables (because it will visit every cell in the table) and the table would have
            // have to be pretty massive to make a meaningful difference.
            visitInlineElement: element => {
                switch (element.type) {
                    case "Text": {
                        tokenCount += countO200kBaseTokens(element.text);
                        break;
                    }
                    case "Mention": {
                        tokenCount += countO200kBaseTokens(element.title ?? "");
                        break;
                    }
                    case "Break": {
                        break;
                    }
                    default:
                        throw exhaustive(element);
                }
            },
        });

        return tokenCount;
    }
}
