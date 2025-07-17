import nlp from "compromise/one";
import {Fragment, Mark, Node} from "prosemirror-model";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
    ContentMarkTypeName,
    ContentTextblockNodeTypeName,
} from "~/shared/content/content_node_type_name.js";
import {clampListItemIndentation} from "~/shared/content/content_schema.js";
import {clampHeadingLevel} from "~/shared/content/content_schema_extra.js";
import {
    RenderContentMentionToTextSearchEntity,
    renderContentMentionToText,
} from "~/shared/content/render_content_mention_to_text.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {isIterable} from "~/shared/helpers/iterable/is_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {AccountId, ContentMentionAccountId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

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
 * Match different new-line formats. [Same newline regex that's in
 * `compromise`][1].
 *
 * [1]: https://github.com/spencermountain/compromise/blob/cb5068d01e4a2002e5baabd2e332e0f077a5997f/src/1-one/tokenize/methods/01-sentences/01-simple-split.js#L5
 */
export const newLineRegExp = /((?:\r?\n|\r)+)/g;

/**
 * Match different new-line formats. [Same newline regex that's in
 * `compromise`][1].
 *
 * Same as `newLineRegExp` but only one line break instead of multiple.
 *
 * [1]: https://github.com/spencermountain/compromise/blob/cb5068d01e4a2002e5baabd2e332e0f077a5997f/src/1-one/tokenize/methods/01-sentences/01-simple-split.js#L5
 */
export const newLineRegExpWithoutRepetition = /(\r?\n|\r)/g;

/**
 * Match different new-line formats. [Same newline regex that's in
 * `compromise`][1].
 *
 * Same as `newLineRegExp` but only one line break instead of multiple and
 * doesn't capture the newlines in a capture group.
 *
 * [1]: https://github.com/spencermountain/compromise/blob/cb5068d01e4a2002e5baabd2e332e0f077a5997f/src/1-one/tokenize/methods/01-sentences/01-simple-split.js#L5
 */
export const newLineRegExpWithoutRepetitionOrCapture = /(?:\r?\n|\r)/g;

/**
 * Take arbitrary content and divide it into chunks of the ideal length for our
 * LLM (Cohere). We divide content into chunks along the natural structure of
 * the document. (e.g. Headings create separate chunks.)
 *
 * Also prints our content to Markdown formatted text which we can index in
 * OpenSearch for keyword search. Refer to the [CommonMark specification][1]
 * for the Markdown syntax we use. The markdown content is able to be parsed
 * back into a ProseMirror node by `parseSearchContent()` (with some acceptable
 * lossiness, see the documentation on that function).
 *
 * Picking good chunks for an LLM can be more art than science. For an
 * introduction to chunking strategies see [this blog post from Pinecone][2].
 * Chunks also can't be context-less.
 *
 * You should add some preamble to chunks so the LLM can better understand
 * what's in the content. A good discussion on adding context to chunks is in
 * [this reply on the OpenAI forums][3]. To add context to chunks implement the
 * `getChunkPreamble` function.
 *
 * [1]: https://spec.commonmark.org/0.30
 * [2]: https://www.pinecone.io/learn/chunking-strategies/
 * [3]: https://community.openai.com/t/the-length-of-the-embedding-contents/111471/7
 */
export function chunkSearchContent(
    content: Node,
    {
        tokenizer,
        getAccountIfExists,
        getSearchEntityIfExists,
        getChunkPreamble = () => ({text: "", lineMarginBottom: 0}),
    }: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
        getChunkPreamble?: (options: {
            context: SearchContentChunkContext;
            isInitialChunk: boolean;
        }) => {text: string; lineMarginBottom: number};
    },
): {
    getFullText: () => string;
    getEmbeddingChunks: () => Array<{
        preambleEndIndex: number;
        tokenCountWithoutPreamble: number;
        text: string;
    }>;
} {
    const chunk = getFullSearchContentChunk(content, {
        tokenizer,
        getAccountIfExists,
        getSearchEntityIfExists,
    });

    return {
        getFullText: () => {
            return printSearchContentChunk({preamble: {text: "", lineMarginBottom: 0}, body: chunk})
                .text;
        },
        getEmbeddingChunks: () => {
            const splitChunks = splitSearchContentChunk(chunk, {
                tokenizer,
                getChunkPreamble,
            });

            return splitChunks.map(chunk => printSearchContentChunk(chunk));
        },
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

type SearchContentChunkBase =
    | {
          isGroup: false;
          sentenceChunks: Array<string>;
          lineMarginTop: number;
          lineMarginBottom: number;
          sectionHeading: string | null;
      }
    | {
          isGroup: true;
          childChunks: Array<SearchContentChunkBase>;
      };

export type SearchContentChunkContext = {
    sectionHeading: string | null;
};

/**
 * Convert arbitrary content into a chunk tree where the leaf nodes are
 * sentences (printed to Markdown formatted text). Each level of the tree
 * represents a different level of structure.
 */
export function getFullSearchContentChunk(
    content: Node,
    {
        tokenizer,
        getAccountIfExists,
        getSearchEntityIfExists,
    }: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): SearchContentChunk {
    // Take our content and divide it into structured chunks of any size. We use
    // the structure of the content to chunk. Headings create sections, child list
    // items stay with their parent list item, and sentences are chunked together.
    const chunkIterable: RecursiveIterable<SearchContentChunkBase> = mapIterable(
        chunkSearchContentBySections(content.content),
        contentChunk => {
            // The heading fragment should not get `sectionHeading` context. Only the
            // content below it.
            return contentChunk.headingFragment
                ? concatIterables(
                      next(contentChunk.headingFragment, null),
                      next(contentChunk.fragment, contentChunk.sectionHeadingNode),
                  )
                : next(contentChunk.fragment, contentChunk.sectionHeadingNode);

            function next(fragment: Fragment, sectionHeadingNode: Node | null) {
                const sectionHeading = sectionHeadingNode
                    ? printSearchTextForInlineFragment(sectionHeadingNode.content, {
                          getAccountIfExists,
                          getSearchEntityIfExists,
                          context: "heading",
                      })
                    : null;

                return mapRecursiveIterable(
                    chunkSearchContentSectionByStructure(fragment),
                    fragment => {
                        const chunks = chunkSearchContentBySentenceForBlockFragment(
                            content,
                            fragment,
                            {
                                orderListItemNumberByNode: new Map(),
                                getAccountIfExists,
                                getSearchEntityIfExists,
                            },
                        );

                        const transform = (chunk: SearchContentChunkBase) => {
                            if (!chunk.isGroup) {
                                chunk.sectionHeading = sectionHeading;
                            } else {
                                for (const childChunk of chunk.childChunks) transform(childChunk);
                            }
                        };

                        for (const chunk of chunks) transform(chunk);

                        return chunks;
                    },
                );
            }
        },
    );

    // Consumes the structured chunk iterable recursively and turns it into a tree
    // object. We also product a token count at each level of the tree.
    const processChunkIterable = (
        chunkIterable: RecursiveIterable<SearchContentChunkBase>,
    ): SearchContentChunk | null => {
        const chunks = filterMapArray(
            chunkIterable,
            (chunkIterable): SearchContentChunk | undefined => {
                if (isIterable(chunkIterable)) {
                    const chunk = processChunkIterable(chunkIterable);
                    if (chunk === null) return;
                    return chunk;
                }

                const chunk = chunkIterable;

                const transform = (chunk: SearchContentChunkBase): SearchContentChunk | null => {
                    if (chunk.isGroup) {
                        const transformedChildChunks = filterMapArray(
                            chunk.childChunks,
                            childChunk => transform(childChunk) ?? undefined,
                        );
                        return createSearchContentGroupChunk(transformedChildChunks);
                    } else {
                        let totalTokenCount = 0;

                        const sentenceChunks = filterMapArray(
                            chunk.sentenceChunks,
                            sentenceChunk => {
                                if (sentenceChunk.length === 0) return;
                                const tokenCount = tokenizer.countTokens(sentenceChunk);
                                totalTokenCount += tokenCount;
                                return {text: sentenceChunk, tokenCount};
                            },
                        );

                        return {
                            isGroup: false,
                            tokenCount: totalTokenCount,
                            context: {sectionHeading: chunk.sectionHeading},
                            sentenceChunks,
                            lineMarginTop: chunk.lineMarginTop,
                            lineMarginBottom: chunk.lineMarginBottom,
                        };
                    }
                };

                return transform(chunk) ?? undefined;
            },
        );

        return createSearchContentGroupChunk(chunks);
    };

    return (
        processChunkIterable(chunkIterable) ?? {
            isGroup: false,
            tokenCount: 0,
            context: {sectionHeading: null},
            sentenceChunks: [],
            lineMarginTop: 0,
            lineMarginBottom: 0,
        }
    );
}

function createSearchContentGroupChunk(
    chunks: Array<SearchContentChunk>,
): SearchContentChunk | null {
    // If there are no child chunks then return null.
    if (chunks.length === 0) {
        return null;
    }

    // Flatten singleton nesting levels.
    if (chunks.length === 1) {
        return chunks[0]!;
    }

    let tokenCount = 0;

    // A group's context must be the same as every child chunk's context.
    let context = null;
    if (chunks.length > 0) {
        tokenCount += chunks[0]!.tokenCount;
        context = chunks[0]!.context;

        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i]!;

            tokenCount += chunk.tokenCount;

            if (context !== null && !isDeepEqual(context, chunk.context)) {
                context = null;
            }
        }
    }

    return {
        isGroup: true,
        tokenCount,
        context: context ?? {sectionHeading: null},
        childChunks: chunks,
    };
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
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
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
export function printSearchContentChunk(chunk: {
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

    let isLineStart = false;

    for (let i = 0; i < flatChunks.length; i++) {
        const chunk = flatChunks[i]!;

        if (i === 0 && text.length === 0 && lastLineMargin === 0) {
            // Preamble is empty, don't add margin lines at the beginning of the text.
            isLineStart = true;
        } else {
            const lineMargin = Math.max(lastLineMargin, chunk.lineMarginTop);
            if (lineMargin > 0) {
                if (text.endsWith(" ")) {
                    // Make sure trailing spaces aren't collapsed at newlines.
                    text = text.slice(0, -1) + "&#x0020;";
                }

                text += "\n".repeat(lineMargin);
                isLineStart = true;
            }
        }

        for (let j = 0; j < chunk.sentenceChunks.length; j++) {
            const sentenceChunk = chunk.sentenceChunks[j]!;

            if (
                j !== 0 &&
                /\S$/.test(chunk.sentenceChunks[j - 1]!.text) &&
                /^\S/.test(sentenceChunk.text)
            ) {
                text += " ";
            }

            text +=
                isLineStart &&
                sentenceChunk.text.startsWith(" ") &&
                !/^ +(?:\d\.|[-*])/.test(sentenceChunk.text)
                    ? // Make sure leading spaces aren't collapsed at newlines.
                      "&#x0020;" + sentenceChunk.text.slice(1)
                    : isLineStart &&
                      sentenceChunk.text.startsWith(">  ") &&
                      !/^>  +(?:\d\.|[-*])/.test(sentenceChunk.text)
                    ? // Make sure leading spaces aren't collapsed at blockquote newlines. (Nested blockquotes are not
                      // supported here.)
                      "> &#x0020;" + sentenceChunk.text.slice(3)
                    : sentenceChunk.text;
        }

        lastLineMargin = chunk.lineMarginBottom;
    }

    if (text.endsWith(" ")) {
        // Make sure trailing spaces aren't collapsed at newlines.
        text = text.slice(0, -1) + "&#x0020;";
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
                    previousHeadingNodes.length > 0 ? Fragment.from(previousHeadingNodes) : null,
                fragment: Fragment.from(previousNodes),
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
                previousHeadingNodes.length > 0 ? Fragment.from(previousHeadingNodes) : null,
            fragment: Fragment.from(previousNodes),
        };
    }
    // If we have only heading nodes then emit a fragment with just heading nodes.
    else if (previousHeadingNodes.length > 0) {
        yield {
            sectionHeadingNode: null,
            headingFragment: null,
            fragment: Fragment.from(previousHeadingNodes),
        };
    }
}

/**
 * Runs a series of chunk heuristics on a single content section
 * (from `chunkSearchContentBySections()`).
 *
 * Includes (among other rules):
 *
 * - Chunking by individual paragraphs
 * - Chunking by contiguous list items
 * - Chunking by list item nesting
 */
function chunkSearchContentSectionByStructure(fragment: Fragment): RecursiveIterable<Fragment> {
    return mapRecursiveIterable(
        chunkSearchContentByIntroduction(chunkSearchContentByParagraphs(fragment)),
        chunkSearchContentByListItems,
    );
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
            yield Fragment.from(previousListItemNodes);
            previousListItemNodes = [];
        }

        yield Fragment.from([node]);
    }

    if (previousListItemNodes.length > 0) {
        yield Fragment.from(previousListItemNodes);
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
                    Fragment.from([state.parentListItemNode, ...state.childListItemNodes]),
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
                    yield Fragment.from(state.previousNodes);
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
                    Fragment.from([state.parentListItemNode, ...state.childListItemNodes]),
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
            yield Fragment.from(state.previousNodes);
        }
    } else {
        yield chunkSearchContentByListItems(
            Fragment.from([state.parentListItemNode, ...state.childListItemNodes]),
            // We know the first node is a `listItem`. Skip it to avoid infinite recursion.
            {shouldSkipFirstNode: true},
        );
    }
}

