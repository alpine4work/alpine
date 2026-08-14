import {fileContentTypeByCodeBlockLanguageId} from "~/shared/files/file_content_type.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

export type ContentCodeBlockLanguageId = (typeof contentCodeBlockLanguageIds)[number];

/**
 * Programming languages supported by our code block. The order languages appear in
 * this array is the order they'll appear in the code block's language selector.
 * Languages are roughly ordered by what [professional developers are using
 * according to the 2023 StackOverflow developer survey][1]. Ordering by popularity
 * means you can more quickly find the language you're looking for as opposed to
 * scrolling through an alphabetically sorted list of obscure languages.
 *
 * IMPORTANT: All code block languages must correspond to a name in
 * [`linguist/lib/linguist/languages.yml`][2] for the language (either the main
 * name or an alias). That way when we print content to Markdown, the code block
 * can be parsed and syntax highlighted in GitHub.
 *
 * [1]:
 *     https://survey.stackoverflow.co/2023/#most-popular-technologies-language-prof
 * [2]:
 *     https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml
 */
export const contentCodeBlockLanguageIds = [
    "text",
    "javascript",
    "html",
    "css",
    "sql",
    "python",
    "typescript",
    "shell",
    "java",
    "json",
    "markdown",
    "csharp",
    "cpp",
    "c",
    "php",
    "go",
    "yaml",
    "powershell",
    "rust",
    "kotlin",
    "ruby",
    "lua",
    "xml",
    "dart",
    "swift",
    "assembly",
    "webassembly",
    "scala",
    "r",
    "elixir",
    "objectivec",
    "perl",
    "haskell",
    "solidity",
    "clojure",
    "erlang",
    "ocaml",
] as const;

const contentCodeBlockLanguageIdSet = new Set(contentCodeBlockLanguageIds);

export function isContentCodeBlockLanguageId(string: string): string is ContentCodeBlockLanguageId {
    return contentCodeBlockLanguageIdSet.has(string as any);
}

// Make sure there are no duplicates.
assert(contentCodeBlockLanguageIds.length === contentCodeBlockLanguageIdSet.size);

export const ContentCodeBlockLanguageIdSchema = Schema.enum(contentCodeBlockLanguageIdSet);

// Make sure we have a `FileContentType` for all of our supported
// `ContentCodeBlockLanguageId`s.
assertEqualTypes<ContentCodeBlockLanguageId, keyof typeof fileContentTypeByCodeBlockLanguageId>();
