import {ChangedRange, Parser, Tree, TreeFragment} from "@lezer/common";
import {highlightTree} from "@lezer/highlight";
import {Node} from "prosemirror-model";
import {Mapping} from "prosemirror-transform";
import {Decoration, DecorationSet} from "prosemirror-view";
import {contentCodeBlockLanguageById} from "~/client/content/code/content_code_block_language.js";
import {createContentCodeBlockNodeInput} from "~/client/content/code/create_content_code_block_node_input.js";
import {lezerClassHighlighter} from "~/client/content/code/lezer_class_highlighter.js";
import {
    IterableChange,
    actuallySymmetricDiffIterable,
} from "~/client/content/code/symmetric_diff_iterable.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

declare module "prosemirror-view" {
    class DecorationSet {
        // The [internal ProseMirror `DecorationSet` constructor signature][1]. We want
        // to construct `DecorationSet` directly to avoid an [expensive `buildTree()`
        // function][2] that keeps looping over the full decoration set.
        //
        // [1]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L278-L281
        // [2]: https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L692-L714
        constructor(
            local: ReadonlyArray<Decoration>,
            children: ReadonlyArray<number | DecorationSet>,
        );
    }
}

type ContentCodeBlockIncrementalParserResult = {
    readonly parser: Parser;
    readonly tree: Tree;
    readonly treeFragments: ReadonlyArray<TreeFragment>;
    readonly lineNodeSet: ReadonlySet<Node>;
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

// NOCOMMIT: Document
export class ContentCodeBlockIncrementalParser {
    // NOCOMMIT: Document
    private readonly _nodeArray: ReadonlyArray<Node>;
    private readonly _nodeSet: ReadonlySet<Node>;
    private readonly _nodePoses: ReadonlyArray<number>;
    private readonly _results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>;
    private readonly _unloadedLanguageIds: ReadonlySet<ContentCodeBlockLanguageId>;

    public readonly decorations: DecorationSet;

    private constructor(
        nodeArray: ReadonlyArray<Node>,
        nodeSet: ReadonlySet<Node>,
        nodePoses: ReadonlyArray<number>,
        results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>,
        unloadedLanguageIds: ReadonlySet<ContentCodeBlockLanguageId>,
        decorations: DecorationSet,
    ) {
        this._nodeArray = nodeArray;
        this._nodeSet = nodeSet;
        this._nodePoses = nodePoses;
        this._results = results;
        this._unloadedLanguageIds = unloadedLanguageIds;
        this.decorations = decorations;
    }

    public static new(doc: Node): ContentCodeBlockIncrementalParser {
        const [nodeArray, nodeSet, nodePoses] = getContentCodeBlockNodes(doc);

        const unloadedLanguageIds = new Set<ContentCodeBlockLanguageId>();

        const results = nodeArray.map((node): ContentCodeBlockIncrementalParserResult | null => {
            const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
            const language = contentCodeBlockLanguageById[languageId];
            if (language.parser === null) return null;

            const parser = language.parser.getIfLoaded();
            if (parser === null) {
                unloadedLanguageIds.add(languageId);
                return null;
            }

            return createInitialContentCodeBlockIncrementalParserResult(node, parser);
        });

        const decorations = createContentCodeBlockIncrementalParserDecorationSet(
            nodeArray,
            nodePoses,
            results,
        );

        return new ContentCodeBlockIncrementalParser(
            nodeArray,
            nodeSet,
            nodePoses,
            results,
            unloadedLanguageIds,
            decorations,
        );
    }

    // NOCOMMIT: Document
    public update(doc: Node, mapping: Mapping): ContentCodeBlockIncrementalParser {
        const [newNodeArray, newNodeSet, newNodePoses] = getContentCodeBlockNodes(doc);

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
        let newUnloadedLanguageIds: Set<ContentCodeBlockLanguageId> | null = null;

        let isUnchanged = true;

        for (const change of changes) {
            switch (change.type) {
                case null: {
                    const oldResult = this._results[oldIndex]!;
                    oldIndex++;

                    candidateOldEntries = null;

                    newResults.push(oldResult);
                    break;
                }
                case "Deleted": {
                    isUnchanged = false;

                    const oldResult = this._results[oldIndex]!;
                    oldIndex++;

                    // An update appears as a deleted change followed by an added change. So record
                    // the results of deleted entries and we'll reuse them for the next code block
                    // to be added.
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
                        if (language.parser === null) {
                            newResults.push(null);
                            break;
                        }

                        const parser = language.parser.getIfLoaded();
                        if (parser === null) {
                            newUnloadedLanguageIds ??= new Set(this._unloadedLanguageIds);
                            newUnloadedLanguageIds.add(newLanguageId);
                            newResults.push(null);
                            break;
                        }

                        // If we now have this language's parser but we didn't previously then remove
                        // it from the unloaded set.
                        if (this._unloadedLanguageIds.has(newLanguageId)) {
                            newUnloadedLanguageIds ??= new Set(this._unloadedLanguageIds);
                            newUnloadedLanguageIds.delete(newLanguageId);
                        }

                        newResults.push(
                            createInitialContentCodeBlockIncrementalParserResult(newNode, parser),
                        );
                    }
                    // Here is where we actually perform our incremental parsing! At this point we
                    // have an parse tree and highlights for an old code block in the same position.
                    // We reuse the parse tree and highlights as much as we can.
                    //
                    // We diff to see which lines of code changed then re-parse and re-highlight
                    // only those changed lines.
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
                        let oldPosToNewPos = 0;

                        // `length` corresponds to the current position in the input string. It's
                        // different from the ProseMirror position `pos` in that for `pos` each line
                        // adds 2 (the start + end of the node) whereas for `length` each line adds 1
                        // (a `\n` character).
                        let newLength = 0;
                        let newPos = 0;

                        for (const lineChange of lineChanges) {
                            switch (lineChange.type) {
                                case null: {
                                    const oldHighlights = oldHighlightsByLine[oldLineIndex]!;

                                    oldLineIndex++;
                                    newLength += lineChange.value.content.size + 1;
                                    newPos += lineChange.value.nodeSize;

                                    // Reuse highlights from a line that hasn't changed...
                                    newHighlightsByLine.push(
                                        oldPosToNewPos !== 0
                                            ? oldHighlights.map(highlight => ({
                                                  from: highlight.from + oldPosToNewPos,
                                                  to: highlight.to + oldPosToNewPos,
                                                  classes: highlight.classes,
                                              }))
                                            : oldHighlights,
                                    );
                                    break;
                                }
                                case "Added": {
                                    oldPosToNewPos += lineChange.value.nodeSize;

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
                                        lineTo,
                                    );

                                    newHighlightsByLine.push(highlights);
                                    break;
                                }
                                case "Deleted": {
                                    oldLineIndex++;
                                    oldPosToNewPos -= lineChange.value.nodeSize;
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
            newDecorations = createContentCodeBlockIncrementalParserDecorationSet(
                newNodeArray,
                newNodePoses,
                newResults,
            );
        }

        return new ContentCodeBlockIncrementalParser(
            newNodeArray,
            newNodeSet,
            newNodePoses,
            newResults,
            newUnloadedLanguageIds ?? this._unloadedLanguageIds,
            newDecorations,
        );
    }

    public getUnloadedLanguageIds(): ReadonlySet<ContentCodeBlockLanguageId> {
        return this._unloadedLanguageIds;
    }

    // NOCOMMIT: Document
    public updateUnloadedLanguageIds(): ContentCodeBlockIncrementalParser {
        if (this._unloadedLanguageIds.size === 0) return this;

        const newUnloadedLanguageIds = new Set<ContentCodeBlockLanguageId>();

        const newResults = this._results.map((oldResult, i) => {
            if (oldResult !== null) return oldResult;

            const node = this._nodeArray[i]!;
            const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
            const language = contentCodeBlockLanguageById[languageId];
            if (language.parser === null) return null;

            const parser = language.parser.getIfLoaded();
            if (parser === null) {
                newUnloadedLanguageIds.add(languageId);
                return null;
            }

            return createInitialContentCodeBlockIncrementalParserResult(node, parser);
        });

        const newDecorations = createContentCodeBlockIncrementalParserDecorationSet(
            this._nodeArray,
            this._nodePoses,
            newResults,
        );

        return new ContentCodeBlockIncrementalParser(
            this._nodeArray,
            this._nodeSet,
            this._nodePoses,
            newResults,
            newUnloadedLanguageIds,
            newDecorations,
        );
    }
}

function getContentCodeBlockNodes(
    doc: Node,
): [nodeArray: Array<Node>, nodeSet: Set<Node>, nodePoses: Array<number>] {
    assert(doc.type.name === "doc");

    const nodeArray: Array<Node> = [];
    const nodeSet = new Set<Node>();
    const nodePoses: Array<number> = [];

    doc.forEach((node, pos) => {
        // Currently, code blocks may only be a direct child of `doc`.
        if (node.type.name === "codeBlock") {
            nodeArray.push(node);
            nodeSet.add(node);
            nodePoses.push(pos);
        }
    });

    return [nodeArray, nodeSet, nodePoses];
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

    // `length` corresponds to the current position in the input string. It's
    // different from the ProseMirror position `pos` in that for `pos` each line
    // adds 2 (the start + end of the node) whereas for `length` each line adds 1
    // (a `\n` character).
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
            lineTo,
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

// NOCOMMIT: Talk about how we reference
// https://github.com/ProseMirror/prosemirror-view/blob/d3e9dcabe253707654978a9da9be9b9ce78db38d/src/decoration.ts#L692-L714
function createContentCodeBlockIncrementalParserDecorationSet(
    nodes: ReadonlyArray<Node>,
    poses: ReadonlyArray<number>,
    results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>,
): DecorationSet {
    const rootDecorations: Array<Decoration> = [];
    const rootChildDecorations: Array<number | DecorationSet> = [];

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
        const node = nodes[nodeIndex]!;
        const pos = poses[nodeIndex]!;
        const result = results[nodeIndex]!;

        if (result === null) continue;

        const nodeDecorations: Array<Decoration> = [];
        const nodeChildDecorations: Array<number | DecorationSet> = [];

        let relativePos = 0;

        for (let lineNodeIndex = 0; lineNodeIndex < node.content.content.length; lineNodeIndex++) {
            const lineNode = node.content.content[lineNodeIndex]!;
            const highlights = result.highlightsByLine[lineNodeIndex]!;

            const lineNodeDecorations: Array<Decoration> = [];

            for (const highlight of highlights) {
                const decoration = Decoration.inline(
                    pos + 2 + highlight.from,
                    pos + 2 + highlight.to,
                    {
                        nodeName: "span",
                        class: highlight.classes,
                    },
                );

                rootDecorations.push(decoration);
                nodeDecorations.push(decoration);
                lineNodeDecorations.push(decoration);
            }

            nodeChildDecorations.push(
                relativePos + 1,
                relativePos + 1 + lineNode.nodeSize,
                new DecorationSet(lineNodeDecorations, emptyArray),
            );

            relativePos += lineNode.nodeSize;
        }

        rootChildDecorations.push(
            pos + 1,
            pos + 1 + node.nodeSize,
            new DecorationSet(nodeDecorations, nodeChildDecorations),
        );
    }

    return new DecorationSet(rootDecorations, rootChildDecorations);
}
