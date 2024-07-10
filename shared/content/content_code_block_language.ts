import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {Schema} from "~/shared/schema/schema.js";

export type ContentCodeBlockLanguageId = keyof typeof contentCodeBlockLanguageDefinitionById;

type ContentCodeBlockLanguageDefinition = {
    readonly name: string;
    readonly aliases?: ReadonlyArray<string>;
};

export type ContentCodeBlockLanguage = {
    readonly id: ContentCodeBlockLanguageId;
    readonly name: string;
    readonly aliases: ReadonlyArray<string>;
};

/**
 * Programming languages supported by our code block. The order languages
 * appear in this map is the order they'll appear in the code block's language
 * selector. Languages are roughly ordered by what [professional developers are
 * using according to the 2023 StackOverflow developer survey][1]. Ordering by
 * popularity means you can more quickly find the language you're looking for
 * as opposed to scrolling through an alphabetically sorted list of obscure
 * languages.
 *
 * [1]: https://survey.stackoverflow.co/2023/#most-popular-technologies-language-prof
 */
const contentCodeBlockLanguageDefinitionById = {
    text: {
        name: "Text",
        aliases: ["txt"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/javascript
    //
    // NOCOMMIT: Should include JSX
    javascript: {
        name: "JavaScript",
        aliases: ["js", "jsx", "ECMAScript"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/html
    html: {
        name: "HTML",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/css
    css: {
        name: "CSS",
    },
    // NOCOMMIT: We use the SnowSQL parser which is PostgreSQL-like
    // https://github.com/Snowflake-Labs/lezer-snowsql
    // https://discuss.codemirror.net/t/is-there-any-ongoing-work-on-lezer-parser-for-sql/3007
    //
    // or...
    //
    // https://www.npmjs.com/package/@codemirror/lang-sql
    //
    // (probably the latter)
    sql: {
        name: "SQL",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/python
    python: {
        name: "Python",
        aliases: ["py"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/javascript
    //
    // NOCOMMIT: Should include JSX
    typescript: {
        name: "TypeScript",
        aliases: ["ts", "tsx"],
    },
    // NOCOMMIT: Use this
    // https://github.com/withfig/lezer-bash
    //
    // ...or @codemirror/legacy-modes/mode/shell, evaluate
    //
    // What's the right name? `bash` or `shell`?
    shell: {
        name: "Shell",
        aliases: ["Bash"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/java
    java: {
        name: "Java",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/json
    json: {
        name: "JSON",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/markdown
    markdown: {
        name: "Markdown",
        aliases: ["md"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@replit/codemirror-lang-csharp
    csharp: {
        name: "C#",
        aliases: ["cs"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/cpp
    cpp: {
        name: "C++",
        aliases: ["cpp"],
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/cpp
    c: {
        name: "C",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/php
    php: {
        name: "PHP",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/go
    go: {
        name: "Go",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/yaml
    yaml: {
        name: "YAML",
    },
    // NOCOMMIT: @codemirror/legacy-modes/mode/powershell???
    powershell: {
        name: "PowerShell",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/rust
    rust: {
        name: "Rust",
        aliases: ["rs"],
    },
    // NOCOMMIT: @codemirror/legacy-modes/mode/clike there's an `kotlin` option
    kotlin: {
        name: "Kotlin",
        aliases: ["kt"],
    },
    // NOCOMMIT: @codemirror/legacy-modes/mode/ruby
    ruby: {
        name: "Ruby",
        aliases: ["rb"],
    },
    // NOCOMMIT: @codemirror/legacy-modes/mode/lua
    lua: {
        name: "Lua",
    },
    // NOCOMMIT: https://www.npmjs.com/package/@lezer/xml
    xml: {
        name: "XML",
    },
    // NOCOMMIT: @codemirror/legacy-modes/mode/clike has a `dart` option
    dart: {
        name: "Dart",
    },
    // NOCOMMIT: "swift",
    // NOCOMMIT: @codemirror/legacy-modes/mode/gas
    assembly: {
        name: "Assembly",
        aliases: ["gas", "asm", "arm", "x86"],
    },
    // NOCOMMIT: ???
    webassembly: {
        name: "WebAssembly",
        aliases: ["wasm"],
    },

    // NOCOMMIT: "scala",
    // NOCOMMIT: "r",
    // NOCOMMIT: "elixir",
    // NOCOMMIT: "objectivec",
    // NOCOMMIT: "perl",
    // NOCOMMIT: "haskell",
    // NOCOMMIT: "solidity",
    // NOCOMMIT: "clojure",
    // NOCOMMIT: "lisp",
    // NOCOMMIT: "erlang",
    // NOCOMMIT: "ocaml",
} satisfies {
    readonly [id: string]: ContentCodeBlockLanguageDefinition;
};

const nonReadonlyContentCodeBlockLanguageIds: Array<ContentCodeBlockLanguageId> = [];
const nonReadonlyContentCodeBlockLanguages: Array<ContentCodeBlockLanguage> = [];

export const contentCodeBlockLanguageIds: ReadonlyArray<ContentCodeBlockLanguageId> =
    nonReadonlyContentCodeBlockLanguageIds;

export const contentCodeBlockLanguages: ReadonlyArray<ContentCodeBlockLanguage> =
    nonReadonlyContentCodeBlockLanguages;

export const contentCodeBlockLanguageById: Readonly<
    Record<ContentCodeBlockLanguageId, ContentCodeBlockLanguage>
> = mapObjectValues(
    contentCodeBlockLanguageDefinitionById,
    (languageDefinition: ContentCodeBlockLanguageDefinition, id) => {
        const language: ContentCodeBlockLanguage = {
            id,
            name: languageDefinition.name,
            aliases: languageDefinition.aliases ?? [],
        };

        nonReadonlyContentCodeBlockLanguageIds.push(id);
        nonReadonlyContentCodeBlockLanguages.push(language);

        return language;
    },
);

export const ContentCodeBlockLanguageIdSchema = Schema.enum(nonReadonlyContentCodeBlockLanguageIds);