function chunkSearchContentBySentenceForBlockFragment(
    parentNode: Node,
    fragment: Fragment,
    options: {
        orderListItemNumberByNode: Map<Node, number>;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): Array<SearchContentChunkBase> {
    const chunks = fragment.content.flatMap(node =>
        chunkSearchContentBySentenceForBlockNode(parentNode, node, options),
    );

    return mergeSearchContentChunks(chunks);
}

function mergeSearchContentChunks(
    chunks: Array<SearchContentChunkBase>,
): Array<SearchContentChunkBase> {
    const mergedChunks: Array<SearchContentChunkBase> = [];

    for (const chunk of chunks) {
        if (chunk.isGroup) {
            mergedChunks.push(chunk);
            continue;
        }

        let lastMergedChunk =
            mergedChunks.length > 0 ? mergedChunks[mergedChunks.length - 1] : null;

        let lineMargin = 0;

        if (lastMergedChunk && !lastMergedChunk.isGroup) {
            lineMargin = Math.max(lastMergedChunk.lineMarginBottom, chunk.lineMarginTop);
        } else {
            lastMergedChunk = {
                isGroup: false,
                sentenceChunks: [],
                lineMarginTop: chunk.lineMarginTop,
                lineMarginBottom: 0,
                sectionHeading: null,
            };
            mergedChunks.push(lastMergedChunk);
        }

        if (chunk.sentenceChunks.length === 0) {
            lastMergedChunk.sentenceChunks.push("\n".repeat(lineMargin));
        } else {
            chunk.sentenceChunks[0] = "\n".repeat(lineMargin) + chunk.sentenceChunks[0]!;

            for (const sentenceChunk of chunk.sentenceChunks) {
                lastMergedChunk.sentenceChunks.push(sentenceChunk);
            }
        }

        lastMergedChunk.lineMarginBottom = chunk.lineMarginBottom;
    }

    return mergedChunks;
}

function chunkSearchContentBySentenceForBlockNode(
    parentNode: Node,
    node: Node,
    options: {
        orderListItemNumberByNode: Map<Node, number>;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): Array<SearchContentChunkBase> {
    const typeName = node.type.name as ContentBlockNodeTypeName | "title";

    switch (typeName) {
        case "paragraph":
        case "heading":
        case "title": {
            const sentenceChunks = chunkSearchContentBySentenceForTextblockNode(node, options);
            return [
                {
                    isGroup: false,
                    sentenceChunks,
                    lineMarginTop: 2,
                    lineMarginBottom: 2,
                    sectionHeading: null,
                },
            ];
        }

        case "quoteBlock": {
            const chunks = chunkSearchContentBySentenceForBlockFragment(
                node,
                node.content,
                options,
            );

            let hasSentenceChunkLine = false;

            const transform = (
                isFirstChunk: boolean,
                isLastChunk: boolean,
                chunk: SearchContentChunkBase,
            ) => {
                if (chunk.isGroup) {
                    for (let i = 0; i < chunk.childChunks.length; i++) {
                        transform(
                            isFirstChunk && i === 0,
                            isLastChunk && i === chunk.childChunks.length - 1,
                            chunk.childChunks[i]!,
                        );
                    }
                } else {
                    if (isFirstChunk) chunk.lineMarginTop = Math.max(2, chunk.lineMarginTop);
                    if (isLastChunk) chunk.lineMarginBottom = Math.max(2, chunk.lineMarginBottom);

                    for (let i = 0; i < chunk.sentenceChunks.length; i++) {
                        chunk.sentenceChunks[i] = chunk.sentenceChunks[i]!.split(
                            newLineRegExpWithoutRepetition,
                        )
                            .map((sentenceChunkLine, j, sentenceChunkLines) => {
                                hasSentenceChunkLine = true;

                                if (i === 0 && j === 0) {
                                    return sentenceChunkLine.length > 0
                                        ? `> ${sentenceChunkLine}`
                                        : ">";
                                }
                                if (j % 2 === 1) {
                                    const nextSentenceChunkLineLength =
                                        j < sentenceChunkLines.length
                                            ? sentenceChunkLines[j + 1]!.length
                                            : 0;
                                    return `${sentenceChunkLine}>${
                                        nextSentenceChunkLineLength > 0 ? " " : ""
                                    }`;
                                }
                                return sentenceChunkLine;
                            })
                            .join("");
                    }
                }
            };

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i]!;
                transform(i === 0, i === chunks.length - 1, chunk);
            }

            if (hasSentenceChunkLine) {
                return chunks;
            } else {
                return [
                    {
                        isGroup: false,
                        sentenceChunks: [">"],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                        sectionHeading: null,
                    },
                ];
            }
        }

        case "unorderedListItem":
        case "orderedListItem":
        case "checkListItem": {
            const indent = clampListItemIndentation(node.attrs.indent);

            const chunks = chunkSearchContentBySentenceForBlockFragment(
                node,
                node.content,
                options,
            );

            let bullet;
            switch (typeName) {
                case "unorderedListItem": {
                    bullet = "-";
                    break;
                }
                case "checkListItem": {
                    // There's a non-standard markdown syntax for check list items where `[ ]`
                    // represents an unchecked item and `[x]` represents a checked item. Given this
                    // is not standard and may confuse text analysis (since `x` may be interpreted
                    // as a word after dropping the brackets) we print check list items as regular
                    // Markdown unordered list items.
                    bullet = "-";
                    break;
                }
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

                    // Only allow integers from 1-99. Longer integers like 101 would require more
                    // than four spaces of indentation for child bullets to be considered children
                    // by the CommonMark markdown specification.
                    bullet = `${clamp(1, Math.round(listItemNumber), 99)}.`;
                    break;
                }
                default:
                    throw exhaustive(typeName);
            }

            const firstLinePrefix = "    ".repeat(indent) + bullet;
            const remainingLinePrefix = "    ".repeat(indent) + " ".repeat(bullet.length + 1);

            let hasSentenceChunkLine = false;

            const transform = (
                isFirstChunk: boolean,
                isLastChunk: boolean,
                chunk: SearchContentChunkBase,
            ) => {
                if (chunk.isGroup) {
                    for (let i = 0; i < chunk.childChunks.length; i++) {
                        transform(
                            isFirstChunk && i === 0,
                            isLastChunk && i === chunk.childChunks.length - 1,
                            chunk.childChunks[i]!,
                        );
                    }
                } else {
                    if (isFirstChunk) chunk.lineMarginTop = 1;
                    if (isLastChunk) chunk.lineMarginBottom = 1;

                    for (let i = 0; i < chunk.sentenceChunks.length; i++) {
                        chunk.sentenceChunks[i] = chunk.sentenceChunks[i]!.split(newLineRegExp)
                            .map((sentenceChunkLine, j) => {
                                hasSentenceChunkLine = true;

                                if (i === 0 && j === 0) {
                                    return sentenceChunkLine.length > 0
                                        ? `${firstLinePrefix} ${sentenceChunkLine}`
                                        : firstLinePrefix;
                                }
                                if (j % 2 === 1) {
                                    return sentenceChunkLine.length > 0
                                        ? `${sentenceChunkLine}${remainingLinePrefix}`
                                        : "";
                                }
                                return sentenceChunkLine;
                            })
                            .join("");
                    }
                }
            };

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i]!;
                transform(i === 0, i === chunks.length - 1, chunk);
            }

            if (hasSentenceChunkLine) {
                return chunks;
            } else {
                return [
                    {
                        isGroup: false,
                        sentenceChunks: [firstLinePrefix],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                        sectionHeading: null,
                    },
                ];
            }
        }

        case "codeBlock": {
            const codeBlockLines = createArrayWithLength(node.childCount, i => {
                const childNode = node.child(i);
                return chunkSearchContentBySentenceForTextblockNode(childNode, options);
            });

            return [
                {
                    isGroup: false,
                    sentenceChunks: Array.from(
                        concatIterables(
                            !node.attrs.language || node.attrs.language === "text"
                                ? ["```\n"]
                                : [`\`\`\`${node.attrs.language}\n`],
                            flatIterable(codeBlockLines),
                            ["```"],
                        ),
                    ),
                    lineMarginTop: 2,
                    lineMarginBottom: 2,
                    sectionHeading: null,
                },
            ];
        }

        case "divider": {
            return [
                {
                    isGroup: false,
                    sentenceChunks: ["---"],
                    lineMarginTop: 2,
                    lineMarginBottom: 2,
                    sectionHeading: null,
                },
            ];
        }

        // We don't currently include anything related to files in the chunked content.
        // When searching via our search index we don't want the text "https" or a
        // `FileId` to match any document containing a file. That wouldn't make sense
        // to the user.
        //
        // However, it may be useful for LLMs to see images. So it may be worth
        // considering including an image using the Markdown syntax and stripping
        // images before text indexing. So images aren't available in a text index but
        // are available to LLMs. Otherwise text like "This image shows..." might not
        // be interpreted correctly by an LLM. This makes even more sense if the LLM is
        // smart enough to parse images from the markdown and interpret image
        // semantics. We could also generate `alt` text for files ourselves and feed
        // that to LLMs here. But again, the `alt` text shouldn't be available to the
        // search index.
        //
        // Anyway, for now we don't include files at all in the search body but I'm
        // sure we'll experiment with different approaches over time.
        case "fileRow":
        case "fileRowTable":
        case "fileFloat": {
            return [];
        }

        // We chunk tables into groups of rows and cells. A table is a group of rows
        // and a row is a group of cells. We then chunk the content within a table cell
        // same as normal (e.g. list item children are in the same group as their
        // parent).
        //
        // To represent the table in Markdown we use HTML instead of [GitHub-flavored
        // Markdown (GFM) tables][1]. That's because it's not possible to nest markdown
        // blocks (e.g. quote block or code block) within a GFM table. The HTML we
        // generate can be parsed back by `parseSearchContent()`.
        //
        // Search content Markdown isn't shown to a user and we don't need to be able
        // to perfectly parse content back from search content. The `<table>`
        // formatting is there purely for AI models which will read the content. If [I
        // give Claude a simple table in this format it's able to understand the
        // table][2]. (My second question Claude answered incorrectly so Claude does
        // seem to struggle a little with this.)
        //
        // [1]: https://github.com/micromark/micromark-extension-gfm-table
        // [2]: https://claude.ai/share/20e98f2d-9208-4670-874f-4fcb3c3df61e
        case "table": {
            const tableChunks = node.content.content.map((tableRow): SearchContentChunkBase => {
                const tableRowChunks = tableRow.content.content.map(
                    (tableCell): SearchContentChunkBase => {
                        const iterable = mapRecursiveIterable(
                            chunkSearchContentSectionByStructure(tableCell.content),
                            fragment =>
                                chunkSearchContentBySentenceForBlockFragment(
                                    tableCell,
                                    fragment,
                                    options,
                                ),
                        );

                        const process = (
                            iterable:
                                | SearchContentChunkBase
                                | RecursiveIterable<SearchContentChunkBase>,
                        ): ReadonlyArray<SearchContentChunkBase> => {
                            if (!isIterable(iterable)) {
                                return [iterable];
                            } else {
                                const childChunks = Array.from(flatMapIterable(iterable, process));
                                if (childChunks.length === 0) return emptyArray;
                                if (childChunks.length === 1) return childChunks;
                                return [{isGroup: true, childChunks}];
                            }
                        };

                        let chunks: Array<SearchContentChunkBase> = [];
                        for (const chunk of process(iterable)) chunks.push(chunk);

                        if (chunks.length === 1 && chunks[0]!.isGroup) {
                            chunks = chunks[0]!.childChunks;
                        }

                        return {
                            isGroup: true,
                            childChunks: mergeSearchContentChunks([
                                {
                                    isGroup: false,
                                    sentenceChunks: ["<td>"],
                                    lineMarginTop: 0,
                                    lineMarginBottom: 2,
                                    sectionHeading: null,
                                },
                                ...chunks,
                                {
                                    isGroup: false,
                                    sentenceChunks: ["</td>"],
                                    lineMarginTop: 2,
                                    lineMarginBottom: 0,
                                    sectionHeading: null,
                                },
                            ]),
                        };
                    },
                );

                return {
                    isGroup: true,
                    childChunks: [
                        {
                            isGroup: false,
                            sentenceChunks: ["<tr>"],
                            lineMarginTop: 0,
                            lineMarginBottom: 0,
                            sectionHeading: null,
                        },
                        ...tableRowChunks,
                        {
                            isGroup: false,
                            sentenceChunks: ["</tr>"],
                            lineMarginTop: 0,
                            lineMarginBottom: 0,
                            sectionHeading: null,
                        },
                    ],
                };
            });

            return [
                {
                    isGroup: true,
                    childChunks: [
                        {
                            isGroup: false,
                            sentenceChunks: ["<table><tbody>"],
                            lineMarginTop: 2,
                            lineMarginBottom: 0,
                            sectionHeading: null,
                        },
                        ...tableChunks,
                        {
                            isGroup: false,
                            sentenceChunks: ["</tbody></table>"],
                            lineMarginTop: 0,
                            lineMarginBottom: 2,
                            sectionHeading: null,
                        },
                    ],
                },
            ];
        }
        default:
            throw exhaustive(typeName);
    }
}

