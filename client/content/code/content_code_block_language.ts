import {StreamLanguage} from "@codemirror/language";
import {Parser} from "@lezer/common";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

type ContentCodeBlockLanguageDefinition = {
    readonly name: string;
    readonly aliases?: ReadonlyArray<string>;
    readonly loadParser: (() => Promise<Parser>) | null;
};

export type ContentCodeBlockLanguage = {
    readonly id: ContentCodeBlockLanguageId;
    readonly name: string;
    readonly aliases: ReadonlyArray<string>;
    readonly parser: {
        readonly getIfExists: () => Parser | null;
        readonly load: () => PromiseImmediate<Parser>;
    } | null;
};

/**
 * The definition for each language. For each language our code block supports,
 * we need to find a Lezer parser. We follow the following lookup process to
 * find a Lezer parser. If no parsers exist we can't support the language. It's
 * also fine to use a CodeMirror language since a CodeMirror language includes
 * a Lezer parser.
 *
 * 1. Check the [`@lezer` npm organization][1] for an official parser
 * 2. Check the [`@codemirror` npm organization][2] for an official parser
 * 3. Check the [`@replit` npm organization][3] for a trusted third-party parser
 * 4. Search the internet for a third-party Lezer parser
 * 5. Search the internet for a third-party CodeMirror language
 * 6. Check the [`@codemirror/language-data`][4] parser for any known supported
 *    languages, many supported languages are in the
 *    [`@codemirror/legacy-modes`][5] package which supports CodeMirror v5
 *    languages in CodeMirror v6
 *
 * This list of languages needs constant maintenance. Some ideas that'll help
 * maintain the list long term:
 *
 * - Write auto-updater code for parser packages
 * - Tell users the package we use for each parser, if they need to add new
 *   syntax they should file a pull request against that package
 *
 * Since we can't guarantee packages we depend on will be updated regularly,
 * maybe we create an open source repository with our language definitions that
 * automatically deploys to npm and anoint community members with the ability
 * to approve changes.
 *
 * [1]: https://www.npmjs.com/org/lezer
 * [2]: https://www.npmjs.com/org/codemirror
 * [3]: https://www.npmjs.com/org/replit
 * [4]: https://github.com/codemirror/language-data/blob/7b21009213b9fdb44d6ec172ad0a779234170f52/src/language-data.ts#L11-L12
 * [5]: https://www.npmjs.com/package/@codemirror/legacy-modes
 */
const contentCodeBlockLanguageDefinitionById: Record<
    ContentCodeBlockLanguageId,
    ContentCodeBlockLanguageDefinition
