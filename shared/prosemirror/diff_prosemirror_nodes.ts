import {Fragment, Mark, Node, Schema, Slice} from "prosemirror-model";
import {
    AddMarkStep,
    AddNodeMarkStep,
    DocAttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
    Step,
    StepResult,
    Transform,
} from "prosemirror-transform";
import {findSpans} from "unicode-default-word-boundary";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {DiffChange, diff} from "~/shared/helpers/diff/diff.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

/**
 * Diffs two ProseMirror docs and returns the optimal set of steps needed to turn
 * the old doc into the new doc.
 *
 * The following invariant will always be met no matter the step output:
 *
 * ```ts
 * const steps = diffProsemirrorNodes(oldNode, newNode);
 *
 * const actualNode = steps.reduce((node, step, index) => {
 *     const stepResult = step.apply(node);
 *     return assertExists(stepResult.doc);
 * }, oldNode);
 *
 * assert(actualNode.eq(newNode));
 * ```
 *
 * This function tries to return an optimal set of steps whenever possible. That is
 * the set of steps that make the fewest updates to `oldNode`. So that in
 * collaborative editing scenarios we minimize conflicts with other collaborative
 * editors.
 */
export function diffProsemirrorNodes(oldNode: Node, newNode: Node): Array<Step> {
    assert(oldNode.type.schema === newNode.type.schema);
    const {schema} = oldNode.type;

    // We assume you're calling this with top-level ProseMirror nodes. Otherwise we
    // can't use `DocAttrStep` to update top-level attributes.
    assert(oldNode.type === schema.topNodeType);
    assert(newNode.type === schema.topNodeType);

    const transform = new Transform(oldNode);

    // Treat some thrown failures from ProseMirror `transform.maybeStep()` function as
    // expected.
    const maybeStep = (step: Step) => {
        try {
            const result = step.apply(transform.doc);

            if (result.doc !== null) {
                // We've observed that `ReplaceAroundStep` doesn't throw when rewrapping a node
                // like `quoteBlock(paragraph("a"), orderedListItem("b"))` with
                // `unorderedListItem(paragraph("a"), orderedListItem("b"))`. This should be
                // considered an error since `unorderedListItem` can't have list item children
                // (whereas `quoteBlock` can).
                //
                // We depend on this function throwing when we create an invalid node. So detect
                // when we're performing a wrap `ReplaceAroundStep` and call `check()` ourselves
                // just to make sure we throw if the newly created node is invalid.
                if (step instanceof ReplaceAroundStep && step.insert > 0) {
                    const $from = result.doc.resolve(step.from);
                    assertExists($from.nodeAfter).check();
                }

                // We're calling [an internal method on the `Transform` class][1] as we're
                // reimplementing `maybeStep()`.
                //
                // [1]:
                //     https://github.com/ProseMirror/prosemirror-transform/blob/662b7a937bafde19b7e2a83241dbc8888e257c89/src/transform.ts#L88-L94
                (transform as any).addStep(step, result.doc);
            }

            return result;
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("Invalid content for node ")) {
                return StepResult.fail(error.message);
            }
            throw error;
        }
    };

    let pendingSteps: Array<Step> = [];

    // Attempt to apply a step. If we can't then push it to the `pendingSteps` array.
    // We will try the step again after the next successful step.
    const attemptStep = (step: Step): boolean => {
        const mappedStep = step.map(transform.mapping);
        if (mappedStep === null) return false;

        const result = maybeStep(mappedStep);
        if (result.failed !== null) {
            pendingSteps.push(step);
            return false;
        }

        return true;
    };

    // Attempt any pending steps that may have been unblocked by the last successful
    // step. The flush repeats as long as there are successful steps.
    const flushPendingSteps = () => {
        if (pendingSteps.length === 0) return;

        let again = true;

        while (again) {
            again = false;

            const steps = pendingSteps;
            pendingSteps = [];

            for (const step of steps) {
                if (attemptStep(step)) {
                    again = true;
                }
            }
        }
    };

    // Check for any doc attribute changes.
    for (const [attr, value] of Object.entries(newNode.attrs)) {
        if (!isDeepEqual(oldNode.attrs[attr], value)) {
            attemptStep(new DocAttrStep(attr, value));
        }
    }

    diffNodes({
        schema,
        oldPos: 0,
        oldNodes: oldNode.content.content,
        newNodes: newNode.content.content,
        pushStep: step => {
            if (attemptStep(step)) {
                flushPendingSteps();
            }
        },
    });

    // Once we're done diffing, any pending steps that are left are failures. Run them
    // one last time and throw their error message.
    if (pendingSteps.length > 0) {
        for (const step of pendingSteps) {
            const mappedStep = step.map(transform.mapping);
            if (mappedStep === null) continue;

            const result = maybeStep(mappedStep);
            if (result.failed !== null) {
                throw new InternalError(result.failed);
            }
        }
        throw new InternalError("Expected all remaining pending steps to be failures");
    }

    return transform.steps;
}

