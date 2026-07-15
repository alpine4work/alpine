import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, Link, Node, Root, RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageCustomBlockBase,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPageMessageBlockParent,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageNouns,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPagePaginationPageLink,
    AgentWebMessagingPageTimeBlock,
    parseAgentWebMessagingPageMessageIndexRange,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {
    agentWebMessagingNextPageLinkText,
    agentWebMessagingPreviousPageLinkTextWithEndArrow,
    agentWebMessagingPreviousPageLinkTextWithStartArrow,
} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {quote} from "~/shared/helpers/string/quote.js";

type ParseAgentWebMessagingPageCustomBlock<CustomBlock> = (
    storage: AgentWebSessionStorage,
    root: Root,
    options: {
        openTag: string;
        closeTag: string;
        openTagPosition: Node["position"];
        closeTagPosition: Node["position"];
    },
) => Promise<CustomBlock>;

export async function parseAgentWebMessagingPage<
    PageLink,
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
>(
    storage: AgentWebSessionStorage,
    pageLink: PageLink | null,
    root: Root,
    options: {
        messageNouns: AgentWebMessagingPageNouns;
        parsePreamble: (storage: AgentWebSessionStorage, root: Root) => Promise<Preamble>;
        parseCustomBlockByTagName: Record<
            string,
            ParseAgentWebMessagingPageCustomBlock<CustomBlock>
        >;
    },
): Promise<AgentWebMessagingPage<Preamble, CustomBlock>> {
    const blockPromises: Array<MaybePromise<AgentWebMessagingPageBlock<CustomBlock>>> = [];

    try {
        const result = await actuallyParseAgentWebMessagingPage(
            storage,
            pageLink,
            root,
            options,
            blockPromises,
        );

        return {
            ...result,
            blocks: await runAllPromises(blockPromises),
        };
    } catch (error) {
        try {
            await runAllPromises(blockPromises);
        } catch (otherError) {
            throw createAggregateError([error, otherError]);
        }
        throw error;
    }
}

