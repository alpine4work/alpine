import {
    AddMarkStep,
    AddNodeMarkStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    Step,
} from "prosemirror-transform";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

export function getExpectedAccessLevelForUpdateDocumentContentSteps(
    steps: ReadonlyArray<Step>,
): "Edit" | "Comment" {
    // If the client is ONLY adding or removing comment marks then it's ok if they have
    // the comment access level instead of the edit access level.
    if (
        steps.every(
            step =>
                (step instanceof AddMarkStep && step.mark.type.name === "comment") ||
                (step instanceof RemoveMarkStep && step.mark.type.name === "comment") ||
                (step instanceof AddNodeMarkStep && step.mark.type.name === "comment") ||
                (step instanceof RemoveNodeMarkStep && step.mark.type.name === "comment") ||
                (step instanceof AddMarksAfterRemoveAllStep && step.mark.type.name === "comment") ||
                (step instanceof RemoveAllMarksStep && step.mark.type.name === "comment"),
        )
    ) {
        return "Comment";
    }

    return "Edit";
}