function diffNodes({
    schema,
    oldPos,
    oldNodes,
    newNodes,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    oldNodes: ReadonlyArray<Node>;
    newNodes: ReadonlyArray<Node>;
    pushStep: (step: Step) => void;
}) {
    const changes = diff(oldNodes, newNodes, {equals: areNodesCompatible});

    makeChanges({schema, oldPos, changes, pushStep});
}

function areNodesCompatible(node1: Node, node2: Node): boolean {
    return getNodeCompatibilityKey(node1) === getNodeCompatibilityKey(node2);
}

let compatibilityKeyByNode: WeakMap<Node, string> | null = null;

function getNodeCompatibilityKey(node: Node): string {
    compatibilityKeyByNode ??= new WeakMap();

    return getOrSetDefaultMapValue(compatibilityKeyByNode, node, () => {
        // Text nodes should be handled when traversing children.
        assert(!node.isText);

        const contentStrings: Array<string> = [];

        for (const childNode of node.content.content) {
            if (childNode.isText) {
                if (
                    contentStrings.length > 0 &&
                    contentStrings[contentStrings.length - 1] === "text"
                ) {
                    continue;
                } else {
                    contentStrings.push("text");
                    continue;
                }
            }

            contentStrings.push(getNodeCompatibilityKey(childNode));
        }

        // Consider some nodes in the same family as compatible.
        const typeString = node.type.isTextblock
            ? "textblock"
            : node.type.isInGroup("listItem")
              ? "listItem"
              : node.type.name;

        if (contentStrings.length === 0) {
            return typeString;
        } else {
            return `${typeString}(${contentStrings.join(", ")})`;
        }
    });
}

function makeChanges({
    schema,
    oldPos,
    changes,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    changes: Array<DiffChange<Node>>;
    pushStep: (step: Step) => void;
}) {
    let pendingHunk: {
        oldFrom: number;
        removedChanges: Array<Extract<DiffChange<Node>, {type: "Removed"}>>;
        addedChanges: Array<Extract<DiffChange<Node>, {type: "Added"}>>;
    } | null = null;

    const flushHunk = () => {
        if (pendingHunk === null) return;
        const {oldFrom, removedChanges, addedChanges} = pendingHunk;
        pendingHunk = null;

        applyHunk({schema, oldPos: oldFrom, removedChanges, addedChanges, pushStep});
    };

    for (const change of changes) {
        switch (change.type) {
            case "Removed": {
                pendingHunk ??= {oldFrom: oldPos, removedChanges: [], addedChanges: []};
                pendingHunk.removedChanges.push(change);
                oldPos += change.oldToken.nodeSize;
                break;
            }
            case "Added": {
                pendingHunk ??= {oldFrom: oldPos, removedChanges: [], addedChanges: []};
                pendingHunk.addedChanges.push(change);
                break;
            }
            case "Equal": {
                flushHunk();

                diffNodesMarkup({
                    oldPos,
                    oldNode: change.oldToken,
                    newNode: change.newToken,
                    pushStep,
                });

                if (!change.oldToken.isLeaf) {
                    diffEqualNodesContent({
                        schema,
                        oldPos,
                        oldNode: change.oldToken,
                        newNode: change.newToken,
                        pushStep,
                    });
                }

                oldPos += change.oldToken.nodeSize;
                break;
            }
            default:
                throw exhaustive(change);
        }
    }

    flushHunk();
}

