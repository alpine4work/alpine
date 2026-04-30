import {
    AddMarkStep,
    AddNodeMarkStep,
    AttrStep,
    DocAttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
} from "prosemirror-transform";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

export type StepByJsonId = {
    attr: AttrStep;
    docAttr: DocAttrStep;
    addMark: AddMarkStep;
    removeMark: RemoveMarkStep;
    addNodeMark: AddNodeMarkStep;
    removeNodeMark: RemoveNodeMarkStep;
    replace: ReplaceStep;
    replaceAround: ReplaceAroundStep;
    removeAllMarks: RemoveAllMarksStep;
    addMarksAfterRemoveAll: AddMarksAfterRemoveAllStep;
};

/**
 * `Step`s have a `jsonID` property used when serializing to/from JSON. This type
 * is a union of all known step class with their `jsonID` to allow for exhaustive
 * switching.
 */
export type ExhaustiveStep = {
    [Key in keyof StepByJsonId]: StepByJsonId[Key] & {jsonID: Key};
}[keyof StepByJsonId];
