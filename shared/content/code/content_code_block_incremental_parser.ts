import {ChangedRange, Parser, Tree, TreeFragment} from "@lezer/common";
import {highlightTree} from "@lezer/highlight";
import {Node} from "prosemirror-model";
import {Mapping} from "prosemirror-transform";
import {Decoration, DecorationSet} from "prosemirror-view";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {ContentCodeBlockHtmlSerializationDecoration} from "~/shared/content/code/create_content_code_block_html_serialization_decorations_store.js";
import {createContentCodeBlockNodeInput} from "~/shared/content/code/create_content_code_block_node_input.js";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {
    IterableChange,
    actuallySymmetricDiffIterable,
} from "~/shared/content/code/symmetric_diff_iterable.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Store} from "~/shared/store/store.js";

declare module "prosemirror-view" {
    interface DecorationSet {
        readonly local: ReadonlyArray<Decoration>;
        readonly children: ReadonlyArray<number | DecorationSet>;
    }
}

export type ContentCodeBlockIncrementalParserResult = {
    /** The loaded Lezer parser we use for this code block. */
    readonly parser: Parser;

    /** The fully parsed syntax tree for this code block. */
    readonly tree: Tree;

    /**
     * Fragments of parsed syntax trees for this code block. Used in an incremental
     * parse.
     */
    readonly treeFragments: ReadonlyArray<TreeFragment>;

    /**
     * A set of each `codeBlockLine` node in this code block. Used by
     * `actuallySymmetricDiffIterable()` where having the set of lines already
     * available allows us to perform O(1) `set.has(value)` operations.
     *
     * Let `this` be an instance of our incremental parser. For every `index` in
     * `this._nodeArray`, `this._results[index].lineNodeSet` has every `Node` in
     * `this._nodeArray[index].content.content` and nothing more.
     */
    readonly lineNodeSet: ReadonlySet<Node>;

    /**
     * The syntax highlighting result for each `codeBlockLine` node in this code block.
     * When a code block changes, we diff the code block's lines to see which lines
     * changed and only re-highlight those lines that changed.
     *
     * Let `this` be an instance of our incremental parser. For every `index1` in
     * `this._nodeArray` and every `index2` in
     * `this._nodeArray[index1].content.content`, the highlights in
     * `this._results[index1].highlightByLine[index2]` correspond to the
     * `codeBlockLine` node at `this._nodeArray[index1].content.content[index2]`.
     *
     * Every `codeBlockLine` node has highlights and there are no more highlights then
     * there are `codeBlockLine` nodes.
     */
    readonly highlightsByLine: ReadonlyArray<
        ReadonlyArray<{
            readonly from: number;
            readonly to: number;
            readonly classes: string;
        }>
    >;
};

let mockedHighlightTreeForTest: typeof highlightTree | null = null;

export function setMockedHighlightTreeForTest(mockedHighlightTree: typeof highlightTree) {
    assert(import.meta.jest);
    mockedHighlightTreeForTest = mockedHighlightTree;
}

/**
 * Manages code block syntax highlighting for `<ContentEditor>`. Uses the
 * [Lezer][1] parser system for syntax highlighting. Manages all code blocks in a
 * doc instead of managing only one at a time.
 *
 * Whenever a code block changes, instead of re-parsing the entire code block (as a
 * naive implementation of this class might) we perform an incremental parse that
 * reuses the previous parse tree. Powered by Lezer's incremental parsing
 * implementation. We both:
 *
 * - Only re-parse code blocks which changed
 * - Only re-parse (and re-highlight) the specific code block lines which changed
 *
 * [1]: https://lezer.codemirror.net
 */
export class ContentCodeBlockIncrementalParser {
    private static _initialDecorationsByNode: WeakMap<
        Node,
        ReadonlyArray<ContentCodeBlockHtmlSerializationDecoration>
    > | null = null;

    public static getInitialDecorationsByNode() {
        return (this._initialDecorationsByNode ??= new WeakMap());
    }

    /**
     * The full document we're highlighting code blocks in.
     */
    private readonly _doc: Node;