function applyHunk({
    schema,
    oldPos,
    removedChanges,
    addedChanges,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    removedChanges: Array<Extract<DiffChange<Node>, {type: "Removed"}>>;
    addedChanges: Array<Extract<DiffChange<Node>, {type: "Added"}>>;
    pushStep: (step: Step) => void;
}) {
    const oldNodes = removedChanges.map(({oldToken}) => oldToken);
    const newNodes = addedChanges.map(({newToken}) => newToken);

    const commonLength = Math.min(oldNodes.length, newNodes.length);

    let pendingReplaceStep: {
        oldFrom: number;
        oldSize: number;
        newNodes: Array<Node>;
    } | null = null;

    const flushReplaceStep = () => {
        if (pendingReplaceStep === null) return;
        const {oldFrom, oldSize, newNodes} = pendingReplaceStep;
        pendingReplaceStep = null;

        const slice = new Slice(Fragment.fromArray(newNodes), 0, 0);
        pushStep(new ReplaceStep(oldFrom, oldFrom + oldSize, slice));
    };

    for (let index = 0; index < commonLength; index++) {
        const newNode = newNodes[index]!;
        const oldNode = oldNodes[index]!;

        const hasCompatibleContent =
            !newNode.isLeaf && !oldNode.isLeaf && newNode.type.compatibleContent(oldNode.type);

        if (!hasCompatibleContent) {
            pendingReplaceStep ??= {oldFrom: oldPos, oldSize: 0, newNodes: []};
            pendingReplaceStep.oldSize += oldNode.nodeSize;
            pendingReplaceStep.newNodes.push(newNode);
        } else {
            flushReplaceStep();

            diffCompatibleContentNodes({
                schema,
                oldPos,
                oldNode,
                newNode,
                pushStep,
            });
        }

        oldPos += oldNode.nodeSize;
    }

    for (let index = commonLength; index < oldNodes.length; index++) {
        const oldNode = oldNodes[index]!;
        pendingReplaceStep ??= {oldFrom: oldPos, oldSize: 0, newNodes: []};
        pendingReplaceStep.oldSize += oldNode.nodeSize;
        oldPos += oldNode.nodeSize;
    }

    for (let index = commonLength; index < newNodes.length; index++) {
        const newNode = newNodes[index]!;
        pendingReplaceStep ??= {oldFrom: oldPos, oldSize: 0, newNodes: []};
        pendingReplaceStep.newNodes.push(newNode);
    }

    flushReplaceStep();
}

function diffCompatibleContentNodes({
    schema,
    oldPos,
    oldNode,
    newNode,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    oldNode: Node;
    newNode: Node;
    pushStep: (step: Step) => void;
}) {
    diffNodesMarkup({
        oldPos,
        oldNode,
        newNode,
        pushStep,
    });

    if (!newNode.isTextblock) {
        diffNodes({
            schema,
            oldPos: oldPos + 1,
            oldNodes: oldNode.content.content,
            newNodes: newNode.content.content,
            pushStep,
        });
    } else {
        diffTextblockNodes({
            schema,
            oldPos: oldPos + 1,
            oldNodes: oldNode.content.content,
            newNodes: newNode.content.content,
            pushStep,
        });
    }
}

