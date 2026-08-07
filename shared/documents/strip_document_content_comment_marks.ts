import {Fragment, Mark, Node, Slice} from "prosemirror-model";
import {RemoveMarkStep, ReplaceAroundStep, ReplaceStep, Step} from "prosemirror-transform";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.open_source.js";
import {ExhaustiveStep} from "~/shared/prosemirror/exhaustive_step.js";

/**
 * Strip all comment marks from the provided node. You may chose to include some
 * marks by providing a set of `DocumentCommentThreadId`s.
 */
export function stripDocumentContentCommentMarks(
    node: Node,
    options?: {exceptCommentThreadIds?: ReadonlySet<DocumentCommentThreadId>},
): Node {
    const newChildNodes: Array<Node> = [];
    let hasChildNodeChanged = false;

    for (let i = 0; i < node.childCount; i++) {
        const childNode = node.child(i);
        const newChildNode = stripDocumentContentCommentMarks(childNode, options);

        newChildNodes.push(newChildNode);

        hasChildNodeChanged ||= childNode !== newChildNode;
    }

    const newMarks = node.marks.filter(
        mark =>
            mark.type.name !== "comment" ||
            options?.exceptCommentThreadIds?.has(mark.attrs.commentThreadId),
    );

    if (newMarks.length === node.marks.length && !hasChildNodeChanged) return node;

    // `node.type.create()` doesn't work for text nodes.
    if (node.type.isText) {
        return node.type.schema.text(node.text!, newMarks);
    }

    return node.type.create(node.attrs, newChildNodes, newMarks);
}

/**
 * Strip all comment marks from the provided slice.
 */
function stripDocumentContentSliceCommentMarks(slice: Slice): Slice {
    const newChildNodes: Array<Node> = [];
    let hasChildNodeChanged = false;

    for (let i = 0; i < slice.content.childCount; i++) {
        const childNode = slice.content.child(i);
        const newChildNode = stripDocumentContentCommentMarks(childNode);

        newChildNodes.push(newChildNode);

        hasChildNodeChanged ||= childNode !== newChildNode;
    }

    if (!hasChildNodeChanged) return slice;

    return new Slice(Fragment.from(newChildNodes), slice.openStart, slice.openEnd);
}

/**
 * Strip all comment marks from the provided step.
 */
export function stripDocumentContentStepCommentMarks(actualStep: Step): Step {
    const step = actualStep as ExhaustiveStep;

    switch (step.jsonID) {
        // The `attr` step only updates node attributes. It can't update mark attributes
        // like `commentThreadId`.
        case "attr":
        case "docAttr": {
            return step;
        }
        case "addMark": {
            if (step.mark.type.name === "comment") {
                return createNoopStep(step.mark);
            }
            return step;
        }
        case "removeMark": {
            if (step.mark.type.name === "comment") {
                return createNoopStep(step.mark);
            }
            return step;
        }
        case "addNodeMark": {
            if (step.mark.type.name === "comment") {
                return createNoopStep(step.mark);
            }
            return step;
        }
        case "removeNodeMark": {
            if (step.mark.type.name === "comment") {
                return createNoopStep(step.mark);
            }
            return step;
        }
        case "replace": {
            const slice = stripDocumentContentSliceCommentMarks(step.slice);
            if (slice === step.slice) return step;

            return new ReplaceStep(step.from, step.to, slice, step.structure);
        }
        case "replaceAround": {
            const slice = stripDocumentContentSliceCommentMarks(step.slice);
            if (slice === step.slice) return step;

            return new ReplaceAroundStep(
                step.from,
                step.to,
                step.gapFrom,
                step.gapTo,
                slice,
                step.insert,
                step.structure,
            );
        }
        case "removeAllMarks": {
            if (step.mark.type.name === "comment") {
                return createNoopStep(step.mark);
            }
            return step;
        }
        case "addMarksAfterRemoveAll": {
            if (step.mark.type.name === "comment") {
                return createNoopStep(step.mark);
            }
            return step;
        }
        default:
            throw exhaustive(step);
    }
}

/**
 * When stripping a comment mark from steps we can't actually replace the step will
 * null. Since that would break ProseMirror's support for realtime updates. Instead
 * we need to replace the comment step with a noop step so we still have a step
 * that contributes to the document's version number.
 *
 * Our noop step is a `removeMark` step removing a bold mark from an empty range at
 * the start of the document. This is [always a noop][1].
 *
 * If we were to replace an `addMark` steps with `addMark` and `removeMark` steps
 * with `removeMark` then a malicious user could look at the noop steps their
 * client was receiving and use it to estimate the number of comments on the
 * document. With this approach unfortunately a malicious user can still estimate
 * an upper bound of the comment count on a document but this information will be
 * very imprecise and ultimately, we believe, not useful for any attacks.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-transform/blob/8b99c92ca46c3d7c903bb3c83127676e9ded18ee/src/mark_step.ts#L88-L94
 */
function createNoopStep(mark: Mark): Step {
    return new RemoveMarkStep(0, 0, mark.type.schema.marks.bold!.create());
}
