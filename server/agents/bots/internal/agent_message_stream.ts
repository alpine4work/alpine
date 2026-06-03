import {BlockContent, DefinitionContent, Parent, Root} from "mdast";
import {
    parseApiContentFromMarkdownTree,
    parseMarkdownTree,
} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiPath,
    isApiMentionReferencePath,
    isApiNotMentionReferencePath,
    parseApiMentionReference,
    parseApiNotMentionReference,
} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiContentBlockElement,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AgentMessageStreamPart = {
    readonly index: number;
    readonly payload: ApiMessageStreamPartPayload;
};

/**
 * Manages message streaming for agents. You stream text into this class with
 * `pushText()` and you turn that text into parts with `update()`.
 *
 * NOTE(calebmer): This class would make more sense in `//server/agents/bots` since
 * it's specifically geared for LLM stream processing but we want to have access to
 * this class for the tests in this file.
 */
export class AgentMessageStream {
    private readonly _spaceId: SpaceId;
    private readonly _getTargetPathIfExists: (linkPath: string) => Promise<ApiPath | null>;

    private _textState: {
        // When you call `pushText()` you must pass in a `TracerSpan`. This is the latest
        // span passed into `pushText()`. The `putApiMessageStreamPart()` call for this
        // content will use this span as its parent.
        //
        // Most of the time, `pushText()` is called with the same span (this is the case
        // for the ChatGPT agent at least). For the ChatGPT agent we want the content part
        // span to be a child of the "OpenAI output item message" span created by
        // `open_ai_client.ts`.
        latestSpan: TracerSpan;
        text: string;
    } | null = null;

    private _parts: Array<AgentMessageStreamPart> = [];

    constructor({
        spaceId,
        getTargetPathIfExists,
    }: {
        spaceId: SpaceId;
        getTargetPathIfExists: (linkPath: string) => Promise<ApiPath | null>;
    }) {
        this._spaceId = spaceId;
        this._getTargetPathIfExists = getTargetPathIfExists;
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
    public pushText(span: TracerSpan, text: string) {
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
        updateSpan: TracerSpan,
        newPartPayloads: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>> = [],
    ): Promise<Array<{span: TracerSpan; part: AgentMessageStreamPart}>> {
        const putParts: Array<{span: TracerSpan; part: AgentMessageStreamPart}> = [];

        const markdownParts = await this._parseTextIntoMarkdownParts();
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
                        {spaceId: this._spaceId},
                    );
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

                    const firstPart: AgentMessageStreamPart = {
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

                    const firstPart: AgentMessageStreamPart = {
                        index: this._parts.length - 1,
                        payload: {type: "Content", content: getFirstPartContent()},
                    };

                    // We only need to update the last part if it actually changed.
                    if (!isDeepEqual(this._parts[this._parts.length - 1], firstPart)) {
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
                    {spaceId: this._spaceId},
                );

                const part: AgentMessageStreamPart = {
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

                const part: AgentMessageStreamPart = {
                    index: this._parts.length,
                    payload: newPartPayload,
                };

                putParts.push({span: updateSpan, part});
                this._parts.push(part);
            }
        }

        return putParts;
    }

    private async _parseTextIntoMarkdownParts(): Promise<ReadonlyArray<Array<BlockContent>>> {
        const textState = this._textState;
        if (textState === null) return emptyArray;

        let text = textState.text;
        if (text.length === 0) return emptyArray;

        // If the text ends with an incomplete HTML tag then remove it from the text.
        // Expect to get the rest of our HTML tag later from the LLM.
        const incompleteHtmlTagMatch = text.match(
            // eslint-disable-next-line no-control-regex
            /<\/?[a-zA-Z][a-zA-Z0-9-]*[\x00-\x3D\x3F-\x7F]*$/,
        );
        if (incompleteHtmlTagMatch) {
            text = text.slice(0, -incompleteHtmlTagMatch[0].length);
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

                if (childNode.type === "link") {
                    promiseWaiter.waitUntil(async () => {
                        // TODO(ifitzsimmons, #format-non-mentionable-content): If the link is not
                        // mentionable, `targetPath` will be null. We need to build a plain link for non
                        // mentionable content and we also need to swap the label so something more user
                        // friendly (`mentionLabel`).
                        const targetPath = await this._getTargetPathIfExists(childNode.url);

                        if (!targetPath) return null;

                        if (isApiMentionReferencePath(targetPath)) {
                            const mentionTarget = parseApiMentionReference(targetPath);

                            node.children[index] = {
                                type: "link",
                                url: printApiMentionReferenceToMentionUrl(mentionTarget, {
                                    spaceId: this._spaceId,
                                    isAccountShortName: undefined,
                                }),
                                children: childNode.children,
                                position: childNode.position,
                            };
                        } else {
                            // If it's not mentionable, we'll create a direct link to the content. For exampe,
                            // the link to a chat message will look someting like
                            // `/chats/${chatId}?message=${messageIndex}
                            assert(isApiNotMentionReferencePath(targetPath));
                            const targetPathObject = parseApiNotMentionReference(targetPath);

                            node.children[index] = {
                                type: "link",
                                url: printAppUrlFromApiNotMentionPath(targetPathObject, {
                                    spaceId: this._spaceId,
                                }),
                                children: childNode.children,
                                position: childNode.position,
                            };
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

        return Array.from(splitMarkdownTreeIntoParts(markdownRoot));
    }
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
              streamParts: Array<AgentMessageStreamPart>;
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
              streamParts: Array<AgentMessageStreamPart>;
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
    streamParts: Array<AgentMessageStreamPart>;
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