function diffNodesMarkup(options: {
    oldPos: number;
    oldNode: Node;
    newNode: Node;
    pushStep: (step: Step) => void;
}) {
    const {oldNode, oldPos, newNode, pushStep} = options;

    diffNodesMarkupWithoutMarks(options);

    const {removeMarks, addMarks} = diffMarks({
        oldMarks: oldNode.marks,
        newMarks: newNode.marks,
    });

    if (removeMarks !== null) {
        for (const {mark} of removeMarks) {
            pushStep(new RemoveNodeMarkStep(oldPos, mark));
        }
    }

    if (addMarks !== null) {
        for (const {mark} of addMarks) {
            pushStep(new AddNodeMarkStep(oldPos, mark));
        }
    }
}

function diffNodesMarkupWithoutMarks({
    oldPos,
    oldNode,
    newNode,
    pushStep,
}: {
    oldPos: number;
    oldNode: Node;
    newNode: Node;
    pushStep: (step: Step) => void;
}) {
    // If the type or attributes changed, replace the node.
    if (oldNode.type === newNode.type && isDeepEqual(oldNode.attrs, newNode.attrs)) {
        return;
    }

    if (oldNode.isLeaf) {
        pushStep(
            new ReplaceStep(
                oldPos,
                oldPos + oldNode.nodeSize,
                new Slice(Fragment.from(newNode), 0, 0),
            ),
        );
    } else {
        pushStep(
            new ReplaceAroundStep(
                oldPos,
                oldPos + oldNode.nodeSize,
                oldPos + 1,
                oldPos + oldNode.nodeSize - 1,
                new Slice(Fragment.from(newNode.copy()), 0, 0),
                1,
            ),
        );
    }
}

function diffMarks({
    oldMarks,
    newMarks,
}: {
    oldMarks: ReadonlyArray<Mark>;
    newMarks: ReadonlyArray<Mark>;
}): {
    removeMarks: Array<{mark: Mark; isPending: boolean}> | null;
    addMarks: Array<{index: number; mark: Mark; isPending: boolean}> | null;
} {
    let removeMarks: Array<{mark: Mark; isPending: boolean}> | null = null;
    let addMarks: Array<{index: number; mark: Mark; isPending: boolean}> | null = null;

    const markTypeNames = new Set<string>();

    for (const oldMark of oldMarks) {
        markTypeNames.add(oldMark.type.name);
    }

    for (const newMark of newMarks) {
        markTypeNames.add(newMark.type.name);
    }

    // Add-mark steps always append marks of the same type, so for each mark type we
    // keep the longest prefix of the new mark order that already appears as a
    // subsequence of the old mark order. Everything else gets removed and re-added in
    // the new order.
    for (const markTypeName of markTypeNames) {
        const oldCurrentMarks = oldMarks.filter(oldMark => oldMark.type.name === markTypeName);
        const newCurrentMarks = newMarks.flatMap((newMark, index) =>
            newMark.type.name === markTypeName ? [{index, mark: newMark}] : [],
        );
        const keptOldCurrentMarks = new Set<number>();

        let oldCurrentMarkIndex = 0;
        let keepPrefixLength = 0;

        for (const {mark} of newCurrentMarks) {
            while (
                oldCurrentMarkIndex < oldCurrentMarks.length &&
                !oldCurrentMarks[oldCurrentMarkIndex]!.eq(mark)
            ) {
                oldCurrentMarkIndex++;
            }

            if (oldCurrentMarkIndex === oldCurrentMarks.length) break;

            keptOldCurrentMarks.add(oldCurrentMarkIndex);
            oldCurrentMarkIndex++;
            keepPrefixLength++;
        }

        for (let index = 0; index < oldCurrentMarks.length; index++) {
            if (keptOldCurrentMarks.has(index)) continue;

            removeMarks ??= [];
            removeMarks.push({mark: oldCurrentMarks[index]!, isPending: false});
        }

        for (let index = keepPrefixLength; index < newCurrentMarks.length; index++) {
            const {index: newMarkIndex, mark} = newCurrentMarks[index]!;
            addMarks ??= [];
            addMarks.push({index: newMarkIndex, mark, isPending: false});
        }
    }

    addMarks?.sort((left, right) => left.index - right.index);

    return {removeMarks, addMarks};
}

