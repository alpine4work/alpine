import {ChangedRange, Parser, Tree, TreeFragment} from "@lezer/common";
import {Node} from "prosemirror-model";
import {contentCodeBlockLanguageById} from "~/client/content/code/content_code_block_language.js";
import {createContentCodeBlockNodeInput} from "~/client/content/code/create_content_code_block_node_input.js";
import {actuallySymmetricDiffIterable} from "~/client/content/code/symmetric_diff_iterable.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type ContentCodeBlockIncrementalParserResult = {
    readonly parser: Parser;
    readonly tree: Tree;
    readonly treeFragments: ReadonlyArray<TreeFragment>;
    readonly lineNodeSet: ReadonlySet<Node>;
};

// NOCOMMIT: Document
export class ContentCodeBlockIncrementalParser {
    // NOCOMMIT: Document
    private readonly _nodeArray: ReadonlyArray<Node>;
    private readonly _nodeSet: ReadonlySet<Node>;
    private readonly _results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>;
    private readonly _unloadedLanguageIds: ReadonlySet<ContentCodeBlockLanguageId>;

    private constructor(
        nodeArray: ReadonlyArray<Node>,
        nodeSet: ReadonlySet<Node>,
        results: ReadonlyArray<ContentCodeBlockIncrementalParserResult | null>,
        unloadedLanguageIds: ReadonlySet<ContentCodeBlockLanguageId>,
    ) {
        this._nodeArray = nodeArray;
        this._nodeSet = nodeSet;
        this._results = results;
        this._unloadedLanguageIds = unloadedLanguageIds;
    }

    public static new(doc: Node): ContentCodeBlockIncrementalParser {
        const [nodeArray, nodeSet] = getContentCodeBlockNodes(doc);

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

            const input = createContentCodeBlockNodeInput(node);
            const tree = parser.parse(input);
            const treeFragments = TreeFragment.addTree(tree);

            const lineNodeSet = new Set(node.content.content);

            return {
                parser,
                tree,
                treeFragments,
                lineNodeSet,
            };
        });

        return new ContentCodeBlockIncrementalParser(
            nodeArray,
            nodeSet,
            results,
            unloadedLanguageIds,
        );
    }

    // NOCOMMIT: Document
    // NOCOMMIT: Test???
    public update(doc: Node): ContentCodeBlockIncrementalParser {
        const [newNodeArray, newNodeSet] = getContentCodeBlockNodes(doc);

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
                    const oldEntry = candidateOldEntries?.shift();

                    const newNode = change.value;
                    const newLanguageId: ContentCodeBlockLanguageId =
                        newNode.attrs.language ?? "text";

                    const newInput = createContentCodeBlockNodeInput(newNode);
                    const newLineNodeSet = new Set(newNode.content.content);

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

                        const tree = parser.parse(newInput);
                        const treeFragments = TreeFragment.addTree(tree);

                        newResults.push({
                            parser,
                            tree,
                            treeFragments,
                            lineNodeSet: newLineNodeSet,
                        });
                    } else {
                        const {
                            parser,
                            treeFragments: oldTreeFragments,
                            lineNodeSet: oldLineNodeSet,
                        } = oldEntry.result;

                        const changedRanges = getContentCodeBlockNodeChangedRanges(
                            oldEntry.node,
                            oldLineNodeSet,
                            newNode,
                            newLineNodeSet,
                        );

                        let newTreeFragments = TreeFragment.applyChanges(
                            oldTreeFragments,
                            changedRanges,
                        );

                        const newTree = parser.parse(newInput, newTreeFragments);
                        newTreeFragments = TreeFragment.addTree(newTree, newTreeFragments);

                        newResults.push({
                            parser,
                            tree: newTree,
                            treeFragments: newTreeFragments,
                            lineNodeSet: newLineNodeSet,
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(change.type);
            }
        }

        return new ContentCodeBlockIncrementalParser(
            newNodeArray,
            newNodeSet,
            newResults,
            newUnloadedLanguageIds ?? this._unloadedLanguageIds,
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

            const input = createContentCodeBlockNodeInput(node);
            const tree = parser.parse(input);
            const treeFragments = TreeFragment.addTree(tree);

            const lineNodeSet = new Set(node.content.content);

            return {
                parser,
                tree,
                treeFragments,
                lineNodeSet,
            };
        });

        return new ContentCodeBlockIncrementalParser(
            this._nodeArray,
            this._nodeSet,
            newResults,
            newUnloadedLanguageIds,
        );
    }
}

function getContentCodeBlockNodes(doc: Node): [Array<Node>, Set<Node>] {
    assert(doc.type.name === "doc");

    const codeBlockNodeArray: Array<Node> = [];
    const codeBlockNodeSet = new Set<Node>();

    doc.forEach(node => {
        // Currently, code blocks may only be a direct child of `doc`.
        if (node.type.name === "codeBlock") {
            codeBlockNodeArray.push(node);
            codeBlockNodeSet.add(node);
        }
    });

    return [codeBlockNodeArray, codeBlockNodeSet];
}

function getContentCodeBlockNodeChangedRanges(
    oldNode: Node,
    oldLineNodeSet: ReadonlySet<Node>,
    newNode: Node,
    newLineNodeSet: ReadonlySet<Node>,
): Array<ChangedRange> {
    const changes = actuallySymmetricDiffIterable(
        oldNode.content.content,
        oldLineNodeSet,
        newNode.content.content,
        newLineNodeSet,
    );

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
