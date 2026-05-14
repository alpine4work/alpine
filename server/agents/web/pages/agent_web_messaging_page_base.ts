import escapeHtml from "escape-html";
import {Root, RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export type AgentWebMessagingPageBase = {
    readonly blocks: ReadonlyArray<AgentWebMessagingPageBlock>;
};

export type AgentWebMessagingPageBlock =
    | AgentWebMessagingPageTimeBlock
    | AgentWebMessagingPageMessageBlock;

export type AgentWebMessagingPageTimeBlock = {
    readonly type: "Time";
    readonly timeContent: string;
};

export type AgentWebMessagingPageMessageBlock = {
    readonly type: "Message";
    readonly tagName: "human" | "bot";
    readonly authorName: string;
    readonly timeAttribute: string | null;
    readonly timeZoneAttribute: string | null;
    readonly parent: {
        readonly authorName: string;
        readonly previewContent: ApiContentResponse;
    } | null;
    readonly content: ApiContentResponse;
};

export async function printAgentWebMessagingPageBase(
    storage: AgentWebSessionStorage,
    pageLink: null,
    page: AgentWebMessagingPageBase,
): Promise<Root> {
    const children: Array<RootContent> = [];

    const blocks = await runAllPromises(
        page.blocks.map(async block => {
            if (block.type !== "Message") return block;

            const [contentTree, previewContentTree] = await runAllPromises([
                printApiContentToAgentWebMarkdownTree(storage, block.content),
                block.parent
                    ? printApiContentToAgentWebMarkdownTree(storage, block.parent.previewContent)
                    : null,
            ]);

            return {
                ...block,
                contentTree,
                parent: block.parent
                    ? {...block.parent, previewContentTree: assertExists(previewContentTree)}
                    : null,
            };
        }),
    );

    for (const block of blocks) {
        switch (block.type) {
            case "Time": {
                children.push({
                    type: "html",
                    value: `<time>${escapeHtml(block.timeContent)}</time>`,
                });
                break;
            }
            case "Message": {
                let openTag = `<${block.tagName} name="${escapeHtml(block.authorName)}"`;

                if (block.timeAttribute !== null) {
                    openTag += ` time="${escapeHtml(block.timeAttribute)}"`;
                }

                if (block.timeZoneAttribute !== null) {
                    openTag += ` timezone="${escapeHtml(block.timeZoneAttribute)}"`;
                }

                openTag += ">";

                children.push({
                    type: "html",
                    value: openTag,
                });

                if (block.parent !== null) {
                    children.push({
                        type: "html",
                        value: `<blockquote cite="${escapeHtml(block.parent.authorName)}">`,
                    });

                    for (const childNode of block.parent.previewContentTree.children) {
                        children.push(childNode);
                    }

                    children.push({
                        type: "html",
                        value: "</blockquote>",
                    });
                }

                for (const childNode of block.contentTree.children) {
                    children.push(childNode);
                }

                children.push({
                    type: "html",
                    value: `</${block.tagName}>`,
                });
                break;
            }
            default:
                throw exhaustive(block);
        }
    }

    return {type: "root", children};
}

export async function parseAgentWebMessagingPageBase(
    storage: AgentWebSessionStorage,
    pageLink: null,
    root: Root,
): Promise<AgentWebMessagingPageBase> {
    const blocks: Array<AgentWebMessagingPageBlock> = [];

    return {blocks};
}
