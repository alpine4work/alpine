import {BlockContent, DefinitionContent, Parent, PhrasingContent, Root} from "mdast";
import {
    parseApiContentFromMarkdownTree,
    parseMarkdownTree,
} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {
    printApiContentMentionInlineElementTargetPathToMentionLinkUrl,
    printAppUrlFromApiNotMentionPath,
} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiPath,
    isApiMentionPath,
    isApiNotMentionPath,
    parseApiMentionPath,
    parseApiNotMentionPath,
} from "~/shared/api/parse_api_path.js";
import {ApiMessageStreamPartPayload} from "~/shared/api/types/api_specification_convenience_types.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type AgentMessageStreamPart = {
    readonly index: number;
    readonly payload: ApiMessageStreamPartPayload;
};

/**
 * Manages message streaming for agents. You stream text into this class with
 * `pushText()` and you turn that text into parts with `update()`.
 *
 * NOTE(calebmer): This class would make more sense in `//server/agents` since
 * it's specifically geared for LLM stream processing but we want to have
 * access to this class for the tests in this file.
 */
export class AgentMessageStream {
    private readonly _spaceId: SpaceId;
    private readonly _getTargetPathIfExists: (linkPath: string) => Promise<ApiPath | null>;

    private _text = "";
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
    public pushText(text: string) {
        this._text += text;
    }

    /**
     * Update the parts of `AgentStreamMessage`. Returns parts we should `PUT` into
     * the stream. Only ever returns an update to the last part (as of when this
     * was called) and new parts after that. Only the last part of a stream can be
     * updated at any given time. Always returns parts with the right `index`.
     *
     * Roughly each Markdown block is turned into a part. This balances performance
     * and correctness. We don't want to update the entire agent message at once
     * while it's streaming but we need a blocks worth of content to correctly
     * parse styles like bold and italics.
     *
     * You may pass in `newParts` to add non-content parts to the stream.
     */
    public async update(
        newPartPayloads: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>> = [],
    ): Promise<Array<AgentMessageStreamPart>> {
        const putParts: Array<AgentMessageStreamPart> = [];

        const markdownParts = await this._parseTextIntoMarkdownParts();
        if (markdownParts.length > 0) {
            const originalText = this._text;

            // The first Markdown part updates the last part in `AgentStreamMessage`. Or if
            // there are no parts in `AgentStreamMessage` yet it creates the first part.
            {
                const firstMarkdownPart = markdownParts[0]!;

                const firstPartContent = parseApiContentFromMarkdownTree(
                    {type: "root", children: firstMarkdownPart},
                    {spaceId: this._spaceId},
                );

                if (
                    this._parts.length === 0 ||
                    // If the last part is not content (e.g. a tool call) then create a new content
                    // part instead of updating the last part.
                    this._parts[this._parts.length - 1]!.payload.type !== "Content"
                ) {
                    const firstPart: AgentMessageStreamPart = {
                        index: this._parts.length,
                        payload: {type: "Content", content: firstPartContent},
                    };

                    putParts.push(firstPart);
                    this._parts.push(firstPart);
                } else {
                    const firstPart: AgentMessageStreamPart = {
                        index: this._parts.length - 1,
                        payload: {type: "Content", content: firstPartContent},
                    };

                    // We only need to update the last part if it actually changed.
                    if (!isDeepEqual(this._parts[this._parts.length - 1]!, firstPart)) {
                        putParts.push(firstPart);
                        this._parts[this._parts.length - 1] = firstPart;
                    }
                }
            }

            // The remaining parts are newly created. We update `this._text` to exclude the
            // previous part (which can no longer be updated, only this new part can be
            // updated).
            for (let index = 1; index < markdownParts.length; index++) {
                const markdownPart = markdownParts[index]!;

                const partContent = parseApiContentFromMarkdownTree(
                    {type: "root", children: markdownPart},
                    {spaceId: this._spaceId},
                );

                const part: AgentMessageStreamPart = {
                    index: this._parts.length,
                    payload: {type: "Content", content: partContent},
                };

                putParts.push(part);
                this._parts.push(part);

                const previousMarkdownPart = markdownParts[index - 1]!;
                assert(previousMarkdownPart.length > 0);
                const previousMarkdownPartLastContent =
                    previousMarkdownPart[previousMarkdownPart.length - 1]!;
                assert(previousMarkdownPartLastContent.position?.end.offset !== undefined);

                this._text = originalText.slice(
                    previousMarkdownPartLastContent.position.end.offset,
                );
            }
        }

        if (newPartPayloads.length > 0) {
            // Reset the text. Any new text won't be replacing previous parts. It'll create
            // new parts.
            this._text = "";

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

                putParts.push(part);
                this._parts.push(part);
            }
        }

