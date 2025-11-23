// https://github.com/Automattic/harper/blob/master/harper-wasm/src/lib.rs#L390
export type ContentSpellCheckSuggestionKind = "replace" | "remove" | "insertafter";

// Harper (our spell check engine) says:
//
// > We add new rules to Harper on a daily basis. As such, it is not
// > recommended for consumers of harper.js to rely on any rule to exist.
// > Further, consumers should allow space (in their UI, database, etc.) for
// > additional rules to be added whenever a new version of harper.js i
// > published.
//
// And `lint_kind.rs` says:
//
// > There's no reason not to add a new item here if you are adding a new rule
// > that doesn't fit the existing categories.
//
// So we treat this as a generic string with known categories at time of
// integration in `ContentSpellCheckLintKnownKind`.
//
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type ContentSpellCheckLintKind = ContentSpellCheckLintKnownKind | string;

// https://github.com/Automattic/harper/blob/master/harper-core/src/linting/lint_kind.rs
type ContentSpellCheckLintKnownKind =
    | "capitalization"
    | "enhancement"
    | "formatting"
    | "miscellaneous"
    | "punctuation"
    | "readability"
    | "redundancy"
    | "repetition"
    | "spelling"
    | "style"
    | "wordchoice";

export type ContentSpellCheckLintCategory =
    // blue squiggle
    | "grammar"
    // red squiggle
    | "spelling"
    // green squiggle
    | "formatting";

export const contentSpellCheckLintCategoryByKnownKind: Record<
    ContentSpellCheckLintKnownKind,
    ContentSpellCheckLintCategory
> = {
    capitalization: "formatting",
    enhancement: "grammar",
    formatting: "formatting",
    miscellaneous: "grammar",
    punctuation: "grammar",
    readability: "grammar",
    redundancy: "grammar",
    repetition: "grammar",
    spelling: "spelling",
    style: "formatting",
    wordchoice: "grammar",
};

export type ContentSpellCheckSuggestion = {
    readonly text: string;
    readonly kind: ContentSpellCheckSuggestionKind;
};

export type ContentSpellCheckLintKey = ReadonlyArray<never>;

export function generateContentSpellCheckLintKey(): ContentSpellCheckLintKey {
    // All that matters is the identity of the object.
    return [];
}

export type ContentSpellCheckLint = {
    /**
     * `key` is an identifier which won't change even if `from`/`to` are mapped
     * to different values. We can use this as a key to `WeakMap` which'll GC
     * anything related to the lint when the lint is no longer used.
     *
     * We could use a Symbol here, but Firefox does not support symbols as WeakMap keys.
     *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=1710433
     */
    readonly key: ContentSpellCheckLintKey;

    readonly from: number;
    readonly to: number;
    readonly kind: ContentSpellCheckLintKind;
    readonly category: ContentSpellCheckLintCategory;
    readonly suggestions: Array<ContentSpellCheckSuggestion>;
};
