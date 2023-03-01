import {
    AddMarkStep,
    AddNodeMarkStep,
    AttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
} from "prosemirror-transform";

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
    | (ReplaceAroundStep & {jsonID: "replaceAround"});