async function actuallyParseAgentWebMessagingPage<
    PageLink,
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    storage: AgentWebSessionStorage,
    pageLink: PageLink | null,
    root: Root,
    {
        messageNouns,
        parsePreamble,
        parseCustomBlockByTagName,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        parsePreamble: (storage: AgentWebSessionStorage, root: Root) => Promise<Preamble>;
        parseCustomBlockByTagName: Record<
            string,
            ParseAgentWebMessagingPageCustomBlock<CustomBlock>
        >;
    },
    blockPromises: Array<MaybePromise<AgentWebMessagingPageBlock<CustomBlock>>>,
): Promise<Omit<AgentWebMessagingPage<Preamble, CustomBlock>, "blocks">> {
    const customBlockTagNames = new Set(Object.keys(parseCustomBlockByTagName));

    let hasFinishedPreamble = false;
    let isEndOfMessages = false;
    const preamble: Array<RootContent> = [];

    type MessageState = {
        type: "Message";
        openTagPosition: Node["position"];
        hasEndedOpenTag: boolean;
        startedAttribute: "id" | "from" | "time" | "timezone" | null;
        idAttribute: string | null;
        fromAttribute: string | null;
        timeAttribute: string | null;
        timeZoneAttribute: string | null;
        parent: {
            openTagPosition: Node["position"];
            hasEndedOpenTag: boolean;
            hasCloseTag: boolean;
            startedAttribute: "cite" | "match" | null;
            citeAttribute: string | null;
            matchAttribute: string | null;
            children: Array<RootContent>;
        } | null;
        children: Array<RootContent>;
    };

    type CustomState = {
        type: "Custom";
        tagName: string;
        openTag: string;
        openTagPosition: Node["position"];
        children: Array<RootContent>;
    };

    let state: MessageState | CustomState | null = null;

    const parseHtml = (node: Html) => {
        let hasUnknownHtml = false;
        let firstHtmlTextIndex: number | null = null;
        let handledHtml: {
            tagName: string;
            tagType: "open" | "close";
            blockType: "Custom" | "Message";
        } | null = null;
        let pendingCustomOpenTag: {tagName: string; start: number} | null = null;
        let customTagInnerStartIndex: number | null = state?.type === "Custom" ? 0 : null;

        const tokenizer = new HtmlTokenizer(
            {},
            {
                onopentagname: (start, end) => {
                    assert(pendingCustomOpenTag === null);

                    const tagName = node.value.slice(start, end).toLowerCase();

                    const isMessageParentBlockquote =
                        tagName === "blockquote" && state?.type === "Message";

                    if (customBlockTagNames.has(tagName) && !isMessageParentBlockquote) {
                        if (state) {
                            const alreadyOpenTagName =
                                state.type === "Message" ? messageNouns.noun : state.tagName;

                            throw new InvalidArgumentError("Invalid custom element open tag", {
                                displayMessage: errorDisplayMessage`Can\u2019t open a new ${quote(`<${tagName}>`)} on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open ${quote(`<${alreadyOpenTagName}>`)} and you can\u2019t nest ${quote(`<${tagName}>`)}.`,
                            });
                        }

                        pendingCustomOpenTag = {
                            tagName,
                            start: node.value.lastIndexOf("<", start),
                        };
                        assert(pendingCustomOpenTag.start !== -1);
                        handledHtml ??= {tagName, tagType: "open", blockType: "Custom"};
                        return;
                    }

                    if (state?.type === "Custom") {
                        hasUnknownHtml = true;
                        return;
                    }

                    switch (tagName) {
                        case messageNouns.noun: {
                            if (state) {
                                // If there are other possible states here then `alreadyOpenTagName` may need to
                                // match the tag in state.
                                cast<"Message">(state.type);
                                const alreadyOpenTagName = messageNouns.noun;

                                throw new InvalidArgumentError("Invalid message element open tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t open a new ${quote(`<${messageNouns.noun}>`)} on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open ${quote(`<${alreadyOpenTagName}>`)} and you can\u2019t nest ${messageNouns.pluralNoun}.`,
                                });
                            }

                            state = {
                                type: "Message",
                                openTagPosition: node.position,
                                hasEndedOpenTag: false,
                                startedAttribute: null,
                                idAttribute: null,
                                fromAttribute: null,
                                timeAttribute: null,
                                timeZoneAttribute: null,
                                parent: null,
                                children: [],
                            };

                            handledHtml ??= {tagName, tagType: "open", blockType: "Message"};
                            break;
                        }
                        case "blockquote": {
                            if (state && state.type !== "Message") {
                                hasUnknownHtml = true;
                                break;
                            }

                            // Special case error for nested `<blockquote>`s with a more specific error
                            // message.
                            if (state?.parent && !state.parent.hasCloseTag) {
                                throw new InvalidArgumentError(
                                    "Invalid parent element open tag (another parent tag was already opened)",
                                    {
                                        displayMessage: errorDisplayMessage`Can\u2019t open a new \`<blockquote>\` on line ${node.position?.start.line ?? "unknown"}. There\u2019s already an open \`<blockquote>\` and you can\u2019t nest \`<blockquote>\`s. If you\u2019re trying to reply to a ${messageNouns.noun} that itself is replying to another ${messageNouns.noun} then just include the content of the ${messageNouns.noun} you\u2019re replying to and omit the extra \`<blockquote>\`.`,
                                    },
                                );
                            }

                            if (!state || state.parent || state.children.length > 0) {
                                throw new InvalidArgumentError("Invalid parent element open tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t add \`<blockquote>\` on line ${node.position?.start.line ?? "unknown"}. \`<blockquote>\`s can only be used at the beginning of a ${quote(`<${messageNouns.noun}>`)} to indicate that the ${messageNouns.noun} is a reply to some other ${messageNouns.noun}.`,
                                });
                            }

                            state.parent = {
                                openTagPosition: node.position,
                                hasEndedOpenTag: false,
                                hasCloseTag: false,
                                startedAttribute: null,
                                citeAttribute: null,
                                matchAttribute: null,
                                children: [],
                            };

                            handledHtml ??= {tagName, tagType: "open", blockType: "Message"};
                            break;
                        }
                        default: {
                            hasUnknownHtml = true;
                            break;
                        }
                    }
                },
                onopentagend: end => {
                    if (pendingCustomOpenTag) {
                        const {tagName, start} = pendingCustomOpenTag;
                        const openTagEndActualIndex = node.value.indexOf(">", end);
                        assert(openTagEndActualIndex !== -1);
                        const openTagEndIndex = openTagEndActualIndex + 1;

                        state = {
                            type: "Custom",
                            tagName,
                            openTag: node.value.slice(start, openTagEndIndex),
                            openTagPosition: node.position,
                            children: [],
                        };
                        customTagInnerStartIndex = openTagEndIndex;
                        pendingCustomOpenTag = null;
                        return;
                    }

                    if (state?.type === "Message") {
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
                    const isMessageParentBlockquote =
                        tagName === "blockquote" && state?.type === "Message";

                    if (customBlockTagNames.has(tagName) && !isMessageParentBlockquote) {
                        if (!state || state.type !== "Custom" || state.tagName !== tagName) {
                            throw new InvalidArgumentError("Invalid custom element close tag", {
                                displayMessage: errorDisplayMessage`Can\u2019t close ${quote(`</${tagName}>`)} on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching ${quote(`<${tagName}>`)} open tag.`,
                            });
                        }

                        const closeTagStartIndex = node.value.lastIndexOf("<", start);
                        assert(closeTagStartIndex !== -1);
                        const closeTagEndActualIndex = node.value.indexOf(">", end);
                        assert(closeTagEndActualIndex !== -1);
                        const closeTagEndIndex = closeTagEndActualIndex + 1;

                        if (customTagInnerStartIndex !== null) {
                            const value = node.value.slice(
                                customTagInnerStartIndex,
                                closeTagStartIndex,
                            );
                            if (value.length !== 0) {
                                state.children.push({...node, value});
                            }
                        }

                        const parseCustomBlock = assertExists(parseCustomBlockByTagName[tagName]);

                        blockPromises.push(
                            parseCustomBlock(
                                storage,
                                {
                                    type: "root",
                                    children: state.children,
                                },
                                {
                                    openTag: state.openTag,
                                    closeTag: node.value.slice(
                                        closeTagStartIndex,
                                        closeTagEndIndex,
                                    ),
                                    openTagPosition: state.openTagPosition,
                                    closeTagPosition: node.position,
                                },
                            ).then(block => {
                                // Make sure the parsed block has the correct tag name.
                                assert(block.tagName === tagName);
                                return block;
                            }),
                        );

                        state = null;
                        customTagInnerStartIndex = null;
                        handledHtml ??= {tagName, tagType: "close", blockType: "Custom"};
                        return;
                    }

                    if (state?.type === "Custom") return;

                    switch (tagName) {
                        case messageNouns.noun: {
                            if (!state || state.type !== "Message") {
                                throw new InvalidArgumentError(
                                    "Invalid message element close tag",
                                    {
                                        displayMessage: errorDisplayMessage`Can\u2019t close ${quote(`</${messageNouns.noun}>`)} on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching ${quote(`<${messageNouns.noun}>`)} open tag.`,
                                    },
                                );
                            }

                            if (!state.hasEndedOpenTag || state.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            if (state.parent && !state.parent.hasCloseTag) {
                                throw new InvalidArgumentError("Missing parent element close tag", {
                                    displayMessage: errorDisplayMessage`\`<blockquote>\` on line ${state.parent.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a \`</blockquote>\` closing tag and try again.`,
                                });
                            }

                            const parseAccountLink = async (
                                position: Node["position"],
                                string: string,
                            ) => {
                                const createError = () => {
                                    const quotedString = quoteMarkdown(string);

                                    return new InvalidArgumentError("Invalid account link", {
                                        displayMessage: errorDisplayMessage`Expected a link to a human or bot on line ${position?.start.line ?? "unknown"}. For example: \u201C[John](/human/john-doe)\u201D. Instead we found ${quotedString}. Try again with a valid link to a human or bot.`,
                                    });
                                };

                                const root = parseMarkdownTree(string);
                                if (root.children.length !== 1) throw createError();

                                const firstChild = root.children[0]!;
                                if (firstChild.type !== "paragraph") throw createError();
                                if (firstChild.children.length !== 1) throw createError();

                                const firstGrandchild = firstChild.children[0]!;
                                if (firstGrandchild.type !== "link") throw createError();

                                const pageLinkResult = await routeAgentWebPageLinkPathname(
                                    storage,
                                    firstGrandchild.url,
                                );
                                if (!pageLinkResult) throw createError();

                                const {pageLink} = pageLinkResult;
                                if (pageLink.type !== "Account") throw createError();

                                return pageLink;
                            };

                            const idAttribute = parseAgentWebMessagingPageMessageBlockIdAttribute(
                                messageNouns,
                                state.openTagPosition,
                                state.idAttribute,
                            );

                            let parent: Promise<AgentWebMessagingPageMessageBlockParent> | null =
                                null;

                            if (state.parent) {
                                if (typeof state.parent.citeAttribute !== "string") {
                                    throw new InvalidArgumentError(
                                        "Parent element is missing message link",
                                        {
                                            displayMessage: errorDisplayMessage`\`<blockquote>\` on line ${state.openTagPosition?.start.line ?? "unknown"} is missing the \`cite\` attribute. Must include a relative link to the ${messageNouns.noun} you\u2019re replying to.`,
                                        },
                                    );
                                }

                                const citeAttribute = parseAgentWebMessagingPageParentCiteAttribute(
                                    messageNouns,
                                    state.parent.openTagPosition,
                                    state.parent.citeAttribute,
                                );

                                let matchAttribute: number | null;
                                if (state.parent.matchAttribute === null) {
                                    matchAttribute = null;
                                } else {
                                    matchAttribute = parseInt(state.parent.matchAttribute, 10);

                                    if (
                                        !/^-?[0-9]+$/.test(state.parent.matchAttribute) ||
                                        !Number.isSafeInteger(matchAttribute)
                                    ) {
                                        throw new InvalidArgumentError(
                                            "Invalid parent `match` attribute",
                                            {
                                                displayMessage: errorDisplayMessage`Invalid \`<blockquote>\` \`match\` attribute on line ${state.parent.openTagPosition?.start.line ?? "unknown"}. Try again with a 1-indexed integer like \`match="2"\`.`,
                                            },
                                        );
                                    }
                                }

                                const {authorLink, previewChildren} =
                                    takeAgentWebMessagingPageParentAuthorLinkFromChildren(
                                        messageNouns,
                                        state.parent.openTagPosition,
                                        state.parent.children,
                                    );

                                parent = runAllObjectPromises({
                                    citeAttribute,
                                    matchAttribute,
                                    author: parseAccountLink(
                                        state.parent.openTagPosition,
                                        authorLink,
                                    ),
                                    previewContent: parseApiContentFromAgentWebMarkdownTree(
                                        storage,
                                        {type: "root", children: previewChildren},
                                    ),
                                });
                            }

                            const block: Replace<
                                AgentWebMessagingPageMessageBlock,
                                {
                                    author: Promise<ApiAccountReferenceResponse> | null;
                                    content: Promise<ApiContentResponseWithoutKeys>;
                                    parent: Promise<AgentWebMessagingPageMessageBlockParent> | null;
                                }
                            > = {
                                type: "Message",
                                idAttribute,
                                author:
                                    state.fromAttribute === null
                                        ? null
                                        : parseAccountLink(
                                              state.openTagPosition,
                                              state.fromAttribute,
                                          ),
                                timeAttribute: state.timeAttribute,
                                timeZoneAttribute: state.timeZoneAttribute,
                                parent,
                                content: parseApiContentFromAgentWebMarkdownTree(storage, {
                                    type: "root",
                                    children: state.children,
                                }),
                            };

                            blockPromises.push(runAllObjectPromises(block));

                            state = null;
                            handledHtml ??= {tagName, tagType: "close", blockType: "Message"};
                            break;
                        }
                        case "blockquote": {
                            if (state && state.type !== "Message") {
                                hasUnknownHtml = true;
                                break;
                            }

                            if (!state?.parent || state.parent.hasCloseTag) {
                                throw new InvalidArgumentError("Invalid parent element close tag", {
                                    displayMessage: errorDisplayMessage`Can\u2019t close \`</blockquote>\` on line ${node.position?.start.line ?? "unknown"}. There isn\u2019t a matching \`<blockquote>\` open tag.`,
                                });
                            }

                            if (!state.parent.hasEndedOpenTag || state.parent.startedAttribute) {
                                throw createUnexpectedMarkdownError(messageNouns, node.position);
                            }

                            state.parent.hasCloseTag = true;
                            handledHtml ??= {tagName, tagType: "close", blockType: "Message"};
                            break;
                        }
                        default: {
                            hasUnknownHtml = true;
                            break;
                        }
                    }
                },
                onselfclosingtag: () => {
                    if (state?.type === "Custom") return;

                    hasUnknownHtml = true;
                },

                onattribname: (start, end) => {
                    if (state?.type === "Message") {
                        const attributeName = node.value.slice(start, end).toLowerCase();

                        switch (attributeName) {
                            case "id": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "id";
                                    state.idAttribute = "";
                                }
                                break;
                            }
                            case "from": {
                                if (!state.hasEndedOpenTag) {
                                    state.startedAttribute = "from";
                                    state.fromAttribute = "";
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
                                    state.parent.citeAttribute = "";
                                }
                                break;
                            }
                            case "match": {
                                if (state.parent && !state.parent.hasEndedOpenTag) {
                                    state.parent.startedAttribute = "match";
                                    state.parent.matchAttribute = "";
                                }
                                break;
                            }
                        }
                    }
                },
                onattribdata: (start, end) => {
                    if (state?.type === "Message") {
                        const attributeData = node.value.slice(start, end);

                        if (!state.hasEndedOpenTag) {
                            switch (state.startedAttribute) {
                                case "id": {
                                    state.idAttribute += attributeData;
                                    break;
                                }
                                case "from": {
                                    state.fromAttribute += attributeData;
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
                                    state.parent.citeAttribute += attributeData;
                                    break;
                                }
                                case "match": {
                                    state.parent.matchAttribute += attributeData;
                                    break;
                                }
                            }
                        }
                    }
                },
                onattribentity: codepoint => {
                    if (state?.type === "Message") {
                        const attributeData = String.fromCodePoint(codepoint);

                        if (!state.hasEndedOpenTag) {
                            switch (state.startedAttribute) {
                                case "id": {
                                    state.idAttribute += attributeData;
                                    break;
                                }
                                case "from": {
                                    state.fromAttribute += attributeData;
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
                                    state.parent.citeAttribute += attributeData;
                                    break;
                                }
                                case "match": {
                                    state.parent.matchAttribute += attributeData;
                                    break;
                                }
                            }
                        }
                    }
                },
                onattribend: () => {
                    if (state?.type === "Message") {
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

                ontext: start => {
                    if (state?.type === "Custom") return;

                    hasUnknownHtml = true;
                    firstHtmlTextIndex ??= start;
                },
                ontextentity: start => {
                    if (state?.type === "Custom") return;

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

        if (handledHtml?.blockType === "Custom" && state?.type === "Custom") {
            assert(customTagInnerStartIndex !== null);

            const value = node.value.slice(customTagInnerStartIndex, node.value.length);
            if (value.length !== 0) {
                state.children.push({...node, value});
            }
        }

        // If this tokenizer state machine handled our HTML then don't add it to state
        // children. If there was any unknown HTML then we throw an error since we won't
        // have handled that unknown HTML.
        if (handledHtml) {
            if (handledHtml.blockType !== "Custom" && hasUnknownHtml) {
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
                            displayMessage: errorDisplayMessage`Must add an empty new line between the ${quote(tag)} ${tagType} tag and markdown text. Otherwise, due to a quirk in markdown, the text on line ${line ?? "unknown"} will be parsed as HTML instead of markdown. The ${quote(`<${tagName}>`)} must be formatted like this: ${quote(`<${tagName}>\\n\\n...\\n\\n</${tagName}>`)}.`,
                        },
                    );
                }
            }
            return true;
        }

        return false;
    };

    for (let nodeIndex = 0; nodeIndex < root.children.length; nodeIndex++) {
        let node = root.children[nodeIndex]!;

        if (
            nodeIndex === root.children.length - 1 &&
            state === null &&
            isAgentWebMessagingPageEndOfMessagesParagraph(messageNouns, node)
        ) {
            isEndOfMessages = true;
            hasFinishedPreamble = true;
            continue;
        }

        if (node.type === "html" && parseHtml(node)) {
            hasFinishedPreamble = true;
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
                hasFinishedPreamble = true;
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
                    if (state?.type === "Custom") {
                        state.children.push({
                            type: "paragraph",
                            children: node.children.slice(lastPushedIndex, index),
                        });

                        childrenToPop = state.children;
                    } else if (!hasFinishedPreamble) {
                        preamble.push({
                            type: "paragraph",
                            children: node.children.slice(lastPushedIndex, index),
                        });

                        childrenToPop = preamble;
                    } else {
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
                }

                if (parseHtml(childNode)) {
                    lastPushedIndex = index + 1;
                    hasFinishedPreamble = true;
                    continue;
                }

                // `parseHtml()` didn't succeed. Let's clean up the pre-emptive paragraph we
                // pushed.
                childrenToPop?.pop();
            }

            if (lastPushedIndex > 0) {
                // The paragraph is now empty, skip.
                if (lastPushedIndex >= node.children.length) {
                    hasFinishedPreamble = true;
                    continue;
                }

                node = {
                    type: "paragraph",
                    children: node.children.slice(lastPushedIndex),
                };
            }
        }

        if (!hasFinishedPreamble) {
            preamble.push(node);
            continue;
        }

        // Annoyingly, TypeScript doesn't understand that `state` can be assigned inside
        // the `HtmlTokenizer` callbacks that run synchronously. This hack gets TypeScript
        // to treat `state` as possibly non-null.
        state = state as any;

        if (state?.type === "Custom") {
            state.children.push(node);
            continue;
        }

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
        switch (state.type) {
            case "Message": {
                throw new InvalidArgumentError("Missing message element close tag", {
                    displayMessage: errorDisplayMessage`${quote(`<${messageNouns.noun}>`)} on line ${state.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a ${quote(`</${messageNouns.noun}>`)} closing tag and try again.`,
                });
            }
            case "Custom": {
                throw new InvalidArgumentError("Missing custom element close tag", {
                    displayMessage: errorDisplayMessage`${quote(`<${state.tagName}>`)} on line ${state.openTagPosition?.start.line ?? "unknown"} is missing a closing tag. Add a ${quote(`</${state.tagName}>`)} closing tag and try again.`,
                });
            }
            default:
                throw exhaustive(state);
        }
    }

    const pagination = await takeAgentWebMessagingPagePaginationFromPreamble(storage, {
        messageNouns,
        pageLink,
        preamble,
        customBlockTagNames,
    });

    const actualPreamble = await parsePreamble(storage, {
        type: "root",
        children: preamble,
    });

    return {
        preamble: actualPreamble,
        pagination,
        isEndOfMessages,
    };
}

