import natural from "natural";
import {Fragment, Mark, Node} from "prosemirror-model";
import {CohereEmbedEnglishV3Tokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_tokenizer.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {clampListItemIndentation} from "~/shared/content/content_schema.js";
import {clampHeadingLevel} from "~/shared/content/content_schema_extra.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
    ContentMarkTypeName,
    ContentTextblockNodeTypeName,
} from "~/shared/content/content_type_names.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, ContentMentionAccountId} from "~/shared/id/types/id_types.js";

type RecursiveIterable<T> = Iterable<T | RecursiveIterable<T>>;

function mapRecursiveIterable<Value, NewValue>(
    iterable: RecursiveIterable<Value>,
    map: (value: Value) => NewValue,
): RecursiveIterable<NewValue> {
    return mapIterable(iterable, value => {
        if ((value as any)[Symbol.iterator])
            return mapRecursiveIterable(value as RecursiveIterable<Value>, map);

        return map(value as Value);
    });
}

/**
 * Take arbitrary content and divide it into `SearchContentChunk`s of the ideal
 * length for our LLM (Cohere). We divide content into chunks along the natural
 * structure of the document. (e.g. Headings create separate chunks.)
 *
 * Also prints our content to Markdown formatted text which we can index in
 * OpenSearch for keyword search.
 *
 * Picking good chunks for an LLM can be more art than science. For an
 * introduction to chunking strategies see [this blog post from Pinecone][1].
 * Chunks also can't be context-less.
 *
 * You should add some preamble to chunks so the LLM can better understand
 * what's in the content. A good discussion on adding context to chunks is in
 * [this reply on the OpenAI forums][2]. To add context to chunks implement the
 * `getChunkPreamble` function.
 *
 * [1]: https://www.pinecone.io/learn/chunking-strategies/
 * [2]: https://community.openai.com/t/the-length-of-the-embedding-contents/111471/7
 */
export async function chunkSearchContent(
    content: Node,
    {
        tokenizer,
        getAccountIfExists,
        getChunkPreamble = () => ({text: "", lineMarginBottom: 0}),
    }: {
        tokenizer: CohereEmbedEnglishV3Tokenizer;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
        getChunkPreamble?: (options: {
            context: SearchContentChunkContext;
            isInitialChunk: boolean;
        }) => {text: string; lineMarginBottom: number};
    },
): Promise<{
    getFullText: () => string;
    embeddingChunks: Array<{
        preambleEndIndex: number;
        tokenCountWithoutPreamble: number;
        text: string;
    }>;
}> {
    const chunk = await getFullSearchContentChunk(content, {tokenizer, getAccountIfExists});

    const splitChunks = splitSearchContentChunk(chunk, {
        tokenizer,
        getChunkPreamble,
    });

    return {
        getFullText: () =>
            printSearchContentChunk({preamble: {text: "", lineMarginBottom: 0}, body: chunk}).text,
        embeddingChunks: splitChunks.map(chunk => printSearchContentChunk(chunk)),
    };
}

/**
 * A search content chunk is some slice of content (printed to Markdown
 * formatted text) following the content's structure.
 *
 * Chunks are represented as a tree where each level of the tree represents
 * a different level of structure (e.g. headings, paragraphs, list items,
 * sentences). The highest level of the tree represents the highest level of
 * structure (e.g. sections created by headings). While producing our final
 * chunk list we try to keep as much structure intact as possible.
 */
export type SearchContentChunk =
    | {
          isGroup: false;
          tokenCount: number;
          context: SearchContentChunkContext;
          sentenceChunks: Array<{text: string; tokenCount: number}>;
          lineMarginTop: number;
          lineMarginBottom: number;
      }
    | {
          isGroup: true;
          tokenCount: number;
          context: SearchContentChunkContext;
          childChunks: Array<SearchContentChunk>;
      };

export type SearchContentChunkContext = {
    sectionHeading: string | null;
};

/**
 * Convert arbitrary content into a chunk tree where the leaf nodes are
 * sentences (printed to Markdown formatted text). Each level of the tree
 * represents a different level of structure.
 */