    /**
     * The `codeBlock` nodes in the doc we're highlighting.
     */
    private readonly _nodeArray: ReadonlyArray<Node>;

    /**
     * The set of `codeBlock` nodes in the doc we're highlighting. Every node in
     * `this._nodeArray` is present in this set and every item in this set is present
     * in `this._nodeArray`.
     *
     * This set is purely used as an optimization to perform O(1)
     * `this._nodeSet.has(node)` operations. Specifically
     * `actuallySymmetricDiffIterable()` is what needs O(1) `this._nodeSet.has(node)`
     * operations to maintain good performance.
     */
    private readonly _nodeSet: ReadonlySet<Node>;

    /**
     * The offset in the doc of each `codeBlock` node in `this._nodeArray`. For every
     * index in `this._nodeArray` we have a node offset in this array.
     *
     * For every `index` in `this._nodeArray` the following should be true:
     * `this._nodeArray[index] === doc.resolve(this._nodeOffsets[index]).nodeAfter`.
     */
    private readonly _nodeOffsets: ReadonlyArray<number>;

    /**
     * The parsing result of each `codeBlock` in `this._nodeArray`. For every index in
     * `this._nodeArray` we have a result in this array. If a `codeBlock` node couldn't
     * be parsed the corresponding index in this array will be `null`.
     */
    private readonly _results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>;

    /**
     * The final `DecorationSet` that's provided to ProseMirror's `EditorView`
     * containing inline decorations that actually perform the highlighting of code in
     * a code block.
     */
    public readonly decorations: DecorationSet;

    private constructor(
        doc: Node,
        nodeArray: ReadonlyArray<Node>,
        nodeSet: ReadonlySet<Node>,
        nodeOffsets: ReadonlyArray<number>,
        results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>,
        decorations: DecorationSet,
    ) {
        this._doc = doc;
        this._nodeArray = nodeArray;
        this._nodeSet = nodeSet;
        this._nodeOffsets = nodeOffsets;
        this._results = results;
        this.decorations = decorations;
    }

    /**
     * Create a new incremental parser from a content doc when `EditorView` is
     * initialized. Finds all code block nodes and parses them.
     */
    public static new(
        get: <Value>(store: Store<Value>) => Value,
        doc: Node,
    ): ContentCodeBlockIncrementalParser {
        const [nodeArray, nodeSet, nodeOffsets] = getContentCodeBlockNodes(doc);

        // Check to see if we have initial decorations from the server. If so we use them
        // until the document updates and load the language parsers in the background so we
        // don't have a flash of code blocks that aren't highlighted.
        const initialDecorations =
            ContentCodeBlockIncrementalParser._initialDecorationsByNode?.get(doc);
        if (initialDecorations) {
            for (const node of nodeArray) {
                const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
                const language = contentCodeBlockLanguageById[languageId];

                // Preload code block languages while we're using initial code block decorations so
                // we're ready for a re-render.
                language.getParser();
            }

            return new ContentCodeBlockIncrementalParser(
                doc,
                [],
                new Set(),
                [],
                [],
                DecorationSet.create(
                    doc,
                    initialDecorations.map(decoration =>
                        Decoration.inline(decoration.from, decoration.to, decoration.attrs),
                    ),
                ),
            );
        }

        const results = nodeArray.map((node): ContentCodeBlockIncrementalParserResult | null => {
            const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
            const language = contentCodeBlockLanguageById[languageId];
            const parserPromiseStore = language.getParser();
            if (parserPromiseStore === null) return null;

            const parserPromise = get(parserPromiseStore);
            if (parserPromise.status === "pending") return null;
            if (parserPromise.status === "rejected") throw parserPromise.reason;

            const parser = parserPromise.value;

            return createInitialContentCodeBlockIncrementalParserResult(node, parser);
        });

        const allDecorationsForTest = import.meta.jest ? [] : undefined;

        const decorations = createContentCodeBlockIncrementalParserDecorationSet(
            nodeArray,
            nodeOffsets,
            results,
            allDecorationsForTest,
        );

        if (import.meta.jest) {
            // Expect us to manually build the same decoration set tree that
            // `DecorationSet.create()` would.
            assertIsDecorationSetEqualForTest(
                decorations,
                DecorationSet.create(doc, assertExists(allDecorationsForTest)),
            );
        }

        return new ContentCodeBlockIncrementalParser(
            doc,
            nodeArray,
            nodeSet,
            nodeOffsets,
            results,
            decorations,
        );
    }