        return putParts;
    }

    private async _parseTextIntoMarkdownParts(): Promise<Array<Array<BlockContent>>> {
        let text = this._text;

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
            // TODO(ifitzsimmons, #ai): remove this mdast patch
            // Allow parsing `Check out [My Document][]` as a link even if there is no
            // definition for `My Document`. We'll figure out the right link in our code.
            allowUndefinedLinkReferenceIdentifiers: true,
            // Allow parsing `The quick **brown fox` as bold from `**` to the end of the
            // text. Since while streaming Markdown we have to wait for the ending `**`.
            allowAttentionWithoutClose: true,
            // Allow parsing ``The quick `brown fox`` as bold from `` ` `` to the end of
            // the text. Since while streaming Markdown we have to wait for the ending
            // `` ` ``.
            allowCodeTextWithoutClose: true,
            // Allow parsing `The quick [brown fox` and discard link characters so it's
            // interpreted as `The quick brown fox`.
            allowLabelWithoutClose: true,
        });

        const promiseWaiter = new PromiseWaiter();

        // Loop through our Markdown content. All of our internal links are stored as
        // shorthand link representations. So for a Document titled "Dinosaurs are cool",
        // the markdown link looks like "[Dinosaurs are cool](document/dinosaurs-are-cool)"
        // We do this for token efficiency and also to give the LLM more context about the
        // linked content. When streaming these links back to the client, we need to replace
        // the shorthand link with the actual link to the internal entity.
        const traverse = (node: Parent) => {
            for (let index = 0; index < node.children.length; index++) {
                const childNode = node.children[index]!;

                if (childNode.type === "link") {
                    promiseWaiter.waitUntil(async () => {
                        // TODO(ifitzsimmons, #format-non-mentionable-content): If the link
                        // is not mentionable, `targetPath` will be null. We need to build a
                        // plain link for non mentionable content and we also need to swap
                        // the label so something more user friendly (`mentionLabel`).
                        const targetPath = await this._getTargetPathIfExists(childNode.url);

                        if (!targetPath) return null;

                        if (isApiMentionPath(targetPath)) {
                            const mentionTargetPathObject = parseApiMentionPath(targetPath);

                            node.children[index] = {
                                type: "link",
                                url: printApiContentMentionInlineElementTargetPathToMentionLinkUrl(
                                    mentionTargetPathObject,
                                    {spaceId: this._spaceId, isAccountShortName: undefined},
                                ),
                                children: childNode.children,
                                position: childNode.position,
                            };
                        } else {
                            // If it's not mentionable, we'll create a direct link to the content.
                            // For exampe, the link to a chat message will look someting like
                            // `/chats/${chatId}?message=${messageIndex}
                            assert(isApiNotMentionPath(targetPath));
                            const targetPathObject = parseApiNotMentionPath(targetPath);

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

        // Optimization: Split lists into each top-level list item. This way we get
        // more parts while streaming.
        else if (content.type === "list") {
            for (let childIndex = 0; childIndex < content.children.length; childIndex++) {
                const item = content.children[childIndex]!;

                yield [
                    {
                        type: "list",
                        ordered: content.ordered,
                        start: content.ordered ? (content.start ?? 1) + childIndex : undefined,
                        children: [item],
                        position: item.position,
                    },
                ];
            }
        }

        // If this is table HTML then the entire table should be yielded as a single
        // part. So wait until we see the closing `</table>` tag before yielding.
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

export function printMarkdownPhrasingContentText(contents: ReadonlyArray<PhrasingContent>): string {
    let text = "";

    const print = (contents: ReadonlyArray<PhrasingContent>) => {
        for (const content of contents) {
            switch (content.type) {
                case "text":
                case "inlineCode":
                case "inlineMath": {
                    text += content.value;
                    break;
                }
                case "link":
                case "delete":
                case "emphasis":
                case "linkReference":
                case "strong": {
                    print(content.children);
                    break;
                }
                case "break":
                case "footnoteReference":
                case "html":
                case "image":
                case "imageReference": {
                    break;
                }
                default:
                    throw exhaustive(content);
            }
        }
    };

    print(contents);

    return text;
}
