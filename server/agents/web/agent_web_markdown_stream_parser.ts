import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {BlockContent, DefinitionContent, Html, Parent, Root} from "mdast";
import {AgentWebPageKeyObject} from "~/server/agents/web/agent_web_page_key.js";
import {printAgentWebPageLinkLabel} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageLinkApiMentionTargetIfPossible} from "~/server/agents/web/create_agent_web_page_link_api_mention_target_if_possible.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {
    parseApiContentFromMarkdownTree,
    parseApiMentionTargetIfPossible,
    parseMarkdownTree,
} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    printApiMentionTargetToMentionLinkLabel,
    printApiMentionTargetToMentionLinkUrl,
} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContentBlockElement,
    ApiContentResponse,
    ApiMessageStreamContentPartPayloadResponse,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AgentWebMarkdownStreamPart = {
    readonly index: number;
    readonly payload:
        | Exclude<ApiMessageStreamPartPayload, {type: "Content"}>
        | ApiMessageStreamContentPartPayloadResponse;
};

/**
 * Manages message streaming for agents. You stream text into this class with
 * `pushText()` and you turn that text into parts with `update()`.
 */
export class AgentWebMarkdownStreamParser<Span extends TracerSpan | null = null> {
    private readonly _storage: AgentWebSessionStorage;
    private readonly _documentId: DocumentId | null;

    private _firstHeadingDepth: number | null = null;

    private _textState: {
        // When you call `pushText()` you must pass in a `TracerSpan`. This is the latest
        // span passed into `pushText()`. The `putApiMessageStreamPart()` call for this
        // content will use this span as its parent.
        //
        // Most of the time, `pushText()` is called with the same span (this is the case
        // for the ChatGPT agent at least). For the ChatGPT agent we want the content part
        // span to be a child of the "OpenAI output item message" span created by
        // `open_ai_client.ts`.
        latestSpan: Span;
        text: string;
    } | null = null;

    private _parts: Array<AgentWebMarkdownStreamPart> = [];

    constructor({
        storage,
        documentId,
    }: {
        storage: AgentWebSessionStorage;
        documentId: DocumentId | null;
    }) {
        this._storage = storage;
        this._documentId = documentId;
    }

    /**
     * Get all the current parts of our stream. You must call `update()` first to
     * update the parts.
     */
    public getParts() {
        return this._parts.slice();
    }

    /**
     * Adds some text to the message. The text will be parsed into content later by
     * `update()` which is called with some throttling.
     */
    public pushText(span: Span, text: string) {
        if (this._textState === null) {
            this._textState = {
                latestSpan: span,
                text: text,
            };
        } else {
            this._textState.latestSpan = span;
            this._textState.text += text;
        }
    }

