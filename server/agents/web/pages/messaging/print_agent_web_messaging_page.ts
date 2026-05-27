import escapeHtml from "escape-html";
import {Link, PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createApiTargetAgentWebPageLink} from "~/server/agents/web/create_api_target_agent_web_page_link.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_link_pathname.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageMessageBlockParent,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiAccountTargetResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export const agentWebMessagingPreviousPageLinkTextWithEndArrow = "Previous page »";
export const agentWebMessagingPreviousPageLinkTextWithStartArrow = "« Previous page";
export const agentWebMessagingNextPageLinkText = "Next page »";

export async function printAgentWebMessagingPage<PageLink>(
    messageNouns: AgentWebMessagingPageNouns,
    storage: AgentWebSessionStorage,
    pageLink: PageLink,
    page: AgentWebMessagingPage,
): Promise<Root> {
    const children: Array<RootContent> = [];

    const [, blocks] = await runAllPromises([
        (async () => {
            const [, paginationLinks] = await runAllPromises([
                (async () => {
                    if (page.preamble.elements.length === 0) return;

                    const preambleTree = await printApiContentToAgentWebMarkdownTree(storage, {
                        elements: [{type: "Paragraph", elements: page.preamble.elements}],
                    });

                    for (const node of preambleTree.children) {
                        children.push(node);
                    }
                })(),
                (async () => {
                    const pagination = page.preamble.pagination;
                    if (!pagination) return [];

                    const pageLink = createApiTargetAgentWebPageLink(pagination.target);
                    const pathname = await createAgentWebPageLinkPathname(storage, pageLink);

                    const paginationLinks: Array<PhrasingContent> = [];

                    if (pagination.previousLink) {
                        paginationLinks.push({
                            type: "link",
                            url: `${pathname}?before=${pagination.previousLink.beforeMessageIndex}`,
                            children: [
                                {
                                    type: "text",
                                    value: pagination.nextLink
                                        ? agentWebMessagingPreviousPageLinkTextWithStartArrow
                                        : agentWebMessagingPreviousPageLinkTextWithEndArrow,
                                },
                            ],
                        });
                    }

                    if (pagination.previousLink && pagination.nextLink) {
                        paginationLinks.push({type: "text", value: " | "});
                    }

                    if (pagination.nextLink) {
                        paginationLinks.push({
                            type: "link",
                            url: `${pathname}?after=${pagination.nextLink.afterMessageIndex}`,
                            children: [
                                {
                                    type: "text",
                                    value: agentWebMessagingNextPageLinkText,
                                },
                            ],
                        });
                    }

                    return paginationLinks;
                })(),
            ]);

            if (paginationLinks.length > 0) {
                const lastChild = children[children.length - 1];

                if (lastChild?.type === "paragraph") {
                    lastChild.children.push({type: "text", value: " "}, ...paginationLinks);
                } else {
                    children.push({type: "paragraph", children: paginationLinks});
                }
            }
        })(),
        runAllPromises(
            page.blocks.map(async block => {
                if (block.type !== "Message") return block;

                // The order of calls in this function matters and needs to match the normalization
                // order in `normalizeAgentWebMessagingPage()`.
                const [authorPathname, parent, contentTree] = await runAllPromises([
                    createAgentWebPageLinkPathname(storage, block.author),
                    block.parent
                        ? runAllObjectPromises({
                              authorPathname: createAgentWebPageLinkPathname(
                                  storage,
                                  block.parent.author,
                              ),
                              previewContentTree: printApiContentToAgentWebMarkdownTree(
                                  storage,
                                  block.parent.previewContent,
                              ),
                          })
                        : null,
                    printApiContentToAgentWebMarkdownTree(storage, block.content),
                ]);

                return {
                    ...block,
                    authorPathname,
                    contentTree,
                    parent: block.parent ? {...block.parent, ...assertExists(parent)} : null,
                };
            }),
        ),
    ]);

    for (const block of blocks) {
        switch (block.type) {
            case "Time": {
                // This is the format our Markdown parser would return when parsing
                // `<time>test</time>`. Use the same format here when printing.
                children.push({
                    type: "paragraph",
                    children: [
                        {type: "html", value: "<time>"},
                        {type: "text", value: block.timeContent},
                        {type: "html", value: "</time>"},
                    ],
                });
                break;
            }
            case "Message": {
                const authorLink: Link = {
                    type: "link",
                    url: block.authorPathname,
                    children: [{type: "text", value: block.author.shortName}],
                };

                let openTag = `<${messageNouns.noun}`;

                if (block.idAttribute !== null) {
                    openTag += ` id="${printAgentWebMessagingPageMessageIndexRange(block.idAttribute)}"`;
                }

                openTag += ` from="${escapeHtml(printMarkdownTree(authorLink).trim())}"`;

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
                        value: `<blockquote cite="${escapeHtml(
                            printAgentWebMessagingPageParentCiteAttribute(
                                messageNouns,
                                block.parent.citeAttribute,
                            ),
                        )}">`,
                    });

                    for (const childNode of printAgentWebMessagingPageParentPreviewContentTree(
                        block.parent,
                    )) {
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
                    value: `</${messageNouns.noun}>`,
                });
                break;
            }
            default:
                throw exhaustive(block);
        }
    }

    if (page.isEndOfMessages) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: `End of ${messageNouns.pluralNoun}.`}],
        });
    }

    return {type: "root", children};
}

function printAgentWebMessagingPageMessageIndexRange({
    startMessageIndex,
    endMessageIndex,
}: AgentWebMessagingPageMessageRange): string {
    const endMessageIndexInclusive = endMessageIndex - 1;

    assert(startMessageIndex >= 0);
    assert(Number.isInteger(startMessageIndex));

    assert(endMessageIndexInclusive >= 0);
    assert(Number.isInteger(endMessageIndexInclusive));

    if (startMessageIndex === endMessageIndexInclusive) {
        return `${startMessageIndex}`;
    }

    return `${startMessageIndex}-${endMessageIndexInclusive}`;
}

function printAgentWebMessagingPageParentCiteAttribute(
    messageNouns: AgentWebMessagingPageNouns,
    citeAttribute: AgentWebMessagingPageMessageBlockParent["citeAttribute"],
): string {
    return `?${messageNouns.noun}=${printAgentWebMessagingPageMessageIndexRange(citeAttribute)}`;
}

function printAgentWebMessagingPageParentPreviewContentTree(parent: {
    author: ApiAccountTargetResponse;
    authorPathname: string;
    previewContentTree: Root;
}): ReadonlyArray<RootContent> {
    const authorLink: Link = {
        type: "link",
        url: parent.authorPathname,
        children: [{type: "text", value: parent.author.shortName}],
    };

    const firstChild = parent.previewContentTree.children[0];

    if (firstChild?.type === "paragraph") {
        return [
            {
                ...firstChild,
                children: [authorLink, {type: "text", value: ": "}, ...firstChild.children],
            },
            ...parent.previewContentTree.children.slice(1),
        ];
    }

    return [
        {
            type: "paragraph",
            children: [authorLink, {type: "text", value: ":"}],
        },
        ...parent.previewContentTree.children,
    ];
}
