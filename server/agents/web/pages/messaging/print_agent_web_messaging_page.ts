import escapeHtml from "escape-html";
import {Link, PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageCustomBlockBase,
    AgentWebMessagingPageMessageBlockParent,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {isAgentWebMessagingPageEndOfMessagesParagraph} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.js";

export const agentWebMessagingPreviousPageLinkTextWithEndArrow = "Previous page »";
export const agentWebMessagingPreviousPageLinkTextWithStartArrow = "« Previous page";
export const agentWebMessagingNextPageLinkText = "Next page »";

export async function printAgentWebMessagingPage<
    PageLink,
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    storage: AgentWebSessionStorage,
    pageLink: PageLink,
    page: AgentWebMessagingPage<Preamble, CustomBlock>,
    {
        messageNouns,
        printPreamble,
        printCustomBlock,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        printPreamble: (storage: AgentWebSessionStorage, preamble: Preamble) => Promise<Root>;
        printCustomBlock: (
            storage: AgentWebSessionStorage,
            customBlock: CustomBlock,
        ) => Promise<Root>;
    },
): Promise<Root> {
    const children: Array<RootContent> = [];

    const [, blocks] = await runAllPromises([
        (async () => {
            const [, paginationLinks] = await runAllPromises([
                (async () => {
                    const preambleTree = await printPreamble(storage, page.preamble);

                    // Safety check: if the printed preamble contains a `<message>` HTML tag then that
                    // will confuse `parseAgentWebMessagingPage()` which will interpret it as the start
                    // of message markdown and not a part of the preamble.
                    const traverse = (node: RootContent) => {
                        if (
                            node.type === "html" &&
                            hasHtmlOpenTag(
                                node.value,
                                tagName => tagName === messageNouns.noun || tagName === "time",
                            )
                        ) {
                            throw new InternalError(
                                `Printed preamble must not include \`<${messageNouns.noun}>\` tags or else parsing will fail`,
                            );
                        }

                        if ("children" in node) {
                            for (const childNode of node.children) {
                                traverse(childNode);
                            }
                        }
                    };

                    for (const node of preambleTree.children) {
                        children.push(node);

                        traverse(node);

                        // Safety check: if the printed preamble contains the paragraph `End of messages`
                        // then that will confuse `parseAgentWebMessagingPage()` which will interpret it as
                        // the start/end of messages markdown.
                        if (isAgentWebMessagingPageEndOfMessagesParagraph(messageNouns, node)) {
                            throw new InternalError(
                                "Printed preamble must not include \u201CEnd of messages\u201D marker",
                            );
                        }
                    }

                    // Safety check: if the printed preamble ends with a "Next page" link then that
                    // will confuse `parseAgentWebMessagingPage()` which will interpret that "Next
                    // page" link as a part of the pagination link and not a part of the preamble.
                    const lastParagraphIndex =
                        findAgentWebMessagingPagePaginationParagraphIndex(children);
                    if (lastParagraphIndex !== null) {
                        const lastNode = children[lastParagraphIndex]!;
                        assert(lastNode.type === "paragraph");

                        const lastChildIndex = lastNode.children.length - 1;
                        const lastChild = lastNode.children[lastChildIndex];
                        if (lastChild?.type === "link") {
                            const text = printMarkdownPhrasingContentText(lastChild.children);

                            if (
                                text === agentWebMessagingPreviousPageLinkTextWithStartArrow ||
                                text === agentWebMessagingPreviousPageLinkTextWithEndArrow ||
                                text === agentWebMessagingNextPageLinkText
                            ) {
                                throw new InternalError(
                                    "Printed preamble must not end with a pagination link or else parsing will fail",
                                );
                            }
                        }
                    }
                })(),
                (async () => {
                    const pagination = page.pagination;
                    if (!pagination) return [];

                    const pathname = await createAgentWebPageLinkPathname(
                        storage,
                        pagination.pageLink,
                    );

                    const paginationLinks: Array<PhrasingContent> = [];

                    if (pagination.previousLink) {
                        paginationLinks.push({
                            type: "link",
                            url: `${pathname}?before=${pagination.previousLink.type === "Message" ? pagination.previousLink.beforeMessageIndex : pagination.previousLink.beforeTagName}`,
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
                            url: `${pathname}?after=${pagination.nextLink.type === "Message" ? pagination.nextLink.afterMessageIndex : pagination.nextLink.afterTagName}`,
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
                const lastParagraphIndex =
                    findAgentWebMessagingPagePaginationParagraphIndex(children);

                if (lastParagraphIndex !== null) {
                    const lastNode = children[lastParagraphIndex]!;
                    assert(lastNode.type === "paragraph");
                    lastNode.children.push({type: "text", value: " "}, ...paginationLinks);
                } else {
                    children.push({type: "paragraph", children: paginationLinks});
                }
            }
        })(),
        runAllPromises(
            page.blocks.map(async block => {
                switch (block.type) {
                    case "Time": {
                        return block;
                    }
                    case "Message": {
                        // The order of calls in this function matters and needs to match the normalization
                        // order in `normalizeAgentWebMessagingPage()`.
                        const [authorPathname, parent, contentTree] = await runAllPromises([
                            block.author
                                ? createAgentWebPageStoredLinkPathname(storage, block.author)
                                : null,
                            block.parent
                                ? runAllObjectPromises({
                                      authorPathname: createAgentWebPageStoredLinkPathname(
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

                        const printedParent = block.parent
                            ? {...block.parent, ...assertExists(parent)}
                            : null;

                        return {
                            ...block,
                            authorPathname,
                            contentTree,
                            parent: printedParent,
                        };
                    }
                    case "Custom": {
                        if (!printCustomBlock) {
                            throw new InternalError(
                                "Can\u2019t print custom messaging page block without `printCustomBlock`",
                            );
                        }

                        const customTree = await printCustomBlock(storage, block);

                        const regExp = new RegExp(`^<${escapeRegExp(block.tagName)}(?: |>)`);

                        // Make sure `block.tagName` is accurate and used to open the custom printed tree.
                        assert(
                            (customTree.children[0]?.type === "html" &&
                                regExp.test(customTree.children[0].value)) ||
                                (customTree.children[0]?.type === "paragraph" &&
                                    customTree.children[0].children[0]?.type === "html" &&
                                    regExp.test(customTree.children[0].children[0].value)),
                        );

                        return {
                            ...block,
                            customTree,
                        };
                    }
                    default:
                        throw exhaustive(block);
                }
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
                let openTag = `<${messageNouns.noun}`;

                if (block.idAttribute !== null) {
                    openTag += ` id="${printAgentWebMessagingPageMessageIndexRange(block.idAttribute)}"`;
                }

                if (block.author !== null) {
                    const authorLink: Link = {
                        type: "link",
                        url: assertExists(block.authorPathname),
                        children: [{type: "text", value: block.author.shortName}],
                    };

                    openTag += ` from="${escapeHtml(printMarkdownTree(authorLink).trim())}"`;
                }

                if (block.deletedAttribute !== null) {
                    openTag += " deleted";
                }

                if (block.timeAttribute !== null) {
                    openTag += ` time="${escapeHtml(block.timeAttribute)}"`;
                }

                if (block.timeZoneAttribute !== null) {
                    openTag += ` timezone="${escapeHtml(block.timeZoneAttribute)}"`;
                }

                if (block.deletedAttribute !== null) {
                    children.push({
                        type: "html",
                        value: `${openTag}></${messageNouns.noun}>`,
                    });
                    break;
                }

                openTag += ">";

                children.push({
                    type: "html",
                    value: openTag,
                });

                if (block.parent !== null) {
                    let blockquoteOpenTag = `<blockquote cite="${escapeHtml(
                        printAgentWebMessagingPageParentCiteAttribute(
                            messageNouns,
                            block.parent.citeAttribute,
                        ),
                    )}"`;

                    if (block.parent.matchAttribute !== null) {
                        blockquoteOpenTag += ` match="${block.parent.matchAttribute}"`;
                    }

                    blockquoteOpenTag += ">";

                    children.push({
                        type: "html",
                        value: blockquoteOpenTag,
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
            case "Custom": {
                for (const childNode of block.customTree.children) {
                    children.push(childNode);
                }
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

function findAgentWebMessagingPagePaginationParagraphIndex(
    children: ReadonlyArray<RootContent>,
): number | null {
    for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index]!;

        if (child.type === "list") continue;
        if (child.type === "paragraph") return index;

        return null;
    }

    return null;
}

export function printAgentWebMessagingPageMessageIndexRange({
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
    author: ApiAccountReferenceResponse;
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
