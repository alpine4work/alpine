import {Tag, tagHighlighter, tags} from "@lezer/highlight";
import {Lazy} from "~/shared/helpers/control/lazy.js";

export type LezerClassHighlighterClass = (typeof lezerClassHighlighterClasses)[number];

/**
 * All the Lezer highlight classes we use.
 *
 * IMPORTANT: Do not change the order of items in this array!
 * `FileCodePreviewContent`'s binary format depends on the index of each class
 * staying the same. If you need to add a new class then add it to the end.
 */
export const lezerClassHighlighterClasses = [
    "tok-atom",
    "tok-bool",
    "tok-className",
    "tok-comment",
    "tok-controlKeyword",
    "tok-definition",
    "tok-deleted",
    "tok-emphasis",
    "tok-heading",
    "tok-inserted",
    "tok-invalid",
    "tok-keyword",
    "tok-labelName",
    "tok-link",
    "tok-literal",
    "tok-local",
    "tok-macroName",
    "tok-meta",
    "tok-moduleKeyword",
    "tok-namespace",
    "tok-number",
    "tok-operator",
    "tok-propertyName",
    "tok-punctuation",
    "tok-punctuation2",
    "tok-string",
    "tok-string2",
    "tok-strong",
    "tok-typeName",
    "tok-url",
    "tok-variableName",
    "tok-variableName2",
    "tok-monospace",
] as const;

// A modified version of [Lezer's own `classHighlighter`][1] which adds a couple
// class names.
//
// [1]:
//     https://github.com/lezer-parser/highlight/blob/33dd3f5d261283cfe7ce83101a6a6e7af010d918/src/highlight.ts#L683-L714
export const lezerClassHighlighter = new Lazy(() => {
    const ourTags: Array<{
        tag: Tag | Array<Tag>;
        class:
            | LezerClassHighlighterClass
            // Try to avoid more than two highlighter classes! `FileCodePreviewContent`'s
            // binary encoding assumes no more than 2 classes per highlight.
            | `${LezerClassHighlighterClass} ${LezerClassHighlighterClass}`;
    }> = [
        {tag: tags.link, class: "tok-link"},
        {tag: tags.heading, class: "tok-heading"},
        {tag: tags.emphasis, class: "tok-emphasis"},
        {tag: tags.strong, class: "tok-strong"},
        {tag: tags.monospace, class: "tok-monospace"},
        {tag: tags.keyword, class: "tok-keyword"},
        {tag: tags.atom, class: "tok-atom"},
        {tag: tags.bool, class: "tok-bool"},
        {tag: tags.url, class: "tok-url"},
        {tag: tags.labelName, class: "tok-labelName"},
        {tag: tags.inserted, class: "tok-inserted"},
        {tag: tags.deleted, class: "tok-deleted"},
        {tag: tags.literal, class: "tok-literal"},
        {tag: tags.string, class: "tok-string"},
        {tag: tags.number, class: "tok-number"},
        {tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2"},
        {tag: tags.variableName, class: "tok-variableName"},
        {tag: tags.local(tags.variableName), class: "tok-variableName tok-local"},
        {tag: tags.definition(tags.variableName), class: "tok-variableName tok-definition"},
        {tag: tags.special(tags.variableName), class: "tok-variableName2"},
        {tag: tags.definition(tags.propertyName), class: "tok-propertyName tok-definition"},
        {tag: tags.typeName, class: "tok-typeName"},
        {tag: tags.namespace, class: "tok-namespace"},
        {tag: tags.className, class: "tok-className"},
        {tag: tags.macroName, class: "tok-macroName"},
        {tag: tags.propertyName, class: "tok-propertyName"},
        {tag: tags.operator, class: "tok-operator"},
        {tag: tags.comment, class: "tok-comment"},
        {tag: tags.meta, class: "tok-meta"},
        {tag: tags.invalid, class: "tok-invalid"},
        {tag: tags.punctuation, class: "tok-punctuation"},
        {tag: tags.special(tags.punctuation), class: "tok-punctuation2"},

        // Changes from Lezer's original `classHighlighter`. There are some tags we want to
        // specifically target that aren't included in `lezerClassHighlighter`.
        {tag: tags.controlKeyword, class: "tok-keyword tok-controlKeyword"},
        {tag: tags.moduleKeyword, class: "tok-keyword tok-moduleKeyword"},
        {tag: tags.definition(tags.className), class: "tok-className tok-definition"},
    ];

    return tagHighlighter(ourTags);
});