function diffTextblockNodes({
    schema,
    oldPos,
    oldNodes,
    newNodes,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    oldNodes: ReadonlyArray<Node>;
    newNodes: ReadonlyArray<Node>;
    pushStep: (step: Step) => void;
}) {
    const oldTokens = Array.from(tokenizeTextblocks(oldNodes));
    const newTokens = Array.from(tokenizeTextblocks(newNodes));

    const changes = diff(oldTokens, newTokens, {equals: areTextblockTokensCompatible});

    makeTextblockChanges({
        schema,
        oldPos,
        changes,
        pushStep,
    });
}

type TextblockToken =
    | {
          readonly type: "Text";
          readonly size: number;
          readonly text: string;
          readonly marks: ReadonlyArray<Mark>;
      }
    | {
          readonly type: "Node";
          readonly size: number;
          readonly node: Node;
          readonly marks: ReadonlyArray<Mark>;
      };

function* tokenizeTextblocks(nodes: ReadonlyArray<Node>): IterableIterator<TextblockToken> {
    for (const node of nodes) {
        if (!node.isText) {
            yield {type: "Node", size: node.nodeSize, node, marks: node.marks};
            continue;
        }

        const text = node.text!;

        for (const span of findSpans(text)) {
            yield {type: "Text", size: span.text.length, text: span.text, marks: node.marks};
        }
    }
}

function areTextblockTokensCompatible(token1: TextblockToken, token2: TextblockToken): boolean {
    switch (token1.type) {
        case "Text": {
            if (token2.type !== "Text") return false;
            return token1.text === token2.text;
        }
        case "Node": {
            if (token2.type !== "Node") return false;
            return areNodesCompatible(token1.node, token2.node);
        }
        default:
            throw exhaustive(token1);
    }
}