/**
 * Chunk text into sentences, preserving newlines. Out of the box `compromise`
 * trims newlines at the start and end of strings.
 */
function chunkSearchContentBySentenceForText(text: string): Array<string> {
    const textChunks: Array<string> = [];

    const textLines = text.split(newLineRegExp);

    for (let i = 0; i < textLines.length; i++) {
        const textLine = textLines[i]!;

        if (i % 2 === 1) {
            textChunks.push(textLine);
            continue;
        }

        nlp(textLine)
            .fullSentences()
            .forEach(sentence => textChunks.push(sentence.text()));
    }

    return textChunks;
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
function chunkSearchContentBySentenceForTextblockNode(
    node: Node,
    options: {
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): Array<string> {
    assert(node.isTextblock);
    const typeName = node.type.name as ContentTextblockNodeTypeName;

    switch (typeName) {
        case "paragraph": {
            const text = printSearchTextForInlineFragment(node.content, {
                ...options,
                context: null,
            });

            return chunkSearchContentBySentenceForText(text);
        }
        case "title":
        case "heading": {
            const text = printSearchTextForInlineFragment(node.content, {
                ...options,
                context: "heading",
            });

            const prefix =
                typeName === "title" ? "#" : "#".repeat(1 + clampHeadingLevel(node.attrs.level));

            const textChunks = chunkSearchContentBySentenceForText(text);
            if (textChunks.length === 0) {
                return [prefix];
            }

            return textChunks.map((textChunk, i) => {
                return textChunk
                    .split(newLineRegExpWithoutRepetition)
                    .map((textChunkLine, j) => {
                        if (i === 0 && j === 0) {
                            return textChunkLine.length > 0 ? `${prefix} ${textChunkLine}` : prefix;
                        }
                        if (j % 2 === 1) {
                            return `${textChunkLine}${prefix}`;
                        }
                        return textChunkLine;
                    })
                    .join("");
            });
        }
        case "codeBlockLine": {
            const text = printSearchTextForInlineFragment(node.content, {
                ...options,
                context: "codeBlock",
            });

            return [`${text}\n`];
        }
        default:
            throw exhaustive(typeName);
    }
}

function printSearchTextForInlineFragment(
    fragment: Fragment,
    options: {
        context: "heading" | "codeBlock" | null;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    const content: Array<Node> = [];

    // Remove `link`, `comment`, and `highlight` marks and merge text nodes with
    // the same marks together.
    for (let node of fragment.content) {
        assert(node.isInline);

        if (options.context === "codeBlock" && node.marks.length > 0) {
            node = node.mark([]);
        } else if (
            node.marks.some(
                mark =>
                    printSearchEmbeddingTextForMarkByTypeName[
                        mark.type.name as ContentMarkTypeName
                    ] === null,
            )
        ) {
            node = node.mark(
                node.marks.filter(
                    mark =>
                        printSearchEmbeddingTextForMarkByTypeName[
                            mark.type.name as ContentMarkTypeName
                        ] !== null,
                ),
            );
        }

        const lastNode = content[content.length - 1];

        if (!node.isText || !lastNode?.isText || !lastNode.sameMarkup(node)) {
            content.push(node);
        } else {
            content[content.length - 1] = lastNode.type.schema.text(
                `${lastNode.text!}${node.text!}`,
                lastNode.marks,
            );
        }
    }

    const texts = content.map(node => printSearchTextForInlineNode(node, options));

    return texts.join("");
}

const printSearchEmbeddingTextForMarkByTypeName: {
    [Key in ContentMarkTypeName]: ((textContent: string, mark: Mark) => string) | null;
} = {
    italic: textContent => `*${textContent}*`,
    bold: textContent => `**${textContent}**`,
    code: textContent => `\`${textContent}\``,
    // Don't include URLs in search embedding text. We believe they'll confuse the
    // model as the text won't read naturally. (Should test this!)
    link: null,
    strike: textContent => `~~${textContent}~~`,
    comment: null,
    highlight: null,
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
function printSearchTextForInlineNode(
    node: Node,
    options: {
        context: "heading" | "codeBlock" | null;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    assert(node.isInline);
    const typeName = node.type.name as ContentInlineNodeTypeName;

    switch (typeName) {
        case "break": {
            // Hard breaks aren't supported in headings so directly add a `<br/>` element.
            if (options.context === "heading") {
                return "<br/>";
            } else {
                // A little funky, but CommonMark specifies a newline preceded by a backslash
                // (`\`) as a hard line break.
                // https://spec.commonmark.org/0.30/#hard-line-breaks
                return "\\\n";
            }
        }
        case "mention": {
            const mention: ContentMention = node.attrs.mention;
            return renderContentMentionToText(mention, options);
        }
        case "text": {
            const codeMark = node.marks.find(mark => mark.type.name === "code");

            // Escape any Markdown characters in the text content so the LLM model doesn't
            // get it confused with our own markdown styling.
            let textContent =
                options.context === "codeBlock" || codeMark
                    ? escapeMarkdownInCode(node.textContent)
                    : escapeMarkdown(node.textContent);

            // The code mark must always be applied first. CommonMark specifies that
            // asterisks or other characters within code are treated as literal characters.
            if (codeMark) {
                const maxBacktickCount = reduceIterable(
                    textContent.matchAll(/`+/g),
                    (count, match) => Math.max(count, match[0].length),
                    0,
                );

                const delimeter = "`".repeat(maxBacktickCount + 1);

                const startingSpace =
                    textContent.startsWith("`") ||
                    (maxBacktickCount > 0 && textContent.startsWith(" "))
                        ? " "
                        : "";

                const endingSpace =
                    textContent.endsWith("`") || (maxBacktickCount > 0 && textContent.endsWith(" "))
                        ? " "
                        : "";

                textContent = `${delimeter}${startingSpace}${textContent}${endingSpace}${delimeter}`;
            }

            textContent = node.marks.reduceRight((textContent, mark) => {
                if (mark === codeMark) return textContent;

                const printSearchEmbeddingTextForMark =
                    printSearchEmbeddingTextForMarkByTypeName[
                        mark.type.name as ContentMarkTypeName
                    ];

                return printSearchEmbeddingTextForMark !== null
                    ? printSearchEmbeddingTextForMark(textContent, mark)
                    : textContent;
            }, textContent);

            return textContent;
        }
        default:
            throw exhaustive(typeName);
    }
}

const escapeMarkdownRegExp = new RegExp(
    [
        // Start of line block formatting. Quote blocks (`>`), list items (`+`, `-`),
        // and headers (`#`).
        /^\s*[>+\-#]/,
        // Start of line table formatting (`| - |`, `| :- |`).
        /^\s*\|\s*:?-/,
        // Start of line list formatting (`1.`). Uses a lookbehind so we escape the `.`
        // not the number.
        /(?<=^\s*\d+)\./,
        // Code (```), bold (`*`), italics (`_`), and strikethrough (`~`).
        /[\\`*_~]/,
        // Links (`[Alpine](https://alpine.inc)`)
        /]\(/,
        // HTML tags (`<em>`)
        /<[/!?a-zA-Z]/,
        // HTML entities (`&amp;`, `&#x0026;`)
        /&#?[a-zA-Z0-9]+;/,
    ]
        .map(regExp => regExp.source)
        .join("|"),
    "gm",
);

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
    return textContent.replaceAll(escapeMarkdownRegExp, substring => {
        const match = substring.match(/^(\s*?)(\S.*)$/);
        assert(match);
        return `${match[1]!}\\${match[2]!}`;
    });
}

/**
 * Escape markdown characters in code content.
 *
 * You can put any character in inline code and it'll render. With the
 * exception of the `<em>` tag which the OpenSearch highlighter inserts. We
 * manually handle `<em>` tag parsing in inline code in `parseSearchContent()`.
 */
function escapeMarkdownInCode(textContent: string): string {
    return textContent.replaceAll(/<\/?em\s*>/gm, substring => {
        const match = substring.match(/^(\s*?)(\S.*)$/);
        assert(match);
        return `${match[1]!}\\${match[2]!}`;
    });
}
