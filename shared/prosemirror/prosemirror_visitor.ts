import {Mark, Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ExhaustiveStep} from "~/shared/prosemirror/prosemirror_exhaustive_step";

/**
 * Collections of functions that visit parts of a ProseMirror tree.
 */
export type ProsemirrorVisitor = {
    /**
     * Called for ProseMirror nodes. If this function returns false then we will
     * not visit the children or marks of this node.
     */
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
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

    rootNode.descendants(node => {
        const shouldVisitChildren = visitor.visitNode?.(node) ?? true;
        if (!shouldVisitChildren) return false;

        for (const mark of node.marks) {
            visitor.visitMark?.(mark);
        }
    });
}

/**
 * Call the visitor for all relevant objects in the provided step.
 */
export function visitProsemirrorStep(rootStep: Step, visitor: ProsemirrorVisitor) {
    const step = rootStep as ExhaustiveStep;
    switch (step.jsonID) {
        case "attr": {
            break;
        }
        case "addMark":
        case "removeMark":
        case "addNodeMark":
        case "removeNodeMark":
        case "removeAllMarks":
        case "addMarksAfterRemoveAll": {
            visitor.visitMark?.(step.mark);
            break;
        }
        case "replace":
        case "replaceAround": {
            step.slice.content.descendants(node => {
                visitProsemirrorNode(node, visitor);
                return false;
            });
            break;
        }
        default:
            throw exhaustive(step);
    }
}