function makeTextblockChanges({
    schema,
    oldPos,
    changes,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    changes: Array<DiffChange<TextblockToken>>;
    pushStep: (step: Step) => void;
}) {
    let pendingHunk: {
        oldFrom: number;
        removedChanges: Array<Extract<DiffChange<TextblockToken>, {type: "Removed"}>>;
        addedChanges: Array<Extract<DiffChange<TextblockToken>, {type: "Added"}>>;
    } | null = null;

    const flushHunk = () => {
        if (pendingHunk === null) return;
        const {oldFrom, removedChanges, addedChanges} = pendingHunk;
        pendingHunk = null;

        applyTextblockHunk({schema, oldPos: oldFrom, removedChanges, addedChanges, pushStep});
    };

    const pendingRemoveMarks: Array<{oldFrom: number; mark: Mark}> = [];
    const pendingAddMarks: Array<{oldFrom: number; mark: Mark}> = [];

    const flushAllMarks = () => {
        while (pendingRemoveMarks.length > 0) {
            const removeMark = pendingRemoveMarks.shift()!;
            pushStep(new RemoveMarkStep(removeMark.oldFrom, oldPos, removeMark.mark));
        }

        while (pendingAddMarks.length > 0) {
            const addMark = pendingAddMarks.shift()!;
            pushStep(new AddMarkStep(addMark.oldFrom, oldPos, addMark.mark));
        }
    };

    const flushMarks = (oldMarks: ReadonlyArray<Mark>, newMarks: ReadonlyArray<Mark>) => {
        const {removeMarks, addMarks} = diffMarks({oldMarks, newMarks});

        if (removeMarks === null && addMarks === null) {
            flushAllMarks();
            return;
        }

        let nextIndex = 0;
        outer: while (nextIndex < pendingRemoveMarks.length) {
            const index = nextIndex;
            nextIndex++;
            const pendingRemoveMark = pendingRemoveMarks[index]!;

            if (removeMarks !== null) {
                for (const removeMark of removeMarks) {
                    if (pendingRemoveMark.mark.eq(removeMark.mark)) {
                        removeMark.isPending = true;
                        continue outer;
                    }
                }
            }

            pendingRemoveMarks.splice(index, 1);
            nextIndex = index;

            pushStep(new RemoveMarkStep(pendingRemoveMark.oldFrom, oldPos, pendingRemoveMark.mark));
        }

        nextIndex = 0;
        outer: while (nextIndex < pendingAddMarks.length) {
            const index = nextIndex;
            nextIndex++;
            const pendingAddMark = pendingAddMarks[index]!;

            if (addMarks !== null) {
                for (const addMark of addMarks) {
                    if (pendingAddMark.mark.eq(addMark.mark)) {
                        addMark.isPending = true;
                        continue outer;
                    }
                }
            }

            pendingAddMarks.splice(index, 1);
            nextIndex = index;

            pushStep(new AddMarkStep(pendingAddMark.oldFrom, oldPos, pendingAddMark.mark));
        }

        if (removeMarks !== null) {
            for (const removeMark of removeMarks) {
                if (removeMark.isPending) continue;

                pendingRemoveMarks.push({
                    oldFrom: oldPos,
                    mark: removeMark.mark,
                });
            }
        }

        if (addMarks !== null) {
            for (const addMark of addMarks) {
                if (addMark.isPending) continue;

                pendingAddMarks.push({
                    oldFrom: oldPos,
                    mark: addMark.mark,
                });
            }
        }
    };

    for (const change of changes) {
        switch (change.type) {
            case "Removed": {
                flushAllMarks();

                pendingHunk ??= {oldFrom: oldPos, removedChanges: [], addedChanges: []};
                pendingHunk.removedChanges.push(change);
                oldPos += change.oldToken.size;
                break;
            }
            case "Added": {
                flushAllMarks();

                pendingHunk ??= {oldFrom: oldPos, removedChanges: [], addedChanges: []};
                pendingHunk.addedChanges.push(change);
                break;
            }
            case "Equal": {
                flushHunk();

                switch (change.oldToken.type) {
                    case "Text": {
                        assert(change.newToken.type === "Text");

                        flushMarks(change.oldToken.marks, change.newToken.marks);
                        break;
                    }
                    case "Node": {
                        assert(change.newToken.type === "Node");

                        flushMarks(change.oldToken.marks, change.newToken.marks);

                        // Don't diff the node's marks because we've already handled marks with the
                        // `flushMarks()` call above.
                        diffNodesMarkupWithoutMarks({
                            oldPos,
                            oldNode: change.oldToken.node,
                            newNode: change.newToken.node,
                            pushStep,
                        });

                        if (!change.oldToken.node.isLeaf) {
                            diffEqualNodesContent({
                                schema,
                                oldPos,
                                oldNode: change.oldToken.node,
                                newNode: change.newToken.node,
                                pushStep,
                            });
                        }
                        break;
                    }
                    default:
                        throw exhaustive(change.oldToken);
                }

                oldPos += change.oldToken.size;
                break;
            }
            default:
                throw exhaustive(change);
        }
    }

    flushAllMarks();
    flushHunk();
}