    /**
     * Update the parts of `AgentStreamMessage`. Returns parts we should `PUT` into the
     * stream. Only ever returns an update to the last part (as of when this was
     * called) and new parts after that. Only the last part of a stream can be updated
     * at any given time. Always returns parts with the right `index`.
     *
     * Roughly each Markdown block is turned into a part. This balances performance and
     * correctness. We don't want to update the entire agent message at once while it's
     * streaming but we need a blocks worth of content to correctly parse styles like
     * bold and italics.
     *
     * You may pass in `newParts` to add non-content parts to the stream.
     */
    public async update(
        updateSpan: Span,
        newPartPayloads: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>> = [],
    ): Promise<Array<{span: Span; part: AgentWebMarkdownStreamPart}>> {
        const putParts: Array<{span: Span; part: AgentWebMarkdownStreamPart}> = [];

        const {firstHeadingDepth, markdownParts} = await parseTextIntoMarkdownParts(
            this._storage,
            this._documentId,
            this._firstHeadingDepth,
            this._textState,
        );
        this._firstHeadingDepth = firstHeadingDepth;

        if (markdownParts.length > 0) {
            assert(this._textState !== null);
            const {latestSpan: textSpan, text: originalText} = this._textState;

            // The first Markdown part updates the last part in `AgentStreamMessage`. Or if
            // there are no parts in `AgentStreamMessage` yet it creates the first part.
            {
                const firstMarkdownPart = markdownParts[0]!;

                const getFirstPartContent = () => {
                    return parseApiContentFromMarkdownTree(
                        {type: "root", children: firstMarkdownPart},
                        {spaceId: this._storage.spaceId},
                        // In our Markdown `parseTextIntoMarkdownParts()` pre-processing we make sure to
                        // provide enough information that our parse function can return
                        // `ApiContentResponse` (e.g. setting `data.mentionElement` to a hydrated
                        // `ApiContentMentionInlineElementResponse` object).
                    ) as ApiContentResponse;
                };

                if (
                    this._parts.length === 0 ||
                    // If the last part is not content (e.g. a tool call) then create a new content
                    // part instead of updating the last part.
                    this._parts[this._parts.length - 1]!.payload.type !== "Content"
                ) {
                    // NOTE(ifitzsimmons, 2026-01-07): When streaming lists back to our API, we use an
                    // optimization to send each top-level list item as a separate stream part. Because
                    // each top-level list item is/can be parsed in isolation, the markdown parser will
                    // assign the appropriate `start` value to the list item. So for example, if this
                    // class receives `1. First item\n\n`, it will parse that into a list item starting
                    // at "1". Then, let's say `2. second item\n\n` is pushed into this class. At parse
                    // time, we don't actually know if #2 was preceded by #1 or not or whether they
                    // belong to the same ordered list.
                    //
                    // To address this, we wait until after markdown parsing and then "look back" to
                    // see if the previous element
                    //
                    // 1. Was an ordered list item and
                    // 2. if yes, if the previous item's number was the neighbor of the current item's
                    //    number (e.g. the previous item was "3" and the current item is "4")
                    //
                    // If both of these conditions are met, then we can remove the explicit order start
                    // from the current item.
                    //
                    // We do this operation in three places because the "previous" element depends on
                    // where we are in our parsing loop.
                    //
                    // In this specific case, we are creating our first part, so there is no previous
                    // element
                    removeOrderStartFromOrderedListItemsIfNeeded(firstMarkdownPart, undefined);

                    const firstPart: AgentWebMarkdownStreamPart = {
                        index: this._parts.length,
                        payload: {type: "Content", content: getFirstPartContent()},
                    };

                    putParts.push({span: textSpan, part: firstPart});
                    this._parts.push(firstPart);
                } else {
                    // We're updating the last part, so the previous part is actually the
                    // second-to-last part.
                    removeOrderStartFromOrderedListItemsIfNeeded(firstMarkdownPart, {
                        type: "AgentMessageStreamPart",
                        previousPartIndex: this._parts.length - 2,
                        streamParts: this._parts,
                    });

                    const firstPart: AgentWebMarkdownStreamPart = {
                        index: this._parts.length - 1,
                        payload: {type: "Content", content: getFirstPartContent()},
                    };

                    // We only need to update the last part if it actually changed.
                    if (!isDeepEqual(this._parts[this._parts.length - 1]!, firstPart)) {
                        putParts.push({span: textSpan, part: firstPart});
                        this._parts[this._parts.length - 1] = firstPart;
                    }
                }
            }

            // The remaining parts are newly created. We update `this._text` to exclude the
            // previous part (which can no longer be updated, only this new part can be
            // updated).
            for (let index = 1; index < markdownParts.length; index++) {
                const markdownPart = markdownParts[index]!;
                const previousMarkdownPart = markdownParts[index - 1]!;

                // So let's say a list was started by pushing `1. First item\n\n` into the class
                // and calling `update()`. So `_parts` consists of a single part with the following
                // representation:
                //
                // ```
                // [orderedList(null, [paragraph("First item")])]
                // ```
                //
                // Then `pushText` is called with
                // `2. second item\n\n3. third item\n\n4. fourth item\n\n` and `update()` is
                // called. `markdownParts` will consist of
                //
                // ```
                // [
                //   orderedList(null, [paragraph("First item")])
                //   orderedList({orderStart: 2}, [paragraph("Second item")]),
                //   orderedList(null, [paragraph("Third item")]),
                //   orderedList(null, [paragraph("Fourth item")])
                // ]
                // ```
                //
                // We complete the first element of `_parts` and handle elements 2-4 in this loop.
                // For the first element in this loop (the second element in `markdownParts`), we
                // look back through the previous parts in `this._parts` to determine whether or
                // not we should remove the explicit order start. In this case, we should.
                //
                // Elements 3 & 4 don't have an ordered start, so they don't need to be removed. In
                // theory, we should never have to remove the order start from markdown parts after
                // the first 2 elements.
                //
                // ```
                //
                // ```
                removeOrderStartFromOrderedListItemsIfNeeded(
                    markdownPart,
                    previousMarkdownPart
                        ? {type: "BlockContent", content: previousMarkdownPart}
                        : {
                              type: "AgentMessageStreamPart",
                              previousPartIndex: this._parts.length - 1,
                              streamParts: this._parts,
                          },
                );

                const partContent = parseApiContentFromMarkdownTree(
                    {type: "root", children: markdownPart},
                    {spaceId: this._storage.spaceId},
                    // In our Markdown `parseTextIntoMarkdownParts()` pre-processing we make sure to
                    // provide enough information that our parse function can return
                    // `ApiContentResponse` (e.g. setting `data.mentionElement` to a hydrated
                    // `ApiContentMentionInlineElementResponse` object).
                ) as ApiContentResponse;

                const part: AgentWebMarkdownStreamPart = {
                    index: this._parts.length,
                    payload: {type: "Content", content: partContent},
                };

                putParts.push({span: textSpan, part});
                this._parts.push(part);

                assert(previousMarkdownPart.length > 0);
                const previousMarkdownPartLastContent =
                    previousMarkdownPart[previousMarkdownPart.length - 1]!;
                assert(previousMarkdownPartLastContent.position?.end.offset !== undefined);

                this._textState.text = originalText.slice(
                    previousMarkdownPartLastContent.position.end.offset,
                );
            }
        }

        if (newPartPayloads.length > 0) {
            // Reset the text. Any new text won't be replacing previous parts. It'll create new
            // parts.
            this._textState = null;

            for (const newPartPayload of newPartPayloads) {
                // @ts-expect-error: We excluded `Content` from the TypeScript type. But double
                // check here that we're not adding a content part. Content parts are only
                // updated by `pushText()`. If we add a content part here then it'll be
                // replaced by the next `pushText()` + `update()` call.
                assert(newPartPayload.type !== "Content");

                const part: AgentWebMarkdownStreamPart = {
                    index: this._parts.length,
                    payload: newPartPayload,
                };

                putParts.push({span: updateSpan, part});
                this._parts.push(part);
            }
        }

        return putParts;
    }
}

