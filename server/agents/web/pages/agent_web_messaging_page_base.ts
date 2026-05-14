import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, Node, Root, RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {Replace} from "~/shared/helpers/types/replace.js";

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
    readonly nameAttribute: string;
    readonly timeAttribute: string | null;
    readonly timeZoneAttribute: string | null;
    readonly parent: {
        readonly nameAttribute: string;
        readonly previewContent: ApiContentResponse;
    } | null;
    readonly content: ApiContentResponse;
};

type AgentWebMessagingPageNouns = {
    readonly noun: string;
    readonly pluralNoun: string;
    readonly startOfSentenceNoun: string;
    readonly startOfSentencePluralNoun: string;
};

export const agentWebMessagingPageMessageNouns: AgentWebMessagingPageNouns = {
    noun: "message",
    pluralNoun: "messages",
    startOfSentenceNoun: "Message",
    startOfSentencePluralNoun: "Messages",
};

export const agentWebMessagingPageCommentNouns: AgentWebMessagingPageNouns = {
    noun: "comment",
    pluralNoun: "comments",
    startOfSentenceNoun: "Comment",
    startOfSentencePluralNoun: "Comments",
};

export async function printAgentWebMessagingPageBase(
    messageNouns: AgentWebMessagingPageNouns,
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
                let openTag = `<${block.tagName} name="${escapeHtml(block.nameAttribute)}"`;

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
                        value: `<blockquote cite="${escapeHtml(block.parent.nameAttribute)}">`,
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
    messageNouns: AgentWebMessagingPageNouns,
    storage: AgentWebSessionStorage,
    pageLink: null,
    root: Root,
): Promise<AgentWebMessagingPageBase> {
    const blockPromises: Array<MaybePromise<AgentWebMessagingPageBlock>> = [];

    let state: {
        tagName: "human" | "bot";
        openTagPosition: Node["position"];
        hasEndedOpenTag: boolean;
        startedAttribute: "name" | "time" | "timezone" | null;
        nameAttribute: string | null;
        timeAttribute: string | null;
        timeZoneAttribute: string | null;
        parent: {
            openTagPosition: Node["position"];
            hasEndedOpenTag: boolean;
            hasCloseTag: boolean;
            startedAttribute: "cite" | null;
            nameAttribute: string | null;
            children: Array<RootContent>;
        } | null;
        children: Array<RootContent>;
    } | null = null;

    const parseHtml = (node: Html) => {
        let hasUnknownHtml = false;
        let firstHtmlTextIndex: number | null = null;
        let handledHtml: {tagName: string; tagType: "open" | "close"} | null = null;

        const tokenizer = new HtmlTokenizer(
            {},
            {
                onopentagname: (start, end) => {
                    const tagName = node.value.slice(start, end).toLowerCase();

                    switch (tagName) {
                        case "human":
                        case "bot": {
                            if (state) {
                                throw new InvalidArgumentError("Invalid message element open tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t open a new \`<${tagName}>\` element on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open \`<${state.tagName}>\` element and you can\u2019t nest ${messageNouns.noun} elements.`,
                                });
                            }

                            state = {
                                tagName,
                                openTagPosition: node.position,
                                hasEndedOpenTag: false,
                                startedAttribute: null,
                                nameAttribute: null,
                                timeAttribute: null,
                                timeZoneAttribute: null,
                                parent: null,
                                children: [],
                            };

                            handledHtml ??= {tagName, tagType: "open"};
                            break;
                        }
                        case "blockquote": {
                            // Special case error for nested `<blockquote>`s with a more specific error
                            // message.
                            if (state?.parent && !state.parent.hasCloseTag) {
                                throw new InvalidArgumentError(
                                    "Invalid parent element open tag (another parent tag was already opened)",
                                    {
                                        displayMessage: errorDisplayMessage`Can\u2019t open a new \`<blockquote>\` element on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open \`<blockquote>\` element and you can\u2019t nest \`<blockquote>\` elements. If you\u2019re trying to reply to a ${messageNouns.noun} that itself is replying to another ${messageNouns.noun} then just include the content of the ${messageNouns.noun} you\u2019re replying to and omit the extra \`<blockquote>\` element.`,
                                    },
                                );
                            }

                            if (!state || state.parent || state.children.length > 0) {
                                throw new InvalidArgumentError("Invalid parent element open tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t add \`<blockquote>\` element on line ${node.position?.start.line ?? "unknown"}. \`<blockquote>\` elements can only be used at the beginning of a \`<human>\` or \`<bot>\` ${messageNouns.noun} element to indicate that the ${messageNouns.noun} is a reply to some other ${messageNouns.noun}.`,
                                });
                            }

                            state.parent = {
                                openTagPosition: node.position,
                                hasEndedOpenTag: false,
                                hasCloseTag: false,
                                startedAttribute: null,
                                nameAttribute: null,
                                children: [],
                            };

                            handledHtml ??= {tagName, tagType: "open"};
                            break;
                        }
                        default: {
                            hasUnknownHtml = true;
                            break;
                        }
                    }
                },
                onopentagend: () => {
                    if (state) {
                        if (!state.hasEndedOpenTag) {
                            assert(!state.startedAttribute);
                            state.hasEndedOpenTag = true;
                        } else if (state.parent && !state.parent.hasEndedOpenTag) {
                            assert(!state.parent.startedAttribute);
                            state.parent.hasEndedOpenTag = true;
                        }
                    }
                },
                onclosetag: (start, end) => {
                    const tagName = node.value.slice(start, end).toLowerCase();

                    switch (tagName) {
                        case "human":
                        case "bot": {
                            if (!state || state.tagName !== tagName) {
                                throw new InvalidArgumentError(
                                    "Invalid message element close tag",
                                    {
                                        displayMessage: errorDisplayMessage`Can\u2019t close \`</${tagName}>\` element on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching \`<${tagName}>\` open tag.`,
                                    },
                                );
                            }

                            if (!state.hasEndedOpenTag || state.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            if (typeof state.nameAttribute !== "string") {
                                throw new InvalidArgumentError(
                                    "Message element is missing author name",
                                    {
                                        displayMessage: errorDisplayMessage`\`<${state.tagName}>\` element on line ${state.openTagPosition?.start.line ?? "unknown"} is missing the \`name\` attribute. All ${messageNouns.pluralNoun} must include the name of the author.`,
                                    },
                                );
                            }

                            if (state.parent && !state.parent.hasCloseTag) {
                                throw new InvalidArgumentError("Missing parent element close tag", {
                                    displayMessage: errorDisplayMessage`\`<blockquote>\` element on line ${state.parent.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a \`</blockquote>\` closing tag and try again.`,
                                });
                            }

                            const block: Replace<
                                Omit<AgentWebMessagingPageMessageBlock, "content">,
                                {
                                    parent: Omit<
                                        NonNullable<AgentWebMessagingPageMessageBlock["parent"]>,
                                        "previewContent"
                                    > | null;
                                }
                            > = {
                                type: "Message",
                                tagName: state.tagName,
                                nameAttribute: state.nameAttribute,
                                timeAttribute: state.timeAttribute,
                                timeZoneAttribute: state.timeZoneAttribute,
                                parent: null,
                            };

                            if (state.parent) {
                                if (typeof state.parent.nameAttribute !== "string") {
                                    throw new InvalidArgumentError(
                                        "Parent element is missing author name",
                                        {
                                            displayMessage: errorDisplayMessage`\`<blockquote>\` element on line ${state.openTagPosition?.start.line ?? "unknown"} is missing the \`cite\` attribute. Must include the name of the ${messageNouns.noun} author you\u2019re replying to.`,
                                        },
                                    );
                                }

                                block.parent = {
                                    nameAttribute: state.parent.nameAttribute,
                                };
                            }

                            const contentPromise = parseApiContentFromAgentWebMarkdownTree(
                                storage,
                                {type: "root", children: state.children},
                            );

                            const parentPreviewContentPromise = state.parent
                                ? parseApiContentFromAgentWebMarkdownTree(storage, {
                                      type: "root",
                                      children: state.parent.children,
                                  })
                                : null;

                            blockPromises.push(
                                runAllPromises([contentPromise, parentPreviewContentPromise]).then(
                                    ([content, parentPreviewContent]) => ({
                                        ...block,
                                        content,
                                        parent: block.parent
                                            ? {
                                                  ...block.parent,
                                                  previewContent:
                                                      assertExists(parentPreviewContent),
                                              }
                                            : null,
                                    }),
                                ),
                            );

                            state = null;
                            handledHtml ??= {tagName, tagType: "close"};
                            break;
                        }
                        case "blockquote": {
                            if (!state?.parent || state.parent.hasCloseTag) {
                                throw new InvalidArgumentError("Invalid parent element close tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t close \`</blockquote>\` element on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching \`<blockquote>\` open tag.`,
                                });
                            }

                            if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            state.parent.hasCloseTag = true;
                            handledHtml ??= {tagName, tagType: "close"};
                            break;
                        }
                        default: {
                            hasUnknownHtml = true;
                            break;
                        }
                    }
                },
                onselfclosingtag: () => {
                    hasUnknownHtml = true;
                },

                onattribname: (start, end) => {
                    if (state) {
                        const attributeName = node.value.slice(start, end).toLowerCase();

                        switch (attributeName) {
                            case "name": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "name";
                                    state.nameAttribute = "";
                                }
                                break;
                            }
                            case "time": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "time";
                                    state.timeAttribute = "";
                                }
                                break;
                            }
                            case "timezone": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "timezone";
                                    state.timeZoneAttribute = "";
                                }
                                break;
                            }
                            case "cite": {
                                if (state.parent && !state.parent.hasEndedOpenTag) {
                                    state.parent.startedAttribute = "cite";
                                    state.parent.nameAttribute = "";
                                }
                                break;
                            }
                        }
                    }
                },
                onattribdata: (start, end) => {
                    if (state) {
                        const attributeData = node.value.slice(start, end);

                        if (!state.hasEndedOpenTag) {
                            switch (state.startedAttribute) {
                                case "name": {
                                    state.nameAttribute += attributeData;
                                    break;
                                }
                                case "time": {
                                    state.timeAttribute += attributeData;
                                    break;
                                }
                                case "timezone": {
                                    state.timeZoneAttribute += attributeData;
                                    break;
                                }
                            }
                        } else if (state.parent && !state.parent.hasEndedOpenTag) {
                            switch (state.parent.startedAttribute) {
                                case "cite": {
                                    state.parent.nameAttribute += attributeData;
                                    break;
                                }
                            }
                        }
                    }
                },
                onattribentity: codepoint => {
                    if (state) {
                        const attributeData = String.fromCodePoint(codepoint);

                        if (!state.hasEndedOpenTag) {
                            switch (state.startedAttribute) {
                                case "name": {
                                    state.nameAttribute += attributeData;
                                    break;
                                }
                                case "time": {
                                    state.timeAttribute += attributeData;
                                    break;
                                }
                                case "timezone": {
                                    state.timeZoneAttribute += attributeData;
                                    break;
                                }
                            }
                        } else if (state.parent && !state.parent.hasEndedOpenTag) {
                            switch (state.parent.startedAttribute) {
                                case "cite": {
                                    state.parent.nameAttribute += attributeData;
                                    break;
                                }
                            }
                        }
                    }
                },
                onattribend: () => {
                    if (state) {
                        if (!state.hasEndedOpenTag && state.startedAttribute) {
                            state.startedAttribute = null;
                        } else if (
                            state.parent &&
                            !state.parent.hasEndedOpenTag &&
                            state.parent.startedAttribute
                        ) {
                            state.parent.startedAttribute = null;
                        }
                    }
                },

                // NOCOMMIT: Generative test!
                ontext: start => {
                    hasUnknownHtml = true;
                    firstHtmlTextIndex ??= start;
                },
                ontextentity: start => {
                    hasUnknownHtml = true;
                    firstHtmlTextIndex ??= start;
                },

                oncdata: noop,
                oncomment: noop,
                ondeclaration: noop,
                onprocessinginstruction: noop,
                onend: noop,
            },
        );

        tokenizer.write(node.value);
        tokenizer.end();

        // TypeScript doesn't realize that `handledHtml` here could be assigned by the
        // callbacks above annoyingly.
        handledHtml = handledHtml as any;

        // If this tokenizer state machine handled our HTML then don't add it to state
        // children. If there was any unknown HTML then we throw an error since we won't
        // have handled that unknown HTML.
        if (handledHtml) {
            if (hasUnknownHtml) {
                if (typeof firstHtmlTextIndex !== "number") {
                    throw createUnexpectedMarkdownError(messageNouns, node.position);
                } else {
                    const {tagName, tagType} = handledHtml;
                    const tag = tagType === "open" ? `<${tagName}>` : `</${tagName}>`;

                    let line = node.position?.start.line;

                    if (typeof line === "number") {
                        for (let i = 0; i <= firstHtmlTextIndex; i++) {
                            if (node.value[i] === "\n") {
                                line++;
                            }
                        }
                    }

                    throw new InvalidArgumentError(
                        "Unexpected text in the same HTML Markdown node as an open or close tag",
                        {
                            displayMessage: errorDisplayMessage`Must add an empty new line between the \`${tag}\` ${tagType} tag and Markdown text. Otherwise, due to a quirk in Markdown, the text on line ${line ?? "unknown"} will be parsed as HTML instead of Markdown. The \`<${tagName}>\` element must be formatted like this: \`<${tagName}>\\n\\n...\\n\\n</${tagName}>\`.`,
                        },
                    );
                }
            }
            return true;
        }

        return false;
    };

    for (let node of root.children) {
        if (node.type === "html" && parseHtml(node)) {
            continue;
        }

        if (node.type === "paragraph") {
            const timeBlock: AgentWebMessagingPageTimeBlock | null = (() => {
                if (state) return null;

                if (node.children.length < 2) return null;

                const firstChildNode = node.children[0]!;
                const lastChildNode = node.children[node.children.length - 1]!;

                if (firstChildNode.type !== "html") return null;
                if (lastChildNode.type !== "html") return null;

                // The Markdown parsing library we use parses open and close HTML tags as separate
                // nodes even when they're adjacent to each other which is nice.
                if (!hasHtmlOpenTag(firstChildNode.value, tagName => tagName === "time"))
                    return null;
                if (!hasHtmlCloseTag(lastChildNode.value, tagName => tagName === "time"))
                    return null;

                const otherChildNodes = node.children.slice(1, -1);

                return {
                    type: "Time",
                    timeContent: printMarkdownPhrasingContentText(otherChildNodes),
                };
            })();

            if (timeBlock) {
                blockPromises.push(timeBlock);
                continue;
            }

            let lastPushedIndex = 0;

            for (let index = 0; index < node.children.length; index++) {
                const childNode = node.children[index]!;
                if (childNode.type !== "html") continue;

                let childrenToPop: Array<Node> | undefined;

                // Pre-emptively try pushing a paragraph with everything except the HTML into our
                // state. If `parseHtml()` succeeds then the partial paragraph needs to be at the
                // end of our message content.
                if (lastPushedIndex < index) {
                    if (!state || !state.hasEndedOpenTag || state.startedAttribute) {
                        throw createUnexpectedMarkdownError(messageNouns, node.position);
                    }

                    if (state.parent && !state.parent.hasCloseTag) {
                        if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                            throw createUnexpectedMarkdownError(messageNouns, node.position);
                        }

                        state.parent.children.push({
                            type: "paragraph",
                            children: node.children.slice(lastPushedIndex, index),
                        });

                        childrenToPop = state.parent.children;
                    } else {
                        state.children.push({
                            type: "paragraph",
                            children: node.children.slice(lastPushedIndex, index),
                        });

                        childrenToPop = state.children;
                    }
                }

                if (parseHtml(childNode)) {
                    lastPushedIndex = index + 1;
                    continue;
                }

                // `parseHtml()` didn't succeed. Let's clean up the pre-emptive paragraph we
                // pushed.
                childrenToPop?.pop();
            }

            if (lastPushedIndex > 0) {
                // The paragraph is now empty, skip.
                if (lastPushedIndex >= node.children.length) continue;

                node = {
                    type: "paragraph",
                    children: node.children.slice(lastPushedIndex),
                };
            }
        }

        // Annoyingly, TypeScript doesn't understand that `state` can be assigned inside
        // the `HtmlTokenizer` callbacks that run synchronously. This hack gets TypeScript
        // to treat `state` as possibly non-null.
        state = state as any;

        if (!state || !state.hasEndedOpenTag || state.startedAttribute) {
            throw createUnexpectedMarkdownError(messageNouns, node.position);
        }

        if (state.parent && !state.parent.hasCloseTag) {
            if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                throw createUnexpectedMarkdownError(messageNouns, node.position);
            }
            state.parent.children.push(node);
        } else {
            state.children.push(node);
        }
    }

    if (state) {
        throw new InvalidArgumentError("Missing message element close tag", {
            displayMessage: errorDisplayMessage`\`<${state.tagName}>\` element on line ${state.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a \`</${state.tagName}>\` closing tag and try again.`,
        });
    }

    return {blocks: await runAllPromises(blockPromises)};
}

function createUnexpectedMarkdownError(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
) {
    console.trace("yoyoyo");

    return new InvalidArgumentError("Unexpected markdown node type", {
        displayMessage: errorDisplayMessage`Unexpected markdown on line ${position?.start.line ?? "unknown"}. ${messageNouns.startOfSentencePluralNoun} markdown must be a list of \`<human>\` or \`<bot>\` elements.`,
    });
}