export function isAgentWebMessagingPageEndOfMessagesParagraph(
    messageNouns: AgentWebMessagingPageNouns,
    node: RootContent,
): boolean {
    if (node.type !== "paragraph") return false;
    if (node.children.length !== 1) return false;

    const child = node.children[0]!;
    return child.type === "text" && child.value === `End of ${messageNouns.pluralNoun}.`;
}

function parseAgentWebMessagingPageParentCiteAttribute(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
    citeAttribute: string,
): AgentWebMessagingPageMessageBlockParent["citeAttribute"] {
    const searchParamName = messageNouns.noun;
    const createError = () =>
        new InvalidArgumentError("Invalid parent `cite` attribute", {
            displayMessage: errorDisplayMessage`Invalid \`<blockquote>\` \`cite\` attribute on line ${position?.start.line ?? "unknown"}. Expected \`cite\` to be a relative link like ${quote(`?${searchParamName}=42`)} or ${quote(`?${searchParamName}=4-7`)}. Try again with a valid \`cite\` attribute.`,
        });

    if (!citeAttribute.startsWith("?")) throw createError();

    const searchParams = new URLSearchParams(citeAttribute.slice(1));
    const value = searchParams.get(searchParamName);

    if (value === null || iterableSome(searchParams.keys(), key => key !== searchParamName)) {
        throw createError();
    }

    const integerPattern = "(0|[1-9][0-9]*)";
    const singleMessageIndexMatch = new RegExp(`^${integerPattern}$`).exec(value);

    if (singleMessageIndexMatch) {
        const messageIndex = parseInt(singleMessageIndexMatch[1]!, 10);
        return {startMessageIndex: messageIndex, endMessageIndex: messageIndex + 1};
    }

    const messageIndexRangeMatch = new RegExp(`^${integerPattern}-${integerPattern}$`).exec(value);

    if (messageIndexRangeMatch) {
        const startMessageIndex = parseInt(messageIndexRangeMatch[1]!, 10);
        const endMessageIndexInclusive = parseInt(messageIndexRangeMatch[2]!, 10);

        if (endMessageIndexInclusive >= startMessageIndex) {
            return {
                startMessageIndex,
                endMessageIndex: endMessageIndexInclusive + 1,
            };
        }
    }

    throw createError();
}