async function parseTextIntoMarkdownParts(
    storage: AgentWebSessionStorage,
    documentId: DocumentId | null,
    firstHeadingDepth: number | null,
    textState: {text: string} | null,
): Promise<{
    firstHeadingDepth: number | null;
    markdownParts: ReadonlyArray<Array<BlockContent>>;
}> {
    if (textState === null) return {firstHeadingDepth, markdownParts: emptyArray};

    let text = textState.text;
    if (text.length === 0) return {firstHeadingDepth, markdownParts: emptyArray};

    // If the text ends with an incomplete HTML tag then remove it from the text.
    // Expect to get the rest of our HTML tag later from the LLM.
    const incompleteHtmlTagMatch = text.match(
        // eslint-disable-next-line no-control-regex
        /<\/?[a-zA-Z][a-zA-Z0-9-]*[\x00-\x3D\x3F-\x7F]*$/,
    );
    if (incompleteHtmlTagMatch) {
        const newText = text.slice(0, -incompleteHtmlTagMatch[0].length);
        const backslashCount = newText.match(/\\+$/)?.[0]?.length ?? 0;
        if (backslashCount % 2 === 0) {
            const incompleteHtmlTagText = text.slice(-incompleteHtmlTagMatch[0].length);
            let hasError = false;

            const tokenizer = new HtmlTokenizer(
                {},
                {
                    onattribname: (startIndex, endIndex) => {
                        // Handle the following case:
                        //
                        // ```
                        // \`\`\`java
                        // <A
                        // \`\`\`
                        // ```
                        //
                        // In this case `incompleteHtmlTagMatch` matches `"<A\n```\n"`. So we need to
                        // detect when there are backticks inside the incomplete HTML tag and bail out
                        // since this HTML tag is actually code block text that has been completed.
                        if (incompleteHtmlTagText.slice(startIndex, endIndex).includes("`")) {
                            hasError = true;
                        }
                    },

                    onattribdata: noop,
                    onattribentity: noop,
                    onattribend: noop,
                    oncdata: noop,
                    onclosetag: noop,
                    oncomment: noop,
                    ondeclaration: noop,
                    onend: noop,
                    onopentagend: noop,
                    onopentagname: noop,
                    onprocessinginstruction: noop,
                    onselfclosingtag: noop,
                    ontext: noop,
                    ontextentity: noop,
                },
            );

            tokenizer.write(incompleteHtmlTagText);

            if (!hasError) {
                text = newText;
            }
        }
    }

    const markdownRoot = parseMarkdownTree(text, {
        // TODO(ifitzsimmons, #ai): remove this mdast patch Allow parsing
        // `Check out [My Document][]` as a link even if there is no definition for
        // `My Document`. We'll figure out the right link in our code.
        allowUndefinedLinkReferenceIdentifiers: true,
        // Allow parsing `The quick **brown fox` as bold from `**` to the end of the text.
        // Since while streaming Markdown we have to wait for the ending `**`.
        allowAttentionWithoutClose: true,
        // Allow parsing ``The quick `brown fox`` as bold from `` ` `` to the end of the
        // text. Since while streaming Markdown we have to wait for the ending `` ` ``.
        allowCodeTextWithoutClose: true,
        // Allow parsing `The quick [brown fox` and discard link characters so it's
        // interpreted as `The quick brown fox`.
        allowLabelWithoutClose: true,
        // Allow parsing `The quick [brown fox](/some-path-` and discard link characters so
        // it's interpreted as `The quick brown fox`.
        allowResourceWithoutClose: true,
    });

    const promiseWaiter = new PromiseWaiter();

    // Loop through our Markdown content. All of our internal links are stored as
    // shorthand link representations. So for a Document titled "Dinosaurs are cool",
    // the markdown link looks like "[Dinosaurs are cool](document/dinosaurs-are-cool)"
    // We do this for token efficiency and also to give the LLM more context about the
    // linked content. When streaming these links back to the client, we need to
    // replace the shorthand link with the actual link to the internal entity.
    const traverse = (node: Parent) => {
        for (let index = 0; index < node.children.length; index++) {
            const childNode = node.children[index]!;

            if (childNode.type === "html") {
                const promise = traverseMarkdownHtmlNode(storage, documentId, childNode);

                promiseWaiter.waitUntil(async () => {
                    node.children[index] = await promise;
                });
            }

            // We increment headings by 1 for agent web Markdown. So decrement them back by 1.
            if (childNode.type === "heading") {
                firstHeadingDepth ??= childNode.depth;

                // If an agent outputs a heading 1 then we won't decrement future headings. We
                // assume the agent doesn't understand that we reserve heading 1 for entity titles.
                // So we leave the heading levels as defined by the agent.
                //
                // However, if an agent is copying heading styles its already seen (and so starts
                // at level 2) then we need to decrement the heading level to match our
                // `printApiContentToaGentWebMarkdown()` behavior making sure we correctly parse
                // back content we showed to the agent.
                if (firstHeadingDepth !== 1) {
                    childNode.depth = Math.max(1, childNode.depth - 1) as 1 | 2 | 3 | 4 | 5 | 6;
                }
            }

            if (childNode.type === "link") {
                promiseWaiter.waitUntil(async () => {
                    if (!childNode.url.startsWith("/")) {
                        // If this isn't a relative mention link, it may be a truncated URL. Let's try
                        // looking it up.
                        let urlString =
                            (await storage.urlByTruncatedUrl.get(childNode.url)) ?? childNode.url;

                        // Try parsing URL.
                        let url: URL | undefined;
                        try {
                            url = new URL(urlString);
                        } catch {
                            // Noop
                        }

                        // If the LLM output a URL that can be parsed as a mention then remove the
                        // `mention` search param! The LLM is only allowed to create mentions via the agent
                        // web markdown syntax. We can't allow the LLM to create mentions this way since we
                        // won't be able to create a response mention object with `title`.
                        if (url && parseApiMentionTargetIfPossible(storage.spaceId, url)) {
                            url.searchParams.delete("mention");
                            urlString = url.toString();
                        }

                        childNode.url = urlString;
                    }

                    // This link looks like a mention, let's add the correct link to the Markdown tree
                    // before parsing into content.
                    if (!/[a-zA-Z0-9]+:/.test(childNode.url)) {
                        let path = childNode.url;

                        // Add a leading slash in case the LLM forgot to add one.
                        if (!path.startsWith("/")) path = `/${path}`;

                        // Remove the hash part of the URL before resolving. Just like in an actual web
                        // server! The hash part is only visible to the client, it's not visible to the
                        // server. So it doesn't change server resolution.
                        path = path.replace(/#.*$/, "");

                        // TODO(ifitzsimmons, #format-non-mentionable-content): If the link is not
                        // mentionable, `pageLink` will be null. We need to build a plain link for non
                        // mentionable content and we also need to swap the label so something more user
                        // friendly (`mentionLabel`).
                        const pageLink = await storage.pageLinkByPath.get(path);

                        if (!pageLink) return;

                        const mentionTargetResult =
                            createAgentWebPageLinkApiMentionTargetIfPossible(
                                storage.spaceId,
                                pageLink,
                            );

                        switch (mentionTargetResult.type) {
                            case "Url": {
                                node.children[index] = {
                                    type: "link",
                                    url: mentionTargetResult.url,
                                    children: childNode.children,
                                    position: childNode.position,
                                };
                                break;
                            }
                            case "MentionTarget": {
                                const isAccountShortName =
                                    pageLink.type === "Account"
                                        ? childNode.url.endsWith("#short") ||
                                          printMarkdownPhrasingContentText(childNode.children) !==
                                              printAgentWebPageLinkLabel(pageLink)
                                        : undefined;

                                node.children[index] = {
                                    type: "link",
                                    url: printApiMentionTargetToMentionLinkUrl(
                                        mentionTargetResult.target,
                                        {spaceId: storage.spaceId, isAccountShortName},
                                    ),
                                    children: printApiMentionTargetToMentionLinkLabel(
                                        mentionTargetResult.target,
                                    ),
                                    position: childNode.position,
                                    data: {
                                        mentionElement: {
                                            type: "Mention",
                                            target: mentionTargetResult.target,
                                            isAccountShortName,
                                        },
                                    },
                                };
                                break;
                            }
                            default:
                                throw exhaustive(mentionTargetResult);
                        }
                    }
                });
            }

            if ("children" in childNode) {
                traverse(childNode);
            }
        }
    };

    traverse(markdownRoot);

    await promiseWaiter.wait();

    return {
        firstHeadingDepth,
        markdownParts: Array.from(splitMarkdownTreeIntoParts(markdownRoot)),
    };
}

async function traverseMarkdownHtmlNode(
    storage: AgentWebSessionStorage,
    documentId: DocumentId | null,
    node: Html,
): Promise<Html> {
    let anchorTagState: {
        href: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
    } | null = null;

    let commentTagState: {
        id: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
    } | null = null;

    let tableTagState: {
        dataWidth: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
        dataColumnWidths: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
    } | null = null;

    const replacements: Array<{
        startIndex: number;
        endIndex: number;
        string: Promise<string | null>;
    }> = [];

    const tokenizer = new HtmlTokenizer(
        {},
        {
            ontext: noop,
            ontextentity: noop,

            onopentagname: (startIndex, endIndex) => {
                const tagName = node.value.slice(startIndex, endIndex).toLowerCase();

                switch (tagName) {
                    case "a": {
                        anchorTagState = {href: null};
                        break;
                    }
                    case "comment": {
                        commentTagState = {id: null};
                        break;
                    }
                    case "table": {
                        tableTagState = {dataWidth: null, dataColumnWidths: null};
                        break;
                    }
                }
            },
            onopentagend: () => {
                if (anchorTagState) {
                    if (anchorTagState.href?.data) {
                        const truncatedUrl = anchorTagState.href.data.value;

                        replacements.push({
                            startIndex: anchorTagState.href.data.startIndex,
                            endIndex: anchorTagState.href.data.endIndex,
                            string: (async () => {
                                const url = await storage.urlByTruncatedUrl.get(truncatedUrl);
                                if (url === undefined) return null;
                                return escapeHtml(url);
                            })(),
                        });
                    }

                    anchorTagState = null;
                }

                if (commentTagState) {
                    if (commentTagState.id?.data) {
                        const numberString = commentTagState.id.data.value;
                        const number = parseInt(numberString, 10);

                        if (documentId && !isNaN(number)) {
                            replacements.push({
                                startIndex: commentTagState.id.data.startIndex,
                                endIndex: commentTagState.id.data.endIndex,
                                string: (async () => {
                                    const commentThreadId =
                                        await storage.documentCommentThreadIdByNumber.get(
                                            `${documentId}-${number}`,
                                        );

                                    if (commentThreadId === undefined) return null;

                                    return escapeHtml(commentThreadId);
                                })(),
                            });
                        }
                    }

                    commentTagState = null;
                }

                if (tableTagState) {
                    if (tableTagState.dataWidth?.data) {
                        const truncatedWidth = tableTagState.dataWidth.data.value;

                        replacements.push({
                            startIndex: tableTagState.dataWidth.data.startIndex,
                            endIndex: tableTagState.dataWidth.data.endIndex,
                            string: (async () => {
                                const width =
                                    await storage.tableWidthByTruncatedWidth.get(truncatedWidth);

                                if (width === undefined) return null;

                                return JSON.stringify(width);
                            })(),
                        });
                    }

                    if (tableTagState.dataColumnWidths?.data) {
                        const truncatedColumnWidths = tableTagState.dataColumnWidths.data.value;

                        replacements.push({
                            startIndex: tableTagState.dataColumnWidths.data.startIndex,
                            endIndex: tableTagState.dataColumnWidths.data.endIndex,
                            string: (async () => {
                                const columnWidths =
                                    await storage.tableColumnWidthsByTruncatedColumnWidths.get(
                                        truncatedColumnWidths,
                                    );

                                if (columnWidths === undefined) return null;

                                return JSON.stringify(columnWidths).slice(1, -1);
                            })(),
                        });
                    }

                    tableTagState = null;
                }
            },
            onclosetag: noop,

            onattribname: (startIndex, endIndex) => {
                const attributeName = node.value.slice(startIndex, endIndex).toLowerCase();

                if (anchorTagState && attributeName === "href") {
                    anchorTagState.href = {
                        isOpen: true,
                        attributeEndIndex: endIndex,
                        data: null,
                    };
                }

                if (commentTagState && attributeName === "id") {
                    commentTagState.id = {
                        isOpen: true,
                        attributeEndIndex: endIndex,
                        data: null,
                    };
                }

                if (tableTagState) {
                    if (attributeName === "data-width") {
                        tableTagState.dataWidth = {
                            isOpen: true,
                            attributeEndIndex: endIndex,
                            data: null,
                        };
                    }

                    if (attributeName === "data-column-widths") {
                        tableTagState.dataColumnWidths = {
                            isOpen: true,
                            attributeEndIndex: endIndex,
                            data: null,
                        };
                    }
                }
            },
            onattribdata: (startIndex, endIndex) => {
                const attributeData = node.value.slice(startIndex, endIndex);

                const addAttributeData = (state: {
                    attributeEndIndex: number;
                    data: {startIndex: number; endIndex: number; value: string} | null;
                }) => {
                    state.data ??= {startIndex, endIndex, value: ""};
                    state.data.endIndex = endIndex;
                    state.data.value += attributeData;
                };

                if (anchorTagState?.href?.isOpen) addAttributeData(anchorTagState.href);
                if (commentTagState?.id?.isOpen) addAttributeData(commentTagState.id);
                if (tableTagState?.dataWidth?.isOpen) addAttributeData(tableTagState.dataWidth);
                if (tableTagState?.dataColumnWidths?.isOpen)
                    addAttributeData(tableTagState.dataColumnWidths);
            },
            onattribentity: codepoint => {
                const attributeData = String.fromCodePoint(codepoint);

                const addAttributeEntity = (state: {
                    attributeEndIndex: number;
                    data: {startIndex: number; endIndex: number; value: string} | null;
                }) => {
                    const lastIndex = state.data?.endIndex ?? state.attributeEndIndex;

                    let startIndex = node.value.slice(lastIndex).indexOf("&");
                    assert(startIndex !== -1);
                    startIndex += lastIndex;

                    let endIndex = node.value.slice(startIndex + 1).indexOf(";");
                    assert(endIndex !== -1);
                    endIndex += startIndex + 1;
                    endIndex += 1;

                    state.data ??= {startIndex, endIndex, value: ""};
                    state.data.endIndex = endIndex;
                    state.data.value += attributeData;
                };

                if (anchorTagState?.href?.isOpen) addAttributeEntity(anchorTagState.href);
                if (commentTagState?.id?.isOpen) addAttributeEntity(commentTagState.id);
                if (tableTagState?.dataWidth?.isOpen) addAttributeEntity(tableTagState.dataWidth);
                if (tableTagState?.dataColumnWidths?.isOpen)
                    addAttributeEntity(tableTagState.dataColumnWidths);
            },
            onattribend: () => {
                if (anchorTagState?.href?.isOpen) {
                    anchorTagState.href.isOpen = false;
                }

                if (commentTagState?.id?.isOpen) {
                    commentTagState.id.isOpen = false;
                }

                if (tableTagState?.dataWidth?.isOpen) {
                    tableTagState.dataWidth.isOpen = false;
                }

                if (tableTagState?.dataColumnWidths?.isOpen) {
                    tableTagState.dataColumnWidths.isOpen = false;
                }
            },

            oncdata: noop,
            oncomment: noop,
            ondeclaration: noop,
            onend: noop,
            onprocessinginstruction: noop,
            onselfclosingtag: noop,
        },
    );

    tokenizer.write(node.value);

    const actualReplacements = await runAllPromises(
        replacements
            // We must apply replacements in reverse order to avoid index shifting.
            .sort((a, b) => b.startIndex - a.startIndex)
            .map(async ({startIndex, endIndex, string}) => ({
                startIndex,
                endIndex,
                string: await string,
            })),
    );

    let newValue = node.value;

    for (const {startIndex, endIndex, string} of actualReplacements) {
        if (string === null) continue;
        newValue = newValue.slice(0, startIndex) + string + newValue.slice(endIndex);
    }

    return {...node, value: newValue};
}

function* splitMarkdownTreeIntoParts(root: Root): IterableIterator<Array<BlockContent>> {
    const contents = root.children as Array<BlockContent | DefinitionContent>;

    let index = 0;
    while (index < contents.length) {
        const content = contents[index]!;
        index++;

        // Ignore definitions.
        if (content.type === "definition" || content.type === "footnoteDefinition") {
            continue;
        }

        // Optimization: Split lists into each top-level list item. This way we get more
        // parts while streaming.
        else if (content.type === "list") {
            for (let childIndex = 0; childIndex < content.children.length; childIndex++) {
                const item = content.children[childIndex]!;

                yield [
                    {
                        type: "list",
                        ordered: content.ordered,
                        // Only set the order start for the first item in the list. Consecutive ordered
                        // list items do not need `start` values.
                        start: childIndex === 0 ? content.start : undefined,
                        children: [item],
                        position: item.position,
                    },
                ];
            }
        }

        // If this is table HTML then the entire table should be yielded as a single part.
        // So wait until we see the closing `</table>` tag before yielding.
        else if (content.type === "html" && content.value.match(/<table[^a-z0-9-]/i)) {
            const tableContents: Array<BlockContent> = [content];

            while (index < contents.length) {
                const nextContent = contents[index]!;
                index++;

                if (
                    nextContent.type !== "definition" &&
                    nextContent.type !== "footnoteDefinition"
                ) {
                    tableContents.push(nextContent);
                }

                if (nextContent.type === "html" && nextContent.value.match(/<\/table[^a-z0-9-]/i)) {
                    break;
                }
            }

            yield tableContents;
        }

        // By default, yield the block content.
        else {
            yield [content];
        }
    }
}

function removeOrderStartFromOrderedListItemsIfNeeded(
    content: Array<BlockContent>,
    previousParts:
        | {
              type: "BlockContent";
              content: Array<BlockContent>;
          }
        | {
              type: "AgentMessageStreamPart";
              previousPartIndex: number;
              streamParts: Array<AgentWebMarkdownStreamPart>;
          }
        | undefined,
) {
    // If the content is not a list or it's not an ordered list, no-op
    if (content[0]?.type !== "list" || !content[0].ordered) return;

    let previousListItemNumber = getPreviousListItemNumberFromPreviousPart(previousParts);

    for (let i = 0; i < content.length; i++) {
        const item = content[i]!;

        if (item.type !== "list") break;

        const currentListStart = item.start;

        // Two conditions to remove the order start:
        //
        // 1. This list element starts at 1 and was not preceded by an ordered list item.
        //    there's no need to set explicit order start for lists starting at 1.
        // 2. This list element starts at the next number in the sequence of the previous
        //    list element (e.g. the previous list element ended at 3 and this list element
        //    starts at 4).
        if (
            (previousListItemNumber === undefined && currentListStart === 1) ||
            (previousListItemNumber !== undefined &&
                currentListStart === previousListItemNumber + 1)
        ) {
            content[i] = {
                ...item,
                start: undefined,
            };
        }

        // If the list element starts at 1 and was preceded by an ordered list item, we
        // need to preserve the explicit order start of 1. See the comment for
        // `addOrderedStartSpanToFirstItemInOrderedListIfNeeded` in
        // `print_api_content_to_markdown.ts` for more details.
        if (previousListItemNumber !== undefined && currentListStart === 1) {
            if (currentListStart === 1) {
                const firstItem = item.children[0]!;
                const firstItemContentElement = firstItem.children[0];

                if (firstItemContentElement?.type === "paragraph") {
                    firstItemContentElement.children.unshift({
                        type: "html",
                        value: `<span data-start=\u201D${currentListStart}\u201D/>`,
                    });
                } else {
                    firstItem.children.unshift({
                        type: "html",
                        value: `<span data-start=\u201D${currentListStart}\u201D/>`,
                    });
                }
            }
        }

        if (currentListStart !== null && currentListStart !== undefined) {
            previousListItemNumber = currentListStart;
        }
    }
}

function getPreviousListItemNumberFromPreviousPart(
    previousParts:
        | {
              type: "BlockContent";
              content: Array<BlockContent>;
          }
        | {
              type: "AgentMessageStreamPart";
              previousPartIndex: number;
              streamParts: Array<AgentWebMarkdownStreamPart>;
          }
        | undefined,
): number | undefined {
    if (previousParts === undefined) return undefined;

    if (previousParts.type === "AgentMessageStreamPart") {
        return getPreviousListOrderStartFromPreviousAgentMessageStreamPart(previousParts);
    } else {
        return getPreviousListOrderStartFromPreviousBlockContent(previousParts.content);
    }
}

/**
 * This function looks backward from the list of block content until either:
 *
 * 1. It finds a non-ordered list
 * 2. It finds a list with an explicit order start.
 *
 * Once it finds a non-ordered list OR an explicit order start, it adds them
 * together to determine where the list ended. For example, if `orderStart = 5` and
 * there are 3 items, the list ended at `7`.
 */
function getPreviousListOrderStartFromPreviousBlockContent(
    previousBlockContent: Array<BlockContent>,
): number | undefined {
    const {numberOfItemsInList, previousListOrderStart} =
        getListStartAndPreviousNumberOfItemsInListIfExists(previousBlockContent, {
            isOrderedList: element => element.type === "list" && !!element.ordered,
            getOrderStart: element => {
                assert(element.type === "list");
                return element.start ?? undefined;
            },
        });

    if (previousListOrderStart || numberOfItemsInList > 0) {
        return (previousListOrderStart ?? 1) + (numberOfItemsInList - 1);
    }

    return undefined;
}

/*
 * The message stream parts is a 2D array of Content (Array<Array<ApiMessageStreamPartPayload>>).
 * This function looks backward from the stream parts until either:
 * 1. It finds a non-ordered list
 * 2. It finds a list with an explicit order start.
 *
 * So for each stream part, it searches backward through the through the ApiMessageStreamPartPayload
 * elements.
 *
 * Once it finds a non-ordered list OR an explicit order start, it adds them together to determine
 * where the list ended. For example, if `orderStart = 5` and there are 3 items, the list ended
 * at `7`.
 */
function getPreviousListOrderStartFromPreviousAgentMessageStreamPart({
    previousPartIndex,
    streamParts,
}: {
    previousPartIndex: number;
    streamParts: Array<AgentWebMarkdownStreamPart>;
}): number | undefined {
    let numberOfItemsInPreviousList = 0;
    let previousListOrderStart: number | undefined = undefined;

    const previousPart = streamParts[previousPartIndex];
    if (previousPart?.payload.type !== "Content") return undefined;

    // Look backwards until we find a non-ordered list.
    for (let i = previousPartIndex; i >= 0; i--) {
        const streamPart = streamParts[i]!;
        if (streamPart.payload.type !== "Content") break;

        const response = getListStartAndPreviousNumberOfItemsInListIfExists(
            streamPart.payload.content.elements,
            {
                isOrderedList: element => element.type === "OrderedList",
                getOrderStart: element => {
                    assert(element.type === "OrderedList");
                    return element.orderStart ?? undefined;
                },
            },
        );

        // If the previous element did not contain an ordered list at all, stop traversing.
        if (response.previousListOrderStart === undefined && response.numberOfItemsInList === 0) {
            break;
        }

        previousListOrderStart = response.previousListOrderStart;
        numberOfItemsInPreviousList += response.numberOfItemsInList;

        if (previousListOrderStart !== undefined) break;
    }

    if (previousListOrderStart || numberOfItemsInPreviousList > 0) {
        return (previousListOrderStart ?? 1) + (numberOfItemsInPreviousList - 1);
    }
}

/**
 * Traverses a list of parts in reverse order until it finds a non-ordered list or
 * an ordered list with an explicit order start.
 */
function getListStartAndPreviousNumberOfItemsInListIfExists<
    Part extends BlockContent | ApiContentBlockElement,
>(
    parts: ReadonlyArray<Part>,
    {
        isOrderedList,
        getOrderStart,
    }: {
        numberOfItemsInList?: number;
        previousListOrderStart?: number | undefined;
        isOrderedList: (element: Part) => boolean;
        getOrderStart: (element: Part) => number | undefined;
    },
): {numberOfItemsInList: number; previousListOrderStart: number | undefined} {
    let numberOfItemsInList = 0;
    let previousListOrderStart: number | undefined = undefined;

    for (let i = parts.length - 1; i >= 0; i--) {
        const element = parts[i]!;

        if (!isOrderedList(element)) break;

        previousListOrderStart = getOrderStart(element);
        numberOfItemsInList++;

        if (previousListOrderStart !== undefined) break;
    }

    return {
        numberOfItemsInList,
        previousListOrderStart,
    };
}

function printAgentWebPageKeyToLinkUrl(
    key: AgentWebPageKeyObject,
    options: {spaceId: SpaceId; isAccountShortName: boolean | undefined},
): string {
    switch (key.type) {
        case "Account":
        case "Channel":
        case "Document":
        case "Task":
        case "TaskCollection":
            return printApiMentionTargetToMentionLinkUrl(key, options);
        case "ChatMessages":
            return printApiMentionTargetToMentionLinkUrl({type: "Chat", id: key.id}, options);
        case "PostMessages":
            return printApiMentionTargetToMentionLinkUrl({type: "Post", id: key.id}, options);
        case "DocumentMessages":
            return `https://alpine.inc/s/${options.spaceId}/documents/${key.id}?comments=${key.threadId}`;
        case "TaskMessages":
            return printApiMentionTargetToMentionLinkUrl({type: "Task", id: key.id}, options);
        default:
            throw exhaustive(key);
    }
}
