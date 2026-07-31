import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {RootContent} from "mdast";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/bots/deprecated/internal/print_api_content_to_agent_markdown.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {
    ApiContent,
    ApiMessageContentPayloadParentResponse,
    ApiMessageContentPayloadResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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

    public readonly parent:
        | (ApiMessageContentPayloadParentResponse & {markdownContent: Array<RootContent>})
        | null;

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
        parent:
            | (ApiMessageContentPayloadParentResponse & {markdownContent: Array<RootContent>})
            | null,
    ) {
        this.index = index;
        this.author = author;
        this.createdTime = createdTime;
        this.createdTimeZone = createdTimeZone;
        this.content = payload.content;
        this.markdownContent = markdownContent;
        this.parent = parent;
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
        const [markdownTree, parentWithMarkdownContent] = await runAllPromises([
            printApiContentToAgentMarkdownTree(transaction, message.payload.content),
            (async () => {
                if (!message.payload.parent) return null;

                const {parent} = message.payload;

                const {children} = await printApiContentToAgentMarkdownTree(transaction, {
                    elements: [{type: "Paragraph", elements: parent.contentSnippet.elements}],
                });

                return {...parent, markdownContent: children};
            })(),
        ]);

        return new AgentMessage(message, markdownTree.children, parentWithMarkdownContent);
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
                        tokenCount += countO200kBaseTokens(element.reference.title ?? "");
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