    /**
     * Perform an incremental update to our parsed code blocks with a new content doc.
     * This function will only re-parse code block nodes that changed.
     *
     * We do this by:
     *
     * 1. Diffing `codeBlock` nodes to see which code blocks changed
     * 2. Diffing `codeBlockLine` nodes within `codeBlock` nodes to see which lines
     *    changed
     *
     * We diff `codeBlock` nodes and `codeBlockLine` nodes with
     * `actuallySymmetricDiffIterable()` which returns all additions/deletions to items
     * in an array that don't change relative order. You can think of
     * `actuallySymmetricDiffIterable()` as implementing a similar algorithm to
     * `git diff`.
     *
     * Then once we have our changes we use [Lezer's incremental parsing
     * capabilities][1] to only re-parse the parts of a code block that changed.
     * Similarly, we only call Lezer's `highlightTree()` function on the lines within
     * the code block that changed.
     *
     * [1]: https://discuss.codemirror.net/t/an-example-of-an-incremental-parse/5356/2
     */
    public update(
        get: <Value>(store: Store<Value>) => Value,
        doc: Node,
        mapping: Mapping,
    ): ContentCodeBlockIncrementalParser {
        const [newNodeArray, newNodeSet, newNodeOffsets] = getContentCodeBlockNodes(doc);

        // If this `doc` has some initial decorations we used and the doc is the same as
        // what we previously parsed, then don't update the parser.
        //
        // Normally, we need to update the parser even if `this._doc === doc` because we
        // need to check and see if a previously unloaded language parser is now loaded.
        // However, when we have initial decorations from the server we don't need to load
        // parsers until the user updates the document.
        const initialDecorations =
            ContentCodeBlockIncrementalParser._initialDecorationsByNode?.get(doc);
        if (
            initialDecorations &&
            this._doc === doc &&
            this._nodeArray.length === 0 &&
            newNodeArray.length > 0
        ) {
            return this;
        }

        const changes = actuallySymmetricDiffIterable(
            this._nodeArray,
            this._nodeSet,
            newNodeArray,
            newNodeSet,
        );

        let oldIndex = 0;
        let candidateOldEntries: Array<{
            node: Node;
            result: ContentCodeBlockIncrementalParserResult | null;
        }> | null = null;
        const newResults: Array<ContentCodeBlockIncrementalParserResult | null> = [];

        let isUnchanged = true;

        for (const change of changes) {
            switch (change.type) {
                case null: {
                    const oldNode = this._nodeArray[oldIndex]!;
                    const oldLanguageId: ContentCodeBlockLanguageId =
                        oldNode.attrs.language ?? "text";
                    const oldResult = this._results[oldIndex]!;
                    oldIndex++;

                    candidateOldEntries = null;

                    if (oldResult !== null) {
                        newResults.push(oldResult);
                    } else {
                        const language = contentCodeBlockLanguageById[oldLanguageId];
                        const parserPromiseStore = language.getParser();
                        if (parserPromiseStore === null) {
                            newResults.push(null);
                            break;
                        }

                        const parserPromise = get(parserPromiseStore);
                        if (parserPromise.status === "pending") {
                            newResults.push(null);
                            break;
                        }
                        if (parserPromise.status === "rejected") throw parserPromise.reason;

                        isUnchanged = false;

                        newResults.push(
                            createInitialContentCodeBlockIncrementalParserResult(
                                oldNode,
                                parserPromise.value,
                            ),
                        );
                    }
                    break;
                }
                case "Deleted": {
                    isUnchanged = false;

                    const oldResult = this._results[oldIndex]!;
                    oldIndex++;

                    // An update appears as a deleted change followed by an added change. So record the
                    // results of deleted entries and we'll reuse them for the next code block to be
                    // added.
                    candidateOldEntries ??= [];
                    candidateOldEntries.push({
                        node: change.value,
                        result: oldResult,
                    });
                    break;
                }
                case "Added": {
                    isUnchanged = false;

                    const oldEntry = candidateOldEntries?.shift();

                    const newNode = change.value;
                    const newLanguageId: ContentCodeBlockLanguageId =
                        newNode.attrs.language ?? "text";

                    if (
                        oldEntry === undefined ||
                        oldEntry.result === null ||
                        (oldEntry.node.attrs.language ?? "text") !== newLanguageId
                    ) {
                        const language = contentCodeBlockLanguageById[newLanguageId];
                        const parserPromiseStore = language.getParser();
                        if (parserPromiseStore === null) {
                            newResults.push(null);
                            break;
                        }

                        const parserPromise = get(parserPromiseStore);
                        if (parserPromise.status === "pending") {
                            newResults.push(null);
                            break;
                        }
                        if (parserPromise.status === "rejected") throw parserPromise.reason;

                        const parser = parserPromise.value;

                        newResults.push(
                            createInitialContentCodeBlockIncrementalParserResult(newNode, parser),
                        );
                    }
                    // Here is where we actually perform our incremental parsing! At this point we have
                    // a parse tree and highlights for an old code block in the same position. We reuse
                    // the parse tree and highlights as much as we can.
                    //
                    // We diff to see which lines of code changed then re-parse and re-highlight only
                    // those changed lines.
                    else {
                        const {
                            parser,
                            treeFragments: oldTreeFragments,
                            lineNodeSet: oldLineNodeSet,
                            highlightsByLine: oldHighlightsByLine,
                        } = oldEntry.result;

                        const newInput = createContentCodeBlockNodeInput(newNode);
                        const newLineNodeSet = new Set(newNode.content.content);

                        const lineChanges = actuallySymmetricDiffIterable(
                            oldEntry.node.content.content,
                            oldLineNodeSet,
                            newNode.content.content,
                            newLineNodeSet,
                        );

                        const changedRanges = getContentCodeBlockNodeChangedRanges(lineChanges);

                        let newTreeFragments = TreeFragment.applyChanges(
                            oldTreeFragments,
                            changedRanges,
                        );

                        const newTree = parser.parse(newInput, newTreeFragments);
                        newTreeFragments = TreeFragment.addTree(newTree, newTreeFragments);

                        const newHighlightsByLine: Array<
                            ReadonlyArray<{from: number; to: number; classes: string}>
                        > = [];

                        let oldLineIndex = 0;

                        // `length` corresponds to the current position in the input string. It's different
                        // from the ProseMirror position `pos` in that for `pos` each line adds 2 (the
                        // start + end of the node) whereas for `length` each line adds 1 (a `\n`
                        // character).
                        let newLength = 0;
                        let newPos = 0;
                        let seenLineChange = false;

                        for (const lineChange of lineChanges) {
                            switch (lineChange.type) {
                                case null: {
                                    const oldHighlights = oldHighlightsByLine[oldLineIndex]!;

                                    const lineFrom = newLength;
                                    const lineTo = lineFrom + lineChange.value.content.size + 1;
                                    const lengthToPos = newPos - newLength;

                                    oldLineIndex++;
                                    newLength += lineChange.value.content.size + 1;
                                    newPos += lineChange.value.nodeSize;

                                    // Reuse highlights from a line before any changed lines. All lines after a changed
                                    // line must be highlighted. Since code from one line might effect how code is
                                    // highlighted in all following lines.
                                    if (!seenLineChange) {
                                        newHighlightsByLine.push(oldHighlights);
                                    } else {
                                        const highlights: Array<{
                                            from: number;
                                            to: number;
                                            classes: string;
                                        }> = [];

                                        (mockedHighlightTreeForTest ?? highlightTree)(
                                            newTree,
                                            lezerClassHighlighter.get(),
                                            (from, to, classes) => {
                                                highlights.push({
                                                    from: from + lengthToPos,
                                                    to: to + lengthToPos,
                                                    classes,
                                                });
                                            },
                                            lineFrom,
                                            lineTo - 1,
                                        );

                                        newHighlightsByLine.push(highlights);
                                    }
                                    break;
                                }
                                case "Added": {
                                    seenLineChange = true;

                                    const lineFrom = newLength;
                                    const lineTo = lineFrom + lineChange.value.content.size + 1;
                                    const lengthToPos = newPos - newLength;

                                    newLength = lineTo;
                                    newPos += lineChange.value.nodeSize;

                                    const highlights: Array<{
                                        from: number;
                                        to: number;
                                        classes: string;
                                    }> = [];

                                    // Highlight a new line that has changed...
                                    (mockedHighlightTreeForTest ?? highlightTree)(
                                        newTree,
                                        lezerClassHighlighter.get(),
                                        (from, to, classes) =>
                                            highlights.push({
                                                from: from + lengthToPos,
                                                to: to + lengthToPos,
                                                classes,
                                            }),
                                        lineFrom,
                                        lineTo - 1,
                                    );

                                    newHighlightsByLine.push(highlights);
                                    break;
                                }
                                case "Deleted": {
                                    seenLineChange = true;
                                    oldLineIndex++;
                                    break;
                                }
                                default:
                                    throw exhaustive(lineChange.type);
                            }
                        }

                        newResults.push({
                            parser,
                            tree: newTree,
                            treeFragments: newTreeFragments,
                            lineNodeSet: newLineNodeSet,
                            highlightsByLine: newHighlightsByLine,
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(change.type);
            }
        }

        // If no code blocks changed, then let's `map()` to avoid recreating our entire
        // decoration tree in case the tree is large.
        let newDecorations: DecorationSet;
        if (isUnchanged) {
            newDecorations = this.decorations.map(mapping, doc);
        } else {
            const allDecorationsForTest = import.meta.jest ? [] : undefined;

            newDecorations = createContentCodeBlockIncrementalParserDecorationSet(
                newNodeArray,
                newNodeOffsets,
                newResults,
                allDecorationsForTest,
            );

            if (import.meta.jest) {
                // Expect us to manually build the same decoration set tree that
                // `DecorationSet.create()` would.
                assertIsDecorationSetEqualForTest(
                    newDecorations,
                    DecorationSet.create(doc, assertExists(allDecorationsForTest)),
                );
            }
        }

        return new ContentCodeBlockIncrementalParser(
            doc,
            newNodeArray,
            newNodeSet,
            newNodeOffsets,
            newResults,
            newDecorations,
        );
    }
}

function getContentCodeBlockNodes(
    doc: Node,
): [nodeArray: Array<Node>, nodeSet: Set<Node>, nodeOffsets: Array<number>] {
    assert(doc.type.name === "doc");

    const nodeArray: Array<Node> = [];
    const nodeSet = new Set<Node>();
    const nodeOffsets: Array<number> = [];

    doc.forEach((node, pos) => {
        // Currently, code blocks may only be a direct child of `doc`.
        if (node.type.name === "codeBlock") {
            nodeArray.push(node);
            nodeSet.add(node);
            nodeOffsets.push(pos);
        }
    });

    return [nodeArray, nodeSet, nodeOffsets];
}

function createInitialContentCodeBlockIncrementalParserResult(
    node: Node,
    parser: Parser,
): ContentCodeBlockIncrementalParserResult {
    const input = createContentCodeBlockNodeInput(node);
    const tree = parser.parse(input);
    const treeFragments = TreeFragment.addTree(tree);

    const lineNodeSet = new Set<Node>();
    const highlightsByLine: Array<Array<{from: number; to: number; classes: string}>> = [];

    // `length` corresponds to the current position in the input string. It's different
    // from the ProseMirror position `pos` in that for `pos` each line adds 2 (the
    // start + end of the node) whereas for `length` each line adds 1 (a `\n`
    // character).
    let length = 0;
    let pos = 0;

    for (const lineNode of node.content.content) {
        lineNodeSet.add(lineNode);

        const lineFrom = length;
        const lineTo = lineFrom + lineNode.content.size + 1;
        const lengthToPos = pos - length;
        length = lineTo;
        pos += lineNode.nodeSize;

        const highlights: Array<{from: number; to: number; classes: string}> = [];

        (mockedHighlightTreeForTest ?? highlightTree)(
            tree,
            lezerClassHighlighter.get(),
            (from, to, classes) =>
                highlights.push({from: from + lengthToPos, to: to + lengthToPos, classes}),
            lineFrom,
            lineTo - 1,
        );

        highlightsByLine.push(highlights);
    }

    return {
        parser,
        tree,
        treeFragments,
        lineNodeSet,
        highlightsByLine,
    };
}

function getContentCodeBlockNodeChangedRanges(
    changes: ReadonlyArray<IterableChange<Node>>,
): Array<ChangedRange> {
    let changedRange: ChangedRange | null = null;
    const changedRanges: Array<ChangedRange> = [];

    let oldLength = 0;
    let newLength = 0;

    for (const change of changes) {
        switch (change.type) {
            case null: {
                if (changedRange !== null) {
                    changedRanges.push(changedRange);
                    changedRange = null;
                }

                oldLength += change.value.content.size + 1;
                newLength += change.value.content.size + 1;
                break;
            }
            case "Added": {
                changedRange ??= {
                    fromA: oldLength,
                    toA: oldLength,
                    fromB: newLength,
                    toB: newLength,
                };

                changedRange.toB += change.value.content.size + 1;
                newLength += change.value.content.size + 1;
                break;
            }
            case "Deleted": {
                changedRange ??= {
                    fromA: oldLength,
                    toA: oldLength,
                    fromB: newLength,
                    toB: newLength,
                };

                changedRange.toA += change.value.content.size + 1;
                oldLength += change.value.content.size + 1;
                break;
            }
            default:
                throw exhaustive(change.type);
        }
    }

    if (changedRange !== null) {
        changedRanges.push(changedRange);
        changedRange = null;
    }

    return changedRanges;
}

/**
 * Create a `DecorationSet` for results from `ContentCodeBlockIncrementalParser`.
 *
 * This should build the same set as `DecorationSet.create(doc, allDecorations)`.
 * We write our own function since we'll have many decorations and we can more
 * efficiently build a decoration tree than [ProseMirror's `buildTree()`
 * function][1] called by `DecorationSet.create()`. The build tree function
 * performs multiple O(n) loops over each child node in a document which we're
 * scared of since n can be quite large given we have a decoration for each syntax
 * highlight.
 *
 * We closely mimic the implementation of [ProseMirror's `buildTree()` function][1]
 * here since our result should be indistinguishable. In unit tests, we call
 * `assertIsDecorationSetEqualForTest()` to make sure we produce a `DecorationSet`
 * object that's the same as what `DecorationSet.create()` would produce.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L692-L714
 */
function createContentCodeBlockIncrementalParserDecorationSet(
    nodes: ReadonlyArray<Node>,
    offsets: ReadonlyArray<number>,
    results: ReadonlyArray<Pick<
        ContentCodeBlockIncrementalParserResult,
        "highlightsByLine"
    > | null>,
    allDecorations?: Array<Decoration>,
): DecorationSet {
    const rootDecorations: Array<Decoration> = [];
    const rootChildDecorations: Array<number | DecorationSet> = [];

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
        const node = nodes[nodeIndex]!;
        const offset = offsets[nodeIndex]!;
        const result = results[nodeIndex]!;

        if (result === null) continue;

        const nodeDecorations: Array<Decoration> = [];
        const nodeChildDecorations: Array<number | DecorationSet> = [];

        let relativeOffset = 0;

        for (let lineNodeIndex = 0; lineNodeIndex < node.content.content.length; lineNodeIndex++) {
            const lineNode = node.content.content[lineNodeIndex]!;
            const highlights = result.highlightsByLine[lineNodeIndex]!;

            const lineNodeDecorations: Array<Decoration> = [];

            for (const highlight of highlights) {
                if (allDecorations !== undefined) {
                    allDecorations.push(
                        Decoration.inline(offset + 2 + highlight.from, offset + 2 + highlight.to, {
                            nodeName: "span",
                            class: highlight.classes,
                        }),
                    );
                }

                lineNodeDecorations.push(
                    Decoration.inline(
                        highlight.from - relativeOffset,
                        highlight.to - relativeOffset,
                        {
                            nodeName: "span",
                            class: highlight.classes,
                        },
                    ),
                );
            }

            if (lineNodeDecorations.length > 0) {
                nodeChildDecorations.push(
                    relativeOffset,
                    relativeOffset + lineNode.nodeSize,
                    // The [internal ProseMirror `DecorationSet` constructor signature][1]. We want
                    // to construct `DecorationSet` directly to avoid an [expensive `buildTree()`
                    // function][2] that keeps looping over the full decoration set.
                    //
                    // [1]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L278-L281
                    // [2]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L692-L714
                    //
                    // @ts-expect-error
                    new DecorationSet(lineNodeDecorations, emptyArray),
                );
            }

            relativeOffset += lineNode.nodeSize;
        }

        if (nodeChildDecorations.length > 0) {
            rootChildDecorations.push(
                offset,
                offset + node.nodeSize,
                // The [internal ProseMirror `DecorationSet` constructor signature][1]. We want
                // to construct `DecorationSet` directly to avoid an [expensive `buildTree()`
                // function][2] that keeps looping over the full decoration set.
                //
                // [1]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L278-L281
                // [2]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L692-L714
                //
                // @ts-expect-error
                new DecorationSet(nodeDecorations, nodeChildDecorations),
            );
        }
    }

    // The [internal ProseMirror `DecorationSet` constructor signature][1]. We want
    // to construct `DecorationSet` directly to avoid an [expensive `buildTree()`
    // function][2] that keeps looping over the full decoration set.
    //
    // [1]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L278-L281
    // [2]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L692-L714
    //
    // @ts-expect-error
    return new DecorationSet(rootDecorations, rootChildDecorations);
}

function assertIsDecorationSetEqualForTest(
    actualDecorations: DecorationSet,
    expectedDecorations: DecorationSet,
) {
    assert(import.meta.jest);

    assert(
        actualDecorations.local.length === expectedDecorations.local.length,
        `\`actualDecorations.local.length === expectedDecorations.local.length\` (\`${actualDecorations.local.length} === ${expectedDecorations.local.length}\`)`,
    );

    for (let i = 0; i < actualDecorations.local.length; i++) {
        const actualDecoration = actualDecorations.local[i]!;
        const expectedDecoration = expectedDecorations.local[i]!;

        assert(
            actualDecoration.from === expectedDecoration.from,
            `\`actualDecoration.from === expectedDecoration.from\` (\`${actualDecoration.from} === ${expectedDecoration.from}\`)`,
        );
        assert(
            actualDecoration.to === expectedDecoration.to,
            `\`actualDecoration.to === expectedDecoration.to\` (\`${actualDecoration.to} === ${expectedDecoration.to}\`)`,
        );
        assert(isDeepEqual(actualDecoration.spec, expectedDecoration.spec));
    }

    assert(
        actualDecorations.children.length === expectedDecorations.children.length,
        `\`actualDecorations.children.length === expectedDecorations.children.length\` (\`${actualDecorations.children.length} === ${expectedDecorations.children.length}\`)`,
    );

    for (let i = 0; i < actualDecorations.children.length; i++) {
        const actualChildDecorations = actualDecorations.children[i]!;
        const expectedChildDecorations = expectedDecorations.children[i]!;

        if (typeof actualChildDecorations === "number") {
            assert(typeof expectedChildDecorations === "number");

            assert(
                actualChildDecorations === expectedChildDecorations,
                `\`actualChildDecorations === expectedChildDecorations\` (\`${actualChildDecorations} === ${expectedChildDecorations}\`)`,
            );
        } else {
            assert(typeof actualChildDecorations === "object");
            assert(typeof expectedChildDecorations === "object");

            assertIsDecorationSetEqualForTest(actualChildDecorations, expectedChildDecorations);
        }
    }
}