function applyTextblockHunk({
    schema,
    oldPos,
    removedChanges,
    addedChanges,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    removedChanges: Array<Extract<DiffChange<TextblockToken>, {type: "Removed"}>>;
    addedChanges: Array<Extract<DiffChange<TextblockToken>, {type: "Added"}>>;
    pushStep: (step: Step) => void;
}) {
    const oldTokens = removedChanges.map(({oldToken}) => oldToken);
    const newTokens = addedChanges.map(({newToken}) => newToken);

    const commonLength = Math.min(oldTokens.length, newTokens.length);

    let pendingReplaceStep: {
        oldFrom: number;
        oldSize: number;
        newNodes: Array<Node>;
    } | null = null;

    const flushReplaceStep = () => {
        if (pendingReplaceStep === null) return;
        const {oldFrom, oldSize, newNodes} = pendingReplaceStep;
        pendingReplaceStep = null;

        const slice = new Slice(Fragment.fromArray(newNodes), 0, 0);
        pushStep(new ReplaceStep(oldFrom, oldFrom + oldSize, slice));
    };

    for (let index = 0; index < commonLength; index++) {
        const newToken = newTokens[index]!;
        const oldToken = oldTokens[index]!;

        const hasCompatibleContent =
            newToken.type === "Node" &&
            oldToken.type === "Node" &&
            !newToken.node.isLeaf &&
            !oldToken.node.isLeaf &&
            newToken.node.type.compatibleContent(oldToken.node.type);

        if (!hasCompatibleContent) {
            pendingReplaceStep ??= {oldFrom: oldPos, oldSize: 0, newNodes: []};
            pendingReplaceStep.oldSize += oldToken.size;

            switch (newToken.type) {
                case "Node": {
                    pendingReplaceStep.newNodes.push(newToken.node);
                    break;
                }
                case "Text": {
                    pendingReplaceStep.newNodes.push(schema.text(newToken.text, newToken.marks));
                    break;
                }
                default:
                    throw exhaustive(newToken);
            }
        } else {
            flushReplaceStep();

            diffCompatibleContentNodes({
                schema,
                oldPos,
                oldNode: oldToken.node,
                newNode: newToken.node,
                pushStep,
            });
        }

        oldPos += oldToken.size;
    }

    for (let index = commonLength; index < oldTokens.length; index++) {
        const oldToken = oldTokens[index]!;
        pendingReplaceStep ??= {oldFrom: oldPos, oldSize: 0, newNodes: []};
        pendingReplaceStep.oldSize += oldToken.size;
        oldPos += oldToken.size;
    }

    for (let index = commonLength; index < newTokens.length; index++) {
        const newToken = newTokens[index]!;
        pendingReplaceStep ??= {oldFrom: oldPos, oldSize: 0, newNodes: []};

        switch (newToken.type) {
            case "Node": {
                pendingReplaceStep.newNodes.push(newToken.node);
                break;
            }
            case "Text": {
                pendingReplaceStep.newNodes.push(schema.text(newToken.text, newToken.marks));
                break;
            }
            default:
                throw exhaustive(newToken);
        }
    }

    flushReplaceStep();
}

function diffEqualNodesContent({
    schema,
    oldPos,
    oldNode,
    newNode,
    pushStep,
}: {
    schema: Schema;
    oldPos: number;
    oldNode: Node;
    newNode: Node;
    pushStep: (step: Step) => void;
}) {
    // We perform word-level diffing for text in textblocks. So don't assume one `text`
    // child node will line up cleanly with another `text` child node.
    if (newNode.isTextblock) {
        diffTextblockNodes({
            schema,
            oldPos: oldPos + 1,
            oldNodes: oldNode.content.content,
            newNodes: newNode.content.content,
            pushStep,
        });
        return;
    }

    // At this point, we know the old/new nodes don't have text children. The only
    // things which differ are type, attrs, marks, and text. The count of non-text
    // nodes will always be the same.
    assert(oldNode.content.content.length === newNode.content.content.length);

    oldPos += 1;

    for (let index = 0; index < oldNode.content.content.length; index++) {
        const oldChildNode = oldNode.content.content[index]!;
        const newChildNode = newNode.content.content[index]!;

        diffNodesMarkup({
            oldPos,
            oldNode: oldChildNode,
            newNode: newChildNode,
            pushStep,
        });

        diffEqualNodesContent({
            schema,
            oldPos,
            oldNode: oldChildNode,
            newNode: newChildNode,
            pushStep,
        });

        oldPos += oldChildNode.nodeSize;
    }
}
