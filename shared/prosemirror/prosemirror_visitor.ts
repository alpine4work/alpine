import {Fragment, Mark, Node, Slice} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ExhaustiveStep} from "~/shared/prosemirror/prosemirror_exhaustive_step.js";

/**
 * Collections of functions that visit parts of a ProseMirror tree.
 */
export type ProsemirrorVisitor = {
    /**
     * Called for ProseMirror nodes. If this function returns false then we will
     * not visit the children or marks of this node.
     */
    readonly visitNode?: (node: Node) => boolean | void;

    /**
     * Called for ProseMirror marks.
     *
     * This is not the same as looking at marks in `visitNode` since when visiting
     * ProseMirror steps you could have a mark outside of a node.
     */
    readonly visitMark?: (mark: Mark) => void;
};

/**
 * Call the visitor for all relevant objects in the provided node.
 */
export function visitProsemirrorNode(rootNode: Node, visitor: ProsemirrorVisitor) {
    const shouldVisitRootChildren = visitor.visitNode?.(rootNode) ?? true;
    if (!shouldVisitRootChildren) return;

    for (const mark of rootNode.marks) {
        visitor.visitMark?.(mark);
    }

    visitProsemirrorFragment(rootNode.content, visitor);
}

/**
 * Call the visitor for all relevant objects in the provided fragment.
 */
export function visitProsemirrorFragment(rootFragment: Fragment, visitor: ProsemirrorVisitor) {
    rootFragment.descendants(node => {
        const shouldVisitChildren = visitor.visitNode?.(node) ?? true;
        if (!shouldVisitChildren) return false;

        for (const mark of node.marks) {
            visitor.visitMark?.(mark);
        }
    });
}

/**
 * Call the visitor for all relevant objects in the provided slice.
 */
export function visitProsemirrorSlice(slice: Slice, visitor: ProsemirrorVisitor) {
    visitProsemirrorFragment(slice.content, visitor);
}

/**
 * Call the visitor for all relevant objects in the provided step.
 *
 * If the step removes a mark we don't visit the mark since the mark is not
 * present in the content.
 */
export function visitProsemirrorStep(rootStep: Step, visitor: ProsemirrorVisitor) {
    const step = rootStep as ExhaustiveStep;
    switch (step.jsonID) {
        case "attr": {
            break;
        }
        case "addMark":
        case "addNodeMark":
        case "addMarksAfterRemoveAll": {
            visitor.visitMark?.(step.mark);
            break;
        }
        case "removeMark":
        case "removeNodeMark":
        case "removeAllMarks": {
            // We don't visit marks that are removed. Removed marks don't contribute a new
            // reference to the content.
            break;
        }
        case "replace":
        case "replaceAround": {
            visitProsemirrorSlice(step.slice, visitor);
            break;
        }
        default:
            throw exhaustive(step);
    }
}