export async function getFullSearchContentChunk(
    content: Node,
    {
        tokenizer,
        getAccountIfExists,
    }: {
        tokenizer: CohereEmbedEnglishV3Tokenizer;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
) {
    // Take our content and divide it into structured chunks of any size. We use
    // the structure of the content to chunk. Headings create sections, child list
    // items stay with their parent list item, and sentences are chunked together.
    const chunkIterable: RecursiveIterable<
        Promise<{
            sentenceChunks: Array<string>;
            lineMarginTop: number;
            lineMarginBottom: number;
            sectionHeading: string | null;
        }>
    > = mapIterable(chunkSearchContentBySections(content.content), contentChunk => {
        // The heading fragment should not get `sectionHeading` context. Only the
        // content below it.
        return contentChunk.headingFragment
            ? concatIterables(
                  next(contentChunk.headingFragment, null),
                  next(contentChunk.fragment, contentChunk.sectionHeadingNode),
              )
            : next(contentChunk.fragment, contentChunk.sectionHeadingNode);

        function next(fragment: Fragment, sectionHeadingNode: Node | null) {
            const sectionHeadingPromise = sectionHeadingNode
                ? printSearchTextForInlineFragment(sectionHeadingNode.content, {
                      getAccountIfExists,
                  })
                : null;

            return mapRecursiveIterable(
                chunkSearchContentByIntroduction(chunkSearchContentByParagraphs(fragment)),
                fragment =>
                    mapRecursiveIterable(chunkSearchContentByListItems(fragment), fragment =>
                        runAllPromises([
                            sectionHeadingPromise,
                            chunkSearchContentBySentenceForBlockFragment(content, fragment, {
                                orderListItemNumberByNode: new Map(),
                                getAccountIfExists,
                            }),
                        ]).then(([sectionHeading, chunk]) => ({...chunk, sectionHeading})),
                    ),
            );
        }
    });

    // Consumes the structured chunk iterable recursively and turns it into a tree
    // object. We also product a token count at each level of the tree.
    const processChunkIterable = async (
        chunkIterable: RecursiveIterable<
            Promise<{
                sentenceChunks: Array<string>;
                lineMarginTop: number;
                lineMarginBottom: number;
                sectionHeading: string | null;
            }>
        >,
    ): Promise<SearchContentChunk> => {
        let tokenCount1 = 0;

        const chunks = await runAllPromises(
            mapIterable(chunkIterable, async (chunkPromise): Promise<SearchContentChunk> => {
                if (!(chunkPromise instanceof Promise)) {
                    const chunk = await processChunkIterable(chunkPromise);
                    tokenCount1 += chunk.tokenCount;
                    return chunk;
                }

                const chunk = await chunkPromise;

                let tokenCount2 = 0;

                const sentenceChunks = chunk.sentenceChunks.map(sentenceChunk => {
                    const tokenCount = tokenizer.countTokens(sentenceChunk);
                    tokenCount1 += tokenCount;
                    tokenCount2 += tokenCount;
                    return {text: sentenceChunk, tokenCount};
                });

                return {
                    isGroup: false,
                    tokenCount: tokenCount2,
                    context: {sectionHeading: chunk.sectionHeading},
                    sentenceChunks,
                    lineMarginTop: chunk.lineMarginTop,
                    lineMarginBottom: chunk.lineMarginBottom,
                };
            }),
        );

        // Flatten singleton nesting levels.
        if (chunks.length === 1) {
            return chunks[0]!;
        }

        // A group's context must be the same as every child chunk's context.
        let context = null;
        if (chunks.length > 0) {
            context = chunks[0]!.context;
            for (let i = 1; i < chunks.length; i++) {
                const chunk = chunks[i]!;

                if (!isDeepEqual(context, chunk.context)) {
                    context = null;
                    break;
                }
            }
        }

        return {
            isGroup: true,
            context: context ?? {sectionHeading: null},
            tokenCount: tokenCount1,
            childChunks: chunks,
        };
    };

    return processChunkIterable(chunkIterable);
}

/**
 * Split a full search content chunk into chunks no larger than
 * `maxTokenCount`. We follow the structure of the chunk tree. Ideally
 * splitting at the highest level.
 *
 * We don't divide smaller than sentences. A sentence with more tokens than
 * `maxTokenCount` will be maintained. This means you may get a chunk with more
 * tokens than `maxTokenCount`.
 */
function splitSearchContentChunk(
    chunk: SearchContentChunk,
    {
        tokenizer,
        getChunkPreamble: _getChunkPreamble,
    }: {
        tokenizer: CohereEmbedEnglishV3Tokenizer;
        getChunkPreamble: (options: {
            context: SearchContentChunkContext;
            isInitialChunk: boolean;
        }) => {text: string; lineMarginBottom: number};
    },
): Array<{
    preamble: {text: string; lineMarginBottom: number; tokenCount: number};
    body: SearchContentChunk;
}> {
    const getChunkPreamble = (
        context: SearchContentChunkContext,
        {isInitialChunk = false}: {isInitialChunk?: boolean} = {},
    ) => {
        const preamble = _getChunkPreamble({
            context,
            isInitialChunk,
        });
        return {
            text: preamble.text,
            lineMarginBottom: preamble.lineMarginBottom,
            tokenCount: tokenizer.countTokens(preamble.text),
        };
    };

    let nextChunkPreamble: {text: string; lineMarginBottom: number; tokenCount: number} | null =
        getChunkPreamble(chunk.context, {isInitialChunk: true});
    const splitChunks: Array<{
        preamble: {text: string; lineMarginBottom: number; tokenCount: number};
        body: SearchContentChunk;
    }> = [];

    // Takes our structured chunk and splits it into smaller chunks of appropriate
    // size for the LLM. In Cohere's case it performs best with <512 tokens at
    // a time.
    const split = (chunk: SearchContentChunk) => {
        nextChunkPreamble ??= getChunkPreamble(chunk.context);

        if (chunk.tokenCount <= tokenizer.idealMaxEmbedTokenCount - nextChunkPreamble.tokenCount) {
            splitChunks.push({preamble: nextChunkPreamble, body: chunk});
            nextChunkPreamble = null;
            return;
        }

        if (!chunk.isGroup) {
            let workingGroupTokenCount = 0;
            let workingGroupSentenceChunks: Array<{text: string; tokenCount: number}> = [];

            for (const sentenceChunk of chunk.sentenceChunks) {
                nextChunkPreamble ??= getChunkPreamble(chunk.context);

                if (
                    workingGroupTokenCount + sentenceChunk.tokenCount >
                    tokenizer.idealMaxEmbedTokenCount - nextChunkPreamble.tokenCount
                ) {
                    splitChunks.push({
                        preamble: nextChunkPreamble,
                        body: {
                            isGroup: false,
                            tokenCount: workingGroupTokenCount,
                            context: chunk.context,
                            sentenceChunks: workingGroupSentenceChunks,
                            // Margin doesn't matter in a split chunk since there's no content before
                            // or after.
                            lineMarginTop: 0,
                            lineMarginBottom: 0,
                        },
                    });
                    nextChunkPreamble = null;

                    workingGroupTokenCount = 0;
                    workingGroupSentenceChunks = [];
                }

                // Unlike what we do for groups, if this one sentence is above `maxTokenCount`
                // we don't recursively split it since we don't want to split in the middle of
                // a sentence.
                workingGroupTokenCount += sentenceChunk.tokenCount;
                workingGroupSentenceChunks.push(sentenceChunk);
            }

            nextChunkPreamble ??= getChunkPreamble(chunk.context);

            if (workingGroupSentenceChunks.length > 0) {
                splitChunks.push({
                    preamble: nextChunkPreamble,
                    body: {
                        isGroup: false,
                        tokenCount: workingGroupTokenCount,
                        context: chunk.context,
                        sentenceChunks: workingGroupSentenceChunks,
                        // Margin doesn't matter in a split chunk since there's no content before
                        // or after.
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                });
                nextChunkPreamble = null;

                workingGroupTokenCount = 0;
                workingGroupSentenceChunks = [];
            }
        } else {
            let workingGroupTokenCount = 0;
            let workingGroupChildChunks: Array<SearchContentChunk> = [];

            for (const childChunk of chunk.childChunks) {
                nextChunkPreamble ??= getChunkPreamble(childChunk.context);

                if (
                    workingGroupTokenCount + childChunk.tokenCount >
                    tokenizer.idealMaxEmbedTokenCount - nextChunkPreamble.tokenCount
                ) {
                    splitChunks.push({
                        preamble: nextChunkPreamble,
                        body: {
                            isGroup: true,
                            tokenCount: workingGroupTokenCount,
                            context: chunk.context,
                            childChunks: workingGroupChildChunks,
                        },
                    });
                    nextChunkPreamble = null;

                    workingGroupTokenCount = 0;
                    workingGroupChildChunks = [];
                }

                nextChunkPreamble ??= getChunkPreamble(childChunk.context);

                // If this chunk alone is too big for our LLM's context window then recursively
                // split it into smaller chunks. Otherwise, add it to the chunk we're building.
                if (
                    childChunk.tokenCount >
                    tokenizer.idealMaxEmbedTokenCount - nextChunkPreamble.tokenCount
                ) {
                    split(childChunk);
                } else {
                    workingGroupTokenCount += childChunk.tokenCount;
                    workingGroupChildChunks.push(childChunk);
                }
            }

            if (workingGroupChildChunks.length > 0) {
                splitChunks.push({
                    preamble: nextChunkPreamble,
                    body: {
                        isGroup: true,
                        tokenCount: workingGroupTokenCount,
                        context: chunk.context,
                        childChunks: workingGroupChildChunks,
                    },
                });
                nextChunkPreamble = null;

                workingGroupTokenCount = 0;
                workingGroupChildChunks = [];
            }
        }
    };

    split(chunk);
    return splitChunks;
}

/**
 * Print a chunk to text. We put spaces in between sentences and add the
 * maximum line margin between two adjacent chunks.
 */
function printSearchContentChunk(chunk: {
    preamble: {text: string; lineMarginBottom: number};
    body: SearchContentChunk;
}): {
    preambleEndIndex: number;
    tokenCountWithoutPreamble: number;
    text: string;
} {
    const flatChunks: Array<SearchContentChunk & {isGroup: false}> = [];

    const flattenChunk = (chunk: SearchContentChunk) => {
        if (!chunk.isGroup) {
            flatChunks.push(chunk);
        } else {
            for (const childChunk of chunk.childChunks) {
                flattenChunk(childChunk);
            }
        }
    };

    flattenChunk(chunk.body);

    let text = chunk.preamble.text;
    let lastLineMargin = chunk.preamble.lineMarginBottom;

    for (let i = 0; i < flatChunks.length; i++) {
        const chunk = flatChunks[i]!;

        if (i === 0 && text.length === 0 && lastLineMargin === 0) {
            // Preamble is empty, don't add margin lines at the beginning of the text.
        } else {
            const lineMargin = Math.max(lastLineMargin, chunk.lineMarginTop);
            if (lineMargin > 0) {
                text += "\n".repeat(lineMargin);
            }
        }

        for (let j = 0; j < chunk.sentenceChunks.length; j++) {
            const sentenceChunk = chunk.sentenceChunks[j]!;

            if (j !== 0) text += " ";
            text += sentenceChunk.text;
        }

        lastLineMargin = chunk.lineMarginBottom;
    }

    return {
        preambleEndIndex: Math.min(
            chunk.preamble.text.length + chunk.preamble.lineMarginBottom,
            // If we just have the preamble and no main content then `lineMarginBottom`
            // wasn't added to `text`. Make sure we don't return an index larger than
            // `text.length`.
            text.length,
        ),
        tokenCountWithoutPreamble: chunk.body.tokenCount,
        text,
    };
}

/**
 * Chunk content into sections inferred by content structure. We use headings
 * and dividers added by the user to determine document sections. A section
 * starts with a heading or divider and spans until the next heading or
 * divider.
 */
function* chunkSearchContentBySections(fragment: Fragment): IterableIterator<{
    sectionHeadingNode: Node | null;
    headingFragment: Fragment | null;
    fragment: Fragment;
}> {
    let hasBrokenFragment = false;
    let previousHeadingNodes: Array<Node> = [];
    let previousNodes: Array<Node> = [];

    for (const node of fragment.content) {
        if (
            previousNodes.length > 0 &&
            (node.type.name === "heading" || node.type.name === "divider")
        ) {
            hasBrokenFragment = true;

            yield {
                sectionHeadingNode:
                    previousHeadingNodes.length > 0
                        ? previousHeadingNodes[previousHeadingNodes.length - 1]!
                        : null,
                headingFragment:
                    previousHeadingNodes.length > 0 ? new Fragment(previousHeadingNodes) : null,
                fragment: new Fragment(previousNodes),
            };

            previousHeadingNodes = [];
            previousNodes = [];
        }

        if (previousNodes.length === 0 && node.type.name === "heading") {
            previousHeadingNodes.push(node);
        } else {
            previousNodes.push(node);
        }
    }

    // Don't create a new `Fragment` object if we didn't break the content into sections.
    if (!hasBrokenFragment && previousHeadingNodes.length === 0) {
        yield {
            sectionHeadingNode: null,
            headingFragment: null,
            fragment,
        };
    } else if (previousNodes.length > 0) {
        yield {
            sectionHeadingNode:
                previousHeadingNodes.length > 0
                    ? previousHeadingNodes[previousHeadingNodes.length - 1]!
                    : null,
            headingFragment:
                previousHeadingNodes.length > 0 ? new Fragment(previousHeadingNodes) : null,
            fragment: new Fragment(previousNodes),
        };
    }
    // If we have only heading nodes then emit a fragment with just heading nodes.
    else if (previousHeadingNodes.length > 0) {
        yield {
            sectionHeadingNode: null,
            headingFragment: null,
            fragment: new Fragment(previousHeadingNodes),
        };
    }
}

/**
 * Chunk content by paragraphs. Each top-level block gets its own chunk
 * (paragraphs, code blocks, quote blocks) with the exception of list items.
 * Adjacent list items are included in their own chunk. Lists are read as a
 * single idea by a human and should also be read as a single idea by an LLM.
 */
function* chunkSearchContentByParagraphs(fragment: Fragment): IterableIterator<Fragment> {
    let previousListItemNodes: Array<Node> = [];

    for (const node of fragment.content) {
        if (node.type.groups.includes("listItem")) {
            previousListItemNodes.push(node);
            continue;
        }

        if (previousListItemNodes.length > 0) {
            yield new Fragment(previousListItemNodes);
            previousListItemNodes = [];
        }

        yield new Fragment([node]);
    }

    if (previousListItemNodes.length > 0) {
        yield new Fragment(previousListItemNodes);
        previousListItemNodes = [];
    }
}

/**
 * If it appears like some content introduces the following piece of content
 * then we put that content in the same chunk. Right now, the logic is quite
 * dumb. If a fragment ends with a text node the ends with the `:` character
 * then we say that fragment introduces the next fragment. A better approach
 * could be to use some simple statistical model to group related paragraphs.
 *
 * This should run at the paragraph chunk level.
 */
function* chunkSearchContentByIntroduction(
    fragments: Iterable<Fragment>,
): RecursiveIterable<Fragment> {
    let previousFragments: Array<Fragment> = [];

    for (const fragment of fragments) {
        const lastTextNode = getLastTextNodeIfExists(fragment);

        if (lastTextNode && /:\s*$/.test(lastTextNode.text ?? "")) {
            previousFragments.push(fragment);
            continue;
        }

        if (previousFragments.length === 0) {
            yield fragment;
        } else {
            yield [...previousFragments, fragment];
            previousFragments = [];
        }
    }
}

function getLastTextNodeIfExists(node: Node | Fragment): Node | null {
    const lastChildNode = node.lastChild;
    if (!lastChildNode) return null;
    if (lastChildNode.isText) return lastChildNode;
    return getLastTextNodeIfExists(lastChildNode);
}

/**
 * Recursively chunk list items. Each list item becomes its own chunk with any
 * child list items underneath it. This way if we have a really long list we
 * attempt to keep list items with their sub-items when feeding to an LLM.
 */
function* chunkSearchContentByListItems(
    fragment: Fragment,
    {shouldSkipFirstNode = false}: {shouldSkipFirstNode?: boolean} = {},
): RecursiveIterable<Fragment> {
    if (fragment.content.length <= 1) {
        yield fragment;
        return;
    }

    let state:
        | {
              isWithinListItem: false;
              previousNodes: Array<Node>;
          }
        | {
              isWithinListItem: true;
              parentListItemNode: Node;
              parentListItemIndent: number;
              childListItemNodes: Array<Node>;
          } = {
        isWithinListItem: false,
        previousNodes: [],
    };

    let hasIterated = false;

    for (let i = 0; i < fragment.content.length; i++) {
        const node = fragment.content[i]!;

        const shouldSkip = shouldSkipFirstNode && !hasIterated;
        hasIterated = true;

        if (shouldSkip || !node.type.groups.includes("listItem")) {
            if (!state.isWithinListItem) {
                state.previousNodes.push(node);
            } else {
                yield chunkSearchContentByListItems(
                    new Fragment([state.parentListItemNode, ...state.childListItemNodes]),
                    // We know the first node is a `listItem`. Skip it to avoid infinite recursion.
                    {shouldSkipFirstNode: true},
                );

                state = {
                    isWithinListItem: false,
                    previousNodes: [node],
                };
            }
        } else {
            const indent = clampListItemIndentation(node.attrs.indent);

            if (!state.isWithinListItem) {
                if (state.previousNodes.length > 0) {
                    yield new Fragment(state.previousNodes);
                }

                state = {
                    isWithinListItem: true,
                    parentListItemNode: node,
                    parentListItemIndent: indent,
                    childListItemNodes: [],
                };
            } else if (state.parentListItemIndent < indent) {
                state.childListItemNodes.push(node);
            } else {
                yield chunkSearchContentByListItems(
                    new Fragment([state.parentListItemNode, ...state.childListItemNodes]),
                    // We know the first node is a `listItem`. Skip it to avoid infinite recursion.
                    {shouldSkipFirstNode: true},
                );

                state = {
                    isWithinListItem: true,
                    parentListItemNode: node,
                    parentListItemIndent: indent,
                    childListItemNodes: [],
                };
            }
        }
    }

    if (!state.isWithinListItem) {
        if (state.previousNodes.length > 0) {
            yield new Fragment(state.previousNodes);
        }
    } else {
        yield chunkSearchContentByListItems(
            new Fragment([state.parentListItemNode, ...state.childListItemNodes]),
            // We know the first node is a `listItem`. Skip it to avoid infinite recursion.
            {shouldSkipFirstNode: true},
        );
    }
}

async function chunkSearchContentBySentenceForBlockFragment(
    parentNode: Node,
    fragment: Fragment,
    options: {
        orderListItemNumberByNode: Map<Node, number>;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
): Promise<{sentenceChunks: Array<string>; lineMarginTop: number; lineMarginBottom: number}> {
    const chunks = await runAllPromises(
        fragment.content.map(node =>
            chunkSearchContentBySentenceForBlockNode(parentNode, node, options),
        ),
    );

    const sentenceChunks = chunks.flatMap((chunk, i) => {
        if (i === 0) return chunk.sentenceChunks;

        const lastChunk = chunks[i - 1]!;
        const lineMargin = Math.max(lastChunk.lineMarginBottom, chunk.lineMarginTop);

        if (chunk.sentenceChunks.length === 0) return ["\n".repeat(lineMargin)];

        chunk.sentenceChunks[0] = "\n".repeat(lineMargin) + chunk.sentenceChunks[0]!;

        return chunk.sentenceChunks;
    });

    const lineMarginTop = chunks[0]?.lineMarginTop ?? 0;
    const lineMarginBottom = chunks[0]?.lineMarginBottom ?? 0;

    return {
        sentenceChunks,
        lineMarginTop,
        lineMarginBottom,
    };
}

async function chunkSearchContentBySentenceForBlockNode(
    parentNode: Node,
    node: Node,
    options: {
        orderListItemNumberByNode: Map<Node, number>;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
): Promise<{sentenceChunks: Array<string>; lineMarginTop: number; lineMarginBottom: number}> {
    const typeName = node.type.name as ContentBlockNodeTypeName | "title";

    switch (typeName) {
        case "paragraph":
        case "codeBlock":
        case "heading":
        case "title": {
            const sentenceChunks = await chunkSearchContentBySentenceForTextblockNode(
                node,
                options,
            );
            return {sentenceChunks, lineMarginTop: 2, lineMarginBottom: 2};
        }
        case "quoteBlock": {
            const {sentenceChunks} = await chunkSearchContentBySentenceForBlockFragment(
                node,
                node.content,
                options,
            );

            const prefixedSentenceChunks = sentenceChunks.map((sentenceChunk, i) => {
                return sentenceChunk
                    .split("\n")
                    .map((sentenceChunkLine, j) => {
                        if (j > 0 || i === 0) {
                            return sentenceChunkLine.length > 0 ? `> ${sentenceChunkLine}` : ">";
                        }
                        return sentenceChunkLine;
                    })
                    .join("\n");
            });

            return {
                sentenceChunks: prefixedSentenceChunks,
                lineMarginTop: 2,
                lineMarginBottom: 2,
            };
        }
        case "unorderedListItem":
        case "orderedListItem":
        case "checkListItem": {
            const indent = clampListItemIndentation(node.attrs.indent);

            const {sentenceChunks} = await chunkSearchContentBySentenceForBlockFragment(
                node,
                node.content,
                options,
            );

            let bullet;
            switch (typeName) {
                case "unorderedListItem":
                    bullet = "-";
                    break;
                case "checkListItem":
                    bullet = node.attrs.checked ? "[x]" : "[ ]";
                    break;
                case "orderedListItem": {
                    let listItemNumber = options.orderListItemNumberByNode.get(node);

                    if (listItemNumber === undefined) {
                        computeContentOrderedListItemNumbers(
                            parentNode,
                            options.orderListItemNumberByNode,
                        );
                        listItemNumber = options.orderListItemNumberByNode.get(node);
                        assert(listItemNumber !== undefined);
                    }

                    bullet = `${listItemNumber}.`;
                    break;
                }
                default:
                    throw exhaustive(typeName);
            }

            const firstLinePrefix = "  ".repeat(indent) + bullet;
            const remainingLinePrefix = "  ".repeat(indent) + " ".repeat(bullet.length);

            const prefixedSentenceChunks = sentenceChunks.map((sentenceChunk, i) => {
                return sentenceChunk
                    .split("\n")
                    .map((sentenceChunkLine, j) => {
                        if (i === 0 && j === 0) {
                            return sentenceChunkLine.length > 0
                                ? `${firstLinePrefix} ${sentenceChunkLine}`
                                : firstLinePrefix;
                        }
                        if (j > 0) {
                            return sentenceChunkLine.length > 0
                                ? `${remainingLinePrefix} ${sentenceChunkLine}`
                                : "";
                        }
                        return sentenceChunkLine;
                    })
                    .join("\n");
            });

            return {
                sentenceChunks: prefixedSentenceChunks,
                lineMarginTop: 1,
                lineMarginBottom: 1,
            };
        }
        case "divider": {
            return {sentenceChunks: ["---"], lineMarginTop: 2, lineMarginBottom: 2};
        }
        default:
            throw exhaustive(typeName);
    }
}

/**
 * Chunks a textblock ProseMirror node (node with inline content) to plain text
 * we'll index in OpenSearch and embed with an LLM.
 *
 * We chunk at sentence boundaries so each individual chunk should carry some
 * semantic meaning. Chunking is important for embedding with LLMs which have
 * an ideal input token length. With too many tokens the embedding will only
 * capture the gist of the text, with too few tokens the embedding will only
 * capture exact semantic meaning ignoring broader context ([source][1]).
 *
 * [1]: https://www.pinecone.io/learn/chunking-strategies/
 */
async function chunkSearchContentBySentenceForTextblockNode(
    node: Node,
    options: {
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
): Promise<Array<string>> {
    assert(node.isTextblock);
    const typeName = node.type.name as ContentTextblockNodeTypeName;

    switch (typeName) {
        case "paragraph": {
            const text = await printSearchTextForInlineFragment(node.content, options);

            const tokenizer = new natural.SentenceTokenizer();
            return tokenizer.tokenize(text);
        }
        // TODO(calebmer): Code blocks are in this weird kind of working kind of not
        // working state. Is this right? Who knows. Needs a test.
        case "codeBlock": {
            const text = await printSearchTextForInlineFragment(node.content, options);

            const tokenizer = new natural.SentenceTokenizer();
            const textChunks = tokenizer.tokenize(text);
            if (textChunks.length === 0) {
                return ["```\n```"];
            }

            textChunks[0] = "```\n" + textChunks[0]!;
            textChunks[textChunks.length - 1] = textChunks[textChunks.length - 1]! + "\n```";

            return textChunks;
        }
        case "title":
        case "heading": {
            const text = await printSearchTextForInlineFragment(node.content, options);

            const prefix =
                typeName === "title" ? "#" : "#".repeat(1 + clampHeadingLevel(node.attrs.level));

            const tokenizer = new natural.SentenceTokenizer();
            const textChunks = tokenizer.tokenize(text);
            if (textChunks.length === 0) {
                return [prefix];
            }

            return textChunks.map((textChunk, i) => {
                return textChunk
                    .split("\n")
                    .map((textChunkLine, j) => {
                        if (j > 0 || i === 0) {
                            return textChunkLine.length > 0 ? `${prefix} ${textChunkLine}` : prefix;
                        }
                        return textChunkLine;
                    })
                    .join("\n");
            });
        }
        default:
            throw exhaustive(typeName);
    }
}

async function printSearchTextForInlineFragment(
    fragment: Fragment,
    options: {
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
): Promise<string> {
    const texts = await runAllPromises(
        fragment.content.map(node => printSearchTextForInlineNode(node, options)),
    );

    return texts.join("");
}

const printSearchEmbeddingTextForMarkByTypeName: {
    [Key in ContentMarkTypeName]: (textContent: string, mark: Mark) => string;
} = {
    italic: textContent => `*${textContent}*`,
    bold: textContent => `**${textContent}**`,
    code: textContent => `\`${textContent}\``,
    // Don't include URLs in search embedding text. We believe they'll confuse the
    // model as the text won't read naturally. (Should test this!)
    link: textContent => textContent,
    strike: textContent => `~~${textContent}~~`,
    comment: textContent => textContent,
    highlight: textContent => textContent,
};

/**
 * Print a node in the inline ProseMirror group to text which we'll 1) index in
 * an OpenSearch text field for keyword search, 2) embed with an LLM model for
 * semantic search. Inline ProseMirror nodes are nodes allowed in a paragraph
 * node or other textblock nodes.
 *
 * Includes the `text` node. We'll also add marks for bold and italic to the
 * text in markdown formatting. From brief testing, LLMs seem to understand
 * markdown formatting emphasizes text. OpenSearch should discard the
 * formatting during analysis. A conversation with Cohere demonstrating LLM
 * support (grounding is turned off):
 *
 * > Caleb: *How is this text formatted?*
 * >
 * > Cohere: The text "*How is this text formatted?*" is presented with the
 * > asterisk symbol, which is a formatting technique to indicate emphasis or
 * > an italicized style.
 * >
 * > Caleb: \*How is this text formatted?\*
 * >
 * > Cohere: The text "\*How is this text formatted?\*\*" is presented with the
 * > asterisk symbol and the backslash symbol, which causes the asterisk to be
 * > displayed rather than interpreted as an emphasis marker. This is useful to
 * > demonstrate the functionality of formatting rather than the intent to
 * > emphasize.
 * >
 * > Caleb: ~~How is this text formatted?~~
 * >
 * > Cohere: The text "~~How is this text formatted?~~" is presented with the
 * > tilde symbols, which indicates the inclusion of strikethrough formatting.
 * > This signifies that the text itself should be crossed out or rendered in a
 * > strikethrough style.
 *
 * In the UI `*How is this text formatted?*` is displayed without asterisks and
 * with italics.
 */
async function printSearchTextForInlineNode(
    node: Node,
    options: {
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
): Promise<string> {
    assert(node.isInline);
    const typeName = node.type.name as ContentInlineNodeTypeName;

    switch (typeName) {
        case "break": {
            return "\n";
        }
        case "mention": {
            const mention: ContentMention = node.attrs.mention;
            const account = await options.getAccountIfExists(mention.accountId);
            if (!account) return `@${missingAccountName}`;

            const accountName = mention.isShort
                ? getAccountShortNameWithoutFullNameTooltip(account.initialData)
                : account.initialData.name;

            return `@${accountName}`;
        }
        case "text": {
            // Escape any Markdown characters in the text content so the LLM model doesn't
            // get it confused with our own markdown styling.
            let textContent = escapeMarkdown(node.textContent);

            textContent = node.marks.reduceRight((textContent, mark) => {
                const printSearchEmbeddingTextForMark =
                    printSearchEmbeddingTextForMarkByTypeName[
                        mark.type.name as ContentMarkTypeName
                    ];

                return printSearchEmbeddingTextForMark(textContent, mark);
            }, textContent);

            return textContent;
        }
        default:
            throw exhaustive(typeName);
    }
}

/**
 * Escape markdown characters in some text content. We don't want the model to
 * confuse our markdown formatting for manually typed characters.
 *
 * Given this is all going to an LLM model this escaping may not be necessary
 * or may even be harmful (since it confuses the model). We'll have to test.
 *
 * There is no universally accepted markdown standard. The characters we escape
 * come from [here][1]. The characters ">", "+", and "-" we only escape when
 * they're at the start of a line since they're common in mathematical
 * expressions.
 *
 * [1]: https://www.markdownguide.org/basic-syntax/#escaping-characters
 */
function escapeMarkdown(textContent: string): string {
    return textContent.replaceAll(/^\s*[>+-]|[\\`*_[\]#~]/gm, substring => `\\${substring}`);
}