function takeAgentWebMessagingPageParentAuthorLinkFromChildren(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
    children: ReadonlyArray<RootContent>,
): {authorLink: string; previewChildren: Array<RootContent>} {
    const createError = () =>
        new InvalidArgumentError("Parent content is missing author prefix", {
            displayMessage: errorDisplayMessage`\`<blockquote>\` content on line ${position?.start.line ?? "unknown"} must start with a link to the ${messageNouns.noun} author followed by a colon. For example: \`[John](/human/john-doe): quoted text\`. Try again with a link to the ${messageNouns.noun} author.`,
        });

    const firstChild = children[0];
    if (firstChild?.type !== "paragraph") throw createError();

    const authorLinkNode = firstChild.children[0];
    const separatorNode = firstChild.children[1];

    if (authorLinkNode?.type !== "link") throw createError();
    if (separatorNode?.type !== "text" || !separatorNode.value.startsWith(":")) {
        throw createError();
    }

    const separatorValue = separatorNode.value.startsWith(": ")
        ? separatorNode.value.slice(2)
        : separatorNode.value.slice(1);
    const firstPreviewParagraphChildren: typeof firstChild.children = [
        ...(separatorValue.length > 0 ? [{...separatorNode, value: separatorValue}] : []),
        ...firstChild.children.slice(2),
    ];

    const authorLink = printMarkdownTree({
        type: "paragraph",
        children: [authorLinkNode],
    }).trim();

    if (firstPreviewParagraphChildren.length === 0) {
        if (children.length === 1 || children[1]?.type !== "paragraph") {
            return {authorLink, previewChildren: children.slice(1)};
        }
    }

    return {
        authorLink,
        previewChildren: [
            {...firstChild, children: firstPreviewParagraphChildren},
            ...children.slice(1),
        ],
    };
}

