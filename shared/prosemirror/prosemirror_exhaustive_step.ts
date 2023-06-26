import {
    AddMarkStep,
    AddNodeMarkStep,
    AttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
} from "prosemirror-transform";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

/**
 * `Step`s have a `jsonID` property used when serializing to/from JSON. This
 * type is a union of all known step class with their `jsonID` to allow for
 * exhaustive switching.
 */
export type ExhaustiveStep =
    | (AttrStep & {jsonID: "attr"})
    | (AddMarkStep & {jsonID: "addMark"})
    | (RemoveMarkStep & {jsonID: "removeMark"})
    | (AddNodeMarkStep & {jsonID: "addNodeMark"})
    | (RemoveNodeMarkStep & {jsonID: "removeNodeMark"})
    | (ReplaceStep & {jsonID: "replace"})
    | (ReplaceAroundStep & {jsonID: "replaceAround"})
    | (RemoveAllMarksStep & {jsonID: "removeAllMarks"})
    | (AddMarksAfterRemoveAllStep & {jsonID: "addMarksAfterRemoveAll"});