> = {
    text: {
        name: "Text",
        aliases: ["txt"],
        loadParser: null,
    },
    javascript: {
        name: "JavaScript",
        aliases: ["js", "jsx", "ECMAScript"],
        loadParser: async () => {
            // NOCOMMIT: Test that this parses JSX
            const {parser} = await import("@lezer/javascript");
            return parser.configure({dialect: "jsx"});
        },
    },
    html: {
        name: "HTML",
        loadParser: async () => {
            const {parser} = await import("@lezer/html");
            return parser;
        },
    },
    css: {
        name: "CSS",
        loadParser: async () => {
            const {parser} = await import("@lezer/css");
            return parser;
        },
    },
    sql: {
        name: "SQL",
        loadParser: async () => {
            // Use PostgreSQL dialect for SQL. PostgreSQL is currently the most popular
            // database (source: [2023 StackOverflow developer survey][1]) and many SQL
            // dialects are designed to be PostgreSQL compatible. e.g. CockroachDB's SQL
            // dialect and Snowflake's SQL dialect.
            //
            // [1]: https://survey.stackoverflow.co/2023/#most-popular-technologies-database-prof
            const {PostgreSQL} = await import("@codemirror/lang-sql");
            return PostgreSQL.language.parser;
        },
    },
    python: {
        name: "Python",
        aliases: ["py"],
        loadParser: async () => {
            const {parser} = await import("@lezer/python");
            return parser;
        },
    },
    typescript: {
        name: "TypeScript",
        aliases: ["ts", "tsx"],
        loadParser: async () => {
            // NOCOMMIT: Test that this parses JSX
            const {parser} = await import("@lezer/javascript");
            return parser.configure({dialect: "ts"});
        },
    },
    shell: {
        name: "Shell",
        aliases: ["Bash"],
        loadParser: async () => {
            // This package is trusted to be high quality since it's from a [company][1]
            // building an interactive terminal.
            //
            // [1]: https://github.com/withfig
            //
            // @ts-expect-error: `@fig/lezer-bash`'s types are improperly configured.
            const {parser} = await import("@fig/lezer-bash");
            return parser;
        },
    },
    java: {
        name: "Java",
        loadParser: async () => {
            const {parser} = await import("@lezer/java");
            return parser;
        },
    },
    json: {
        name: "JSON",
        loadParser: async () => {
            const {parser} = await import("@lezer/json");
            return parser;
        },
    },
    markdown: {
        name: "Markdown",
        aliases: ["md"],
        loadParser: async () => {
            const {parser} = await import("@lezer/markdown");
            return parser;
        },
    },
    csharp: {
        name: "C#",
        aliases: ["cs"],
        loadParser: async () => {
            const {parser} = await import("@replit/codemirror-lang-csharp");
            return parser;
        },
    },
    cpp: {
        name: "C++",
        aliases: ["cpp"],
        loadParser: async () => {
            const {parser} = await import("@lezer/cpp");
            return parser;
        },
    },
    c: {
        name: "C",
        loadParser: async () => {
            const {c} = await import("@codemirror/legacy-modes/mode/clike");
            return StreamLanguage.define(c).parser;
        },
    },
    php: {
        name: "PHP",
        loadParser: async () => {
            // @ts-expect-error: `@lezer/php`'s types are improperly configured.
            const {parser} = await import("@lezer/php");
            return parser;
        },
    },
    go: {
        name: "Go",
        loadParser: async () => {
            const {parser} = await import("@lezer/go");
            return parser;
        },
    },
    yaml: {
        name: "YAML",
        loadParser: async () => {
            const {parser} = await import("@lezer/yaml");
            return parser;
        },
    },
    powershell: {
        name: "PowerShell",
        loadParser: async () => {
            const {powerShell} = await import("@codemirror/legacy-modes/mode/powershell");
            return StreamLanguage.define(powerShell).parser;
        },
    },
    rust: {
        name: "Rust",
        aliases: ["rs"],
        loadParser: async () => {
            const {parser} = await import("@lezer/rust");
            return parser;
        },
    },
    kotlin: {
        name: "Kotlin",
        aliases: ["kt"],
        loadParser: async () => {
            const {kotlin} = await import("@codemirror/legacy-modes/mode/clike");
            return StreamLanguage.define(kotlin).parser;
        },
    },
    ruby: {
        name: "Ruby",
        aliases: ["rb"],
        loadParser: async () => {
            const {ruby} = await import("@codemirror/legacy-modes/mode/ruby");
            return StreamLanguage.define(ruby).parser;
        },
    },
    lua: {
        name: "Lua",
        loadParser: async () => {
            const {lua} = await import("@codemirror/legacy-modes/mode/lua");
            return StreamLanguage.define(lua).parser;
        },
    },
    xml: {
        name: "XML",
        loadParser: async () => {
            const {parser} = await import("@lezer/xml");
            return parser;
        },
    },
    dart: {
        name: "Dart",
        loadParser: async () => {
            const {dart} = await import("@codemirror/legacy-modes/mode/clike");
            return StreamLanguage.define(dart).parser;
        },
    },
    swift: {
        name: "Swift",
        loadParser: async () => {
            const {swift} = await import("@codemirror/legacy-modes/mode/swift");
            return StreamLanguage.define(swift).parser;
        },
    },
    assembly: {
        name: "Assembly",
        aliases: ["gas", "asm", "arm", "x86"],
        loadParser: async () => {
            const {gas} = await import("@codemirror/legacy-modes/mode/gas");
            return StreamLanguage.define(gas).parser;
        },
    },
    webassembly: {
        name: "WebAssembly",
        aliases: ["wasm"],
        loadParser: async () => {
            const {wastLanguage} = await import("@codemirror/lang-wast");
            return wastLanguage.parser;
        },
    },
    scala: {
        name: "Scala",
        loadParser: async () => {
            const {scala} = await import("@codemirror/legacy-modes/mode/clike");
            return StreamLanguage.define(scala).parser;
        },
    },
    r: {
        name: "R",
        loadParser: async () => {
            const {r} = await import("@codemirror/legacy-modes/mode/r");
            return StreamLanguage.define(r).parser;
        },
    },
    elixir: {
        name: "Elixir",
        aliases: ["ex"],
        loadParser: async () => {
            // This package is trusted to be high quality since it's from a [company][1]
            // building a collaborative code/notebook product which executes exclusively
            // Elixir.
            //
            // [1]: https://github.com/livebook-dev
            const {parser} = await import("lezer-elixir");
            return parser;
        },
    },
    objectivec: {
        name: "Objective-C",
        aliases: ["m"],
        loadParser: async () => {
            const {objectiveC} = await import("@codemirror/legacy-modes/mode/clike");
            return StreamLanguage.define(objectiveC).parser;
        },
    },
    perl: {
        name: "Perl",
        aliases: ["pl"],
        loadParser: async () => {
            const {perl} = await import("@codemirror/legacy-modes/mode/perl");
            return StreamLanguage.define(perl).parser;
        },
    },
    haskell: {
        name: "Haskell",
        aliases: ["hs"],
        loadParser: async () => {
            const {haskell} = await import("@codemirror/legacy-modes/mode/haskell");
            return StreamLanguage.define(haskell).parser;
        },
    },
    solidity: {
        name: "Solidity",
        aliases: ["sol"],
        loadParser: async () => {
            const {parser} = await import("@replit/codemirror-lang-solidity");
            return StreamLanguage.define(parser).parser;
        },
    },
    clojure: {
        name: "Clojure",
        aliases: ["clj", "Lisp"],
        loadParser: async () => {
            // This package is trusted to be high quality since it's from a [company][1]
            // building a notebook product where Clojure is one of the main languages. It
            // seems like this company does most of their development in Clojure.
            //
            // [1]: https://github.com/nextjournal
            //
            // @ts-expect-error: `@nextjournal/lezer-clojure`'s types are improperly configured.
            const {parser} = await import("@nextjournal/lezer-clojure");
            return parser;
        },
    },
    erlang: {
        name: "Erlang",
        aliases: ["erl"],
        loadParser: async () => {
            const {erlang} = await import("@codemirror/legacy-modes/mode/erlang");
            return StreamLanguage.define(erlang).parser;
        },
    },
    ocaml: {
        name: "OCaml",
        aliases: ["ml"],
        loadParser: async () => {
            const {oCaml} = await import("@codemirror/legacy-modes/mode/mllike");
            return StreamLanguage.define(oCaml).parser;
        },
    },
};

const nonReadonlyContentCodeBlockLanguages: Array<ContentCodeBlockLanguage> = [];

export const contentCodeBlockLanguages: ReadonlyArray<ContentCodeBlockLanguage> =
    nonReadonlyContentCodeBlockLanguages;

export const contentCodeBlockLanguageById: Readonly<
    Record<ContentCodeBlockLanguageId, ContentCodeBlockLanguage>
> = mapObjectValues(
    contentCodeBlockLanguageDefinitionById,
    ({name, aliases = [], loadParser}, id) => {
        let parserPromise: PromiseImmediate<Parser> | null = null;

        const language: ContentCodeBlockLanguage = {
            id,
            name,
            aliases,
            parser:
                loadParser !== null
                    ? {
                          getIfExists: () => {
                              return parserPromise?.getStateWithoutListening().value ?? null;
                          },
                          load: () => {
                              parserPromise ??= PromiseImmediate.resolve(loadParser());
                              return parserPromise;
                          },
                      }
                    : null,
        };

        nonReadonlyContentCodeBlockLanguages.push(language);

        return language;
    },
);