function parseAgentWebMessagingPageMessageBlockIdAttribute(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
    idAttribute: string | null,
): AgentWebMessagingPageMessageRange | null {
    if (idAttribute === null) return null;

    const range = parseAgentWebMessagingPageMessageIndexRange(idAttribute);
    if (range !== null) return range;

    throw new InvalidArgumentError("Invalid message `id` attribute", {
        displayMessage: errorDisplayMessage`Invalid ${quote(`<${messageNouns.noun}>`)} \`id\` attribute on line ${position?.start.line ?? "unknown"}. Expected \`id\` to be an integer like \`42\` or an integer range like \`4-7\`. Try again with a valid \`id\` attribute.`,
    });
}

function createUnexpectedMarkdownError(
    messageNouns: AgentWebMessagingPageNouns,
    position: Node["position"],
) {
    return new InvalidArgumentError("Unexpected markdown node type", {
        displayMessage: errorDisplayMessage`Unexpected markdown on line ${position?.start.line ?? "unknown"}. ${messageNouns.startOfSentencePluralNoun} markdown must be a list of ${quote(`<${messageNouns.noun}>`)}s.`,
    });
}

async function takeAgentWebMessagingPagePaginationFromPreamble<
    PageLink,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    storage: AgentWebSessionStorage,
    {
        messageNouns,
        pageLink,
        preamble,
        customBlockTagNames,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        pageLink: PageLink | null;
        preamble: Array<RootContent>;
        customBlockTagNames: ReadonlySet<string>;
    },
): Promise<AgentWebMessagingPagePagination<CustomBlock> | null> {
    const lastNodeIndex = findAgentWebMessagingPagePaginationParagraphIndex(preamble);
    if (lastNodeIndex === null) return null;

    const lastNode = preamble[lastNodeIndex]!;
    assert(lastNode.type === "paragraph");

    const lastChildIndex = lastNode.children.length - 1;
    const lastChild = lastNode.children[lastChildIndex];
    if (lastChild?.type !== "link") return null;

    const text = printMarkdownPhrasingContentText(lastChild.children);
    let previousPaginationLink: AgentWebMessagingPageParsedPaginationLink | null = null;
    let nextPaginationLink: AgentWebMessagingPageParsedPaginationLink | null = null;
    let removeStartIndex: number | null = null;

    // Not a pagination link.
    if (
        text !== agentWebMessagingPreviousPageLinkTextWithEndArrow &&
        text !== agentWebMessagingNextPageLinkText
    ) {
        return null;
    }

    // Pagination links always point to a route inside the Markdown web.
    if (/^[a-zA-Z0-9]+:/.test(lastChild.url)) return null;

    if (pageLink === null) {
        const quotedText = quoteMarkdown(lastChild.children);

        throw new InvalidArgumentError("Can\u2019t add pagination link to new messaging room", {
            displayMessage: errorDisplayMessage`Can\u2019t add ${quotedText} link when creating ${messageNouns.pluralNoun} markdown. Try again without the ${quotedText} link.`,
        });
    }

    if (text === agentWebMessagingPreviousPageLinkTextWithEndArrow) {
        previousPaginationLink = await parseAgentWebMessagingPagePaginationLink(storage, {
            messageNouns,
            link: lastChild,
            searchParamName: "before",
            customBlockTagNames,
        });

        removeStartIndex = lastChildIndex;
    } else {
        assert(text === agentWebMessagingNextPageLinkText);

        nextPaginationLink = await parseAgentWebMessagingPagePaginationLink(storage, {
            messageNouns,
            link: lastChild,
            searchParamName: "after",
            customBlockTagNames,
        });

        removeStartIndex = lastChildIndex;

        const separatorChild = lastNode.children[lastChildIndex - 1];
        const previousLinkChild = lastNode.children[lastChildIndex - 2];

        if (
            separatorChild?.type === "text" &&
            separatorChild.value === " | " &&
            previousLinkChild?.type === "link" &&
            printMarkdownPhrasingContentText(previousLinkChild.children) ===
                agentWebMessagingPreviousPageLinkTextWithStartArrow
        ) {
            previousPaginationLink = await parseAgentWebMessagingPagePaginationLink(storage, {
                messageNouns,
                link: previousLinkChild,
                searchParamName: "before",
                customBlockTagNames,
            });
            removeStartIndex = lastChildIndex - 2;
        }
    }

    assert(removeStartIndex !== null);

    if (
        previousPaginationLink &&
        nextPaginationLink &&
        !isDeepEqual(previousPaginationLink.pageLink, nextPaginationLink.pageLink)
    ) {
        throw new InvalidArgumentError("Pagination links point to different pages", {
            displayMessage: errorDisplayMessage`${quoteMarkdown(agentWebMessagingPreviousPageLinkTextWithStartArrow)} and ${quoteMarkdown(agentWebMessagingNextPageLinkText)} links must link to the same page. ${quoteMarkdown(agentWebMessagingPreviousPageLinkTextWithStartArrow)} links to ${quote(previousPaginationLink.pathname.slice(0, 75))} and ${quoteMarkdown(agentWebMessagingNextPageLinkText)} links to ${quote(nextPaginationLink.pathname.slice(0, 75))}. Try again and make sure both links point to the same page (it\u2019s ok if the URL search params like \`?before\` and \`?after\` are different but the pathname must be the same).`,
        });
    }

    lastNode.children.splice(removeStartIndex);

    const previousChild = lastNode.children[lastNode.children.length - 1];
    if (previousChild?.type === "text" && previousChild.value.endsWith(" ")) {
        if (previousChild.value === " ") {
            lastNode.children.pop();
        } else {
            previousChild.value = previousChild.value.slice(0, -1);
        }
    }

    if (lastNode.children.length === 0) preamble.splice(lastNodeIndex, 1);

    if (previousPaginationLink) {
        return {
            pageLink: previousPaginationLink.pageLink,
            previousLink:
                previousPaginationLink.type === "Message"
                    ? {type: "Message", beforeMessageIndex: previousPaginationLink.messageIndex}
                    : {type: "Custom", beforeTagName: previousPaginationLink.tagName as any},
            nextLink: nextPaginationLink
                ? nextPaginationLink.type === "Message"
                    ? {type: "Message", afterMessageIndex: nextPaginationLink.messageIndex}
                    : {type: "Custom", afterTagName: nextPaginationLink.tagName as any}
                : null,
        };
    }

    assert(nextPaginationLink !== null);

    return {
        pageLink: nextPaginationLink.pageLink,
        previousLink: null,
        nextLink:
            nextPaginationLink.type === "Message"
                ? {type: "Message", afterMessageIndex: nextPaginationLink.messageIndex}
                : {type: "Custom", afterTagName: nextPaginationLink.tagName as any},
    };
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

type AgentWebMessagingPageParsedPaginationLink =
    | {
          readonly type: "Message";
          readonly pathname: string;
          readonly pageLink: AgentWebMessagingPagePaginationPageLink;
          readonly messageIndex: number;
      }
    | {
          readonly type: "Custom";
          readonly pathname: string;
          readonly pageLink: AgentWebMessagingPagePaginationPageLink;
          readonly tagName: string;
      };

async function parseAgentWebMessagingPagePaginationLink(
    storage: AgentWebSessionStorage,
    {
        messageNouns,
        link,
        searchParamName,
        customBlockTagNames,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        link: Link;
        searchParamName: "before" | "after";
        customBlockTagNames: ReadonlySet<string>;
    },
): Promise<AgentWebMessagingPageParsedPaginationLink> {
    const {pathname, searchParams} = normalizeAgentWebPath(link.url);
    const searchParam = searchParams.get(searchParamName);
    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, pathname);

    if (!pageLinkResult) {
        throw createInvalidAgentWebMessagingPagePaginationLinkUrlError({
            messageNouns,
            link,
            searchParamName,
        });
    }

    const {pageLink} = pageLinkResult;

    switch (pageLink.type) {
        case "Chat":
        case "DocumentThread":
        case "Post":
        case "TaskMessageList": {
            // Ok!
            break;
        }
        default: {
            throw createInvalidAgentWebMessagingPagePaginationLinkUrlError({
                messageNouns,
                link,
                searchParamName,
            });
        }
    }

    if (searchParam !== null && customBlockTagNames.has(searchParam)) {
        return {type: "Custom", pathname, pageLink, tagName: searchParam};
    }

    if (searchParam === null || !/^(0|[1-9][0-9]*)$/.test(searchParam)) {
        throw createInvalidAgentWebMessagingPagePaginationLinkUrlError({
            messageNouns,
            link,
            searchParamName,
        });
    }

    return {
        type: "Message",
        pathname,
        pageLink,
        messageIndex: parseInt(searchParam, 10),
    };
}

function createInvalidAgentWebMessagingPagePaginationLinkUrlError({
    messageNouns,
    link,
    searchParamName,
}: {
    messageNouns: AgentWebMessagingPageNouns;
    link: Link;
    searchParamName: "before" | "after";
}) {
    const quotedText = quoteMarkdown(link.children);

    return new InvalidArgumentError("Invalid pagination link URL", {
        displayMessage: errorDisplayMessage`Invalid link for ${quotedText}. Expected a link to more ${messageNouns.pluralNoun} with a ${quote(searchParamName)} URL search param. Example: ${quote(`/chat/my-chat?${searchParamName}=8`)}. Try again with a different link.`,
    });
}
