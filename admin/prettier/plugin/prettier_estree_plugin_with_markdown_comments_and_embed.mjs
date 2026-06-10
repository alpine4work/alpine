// Composes our markdown comments plugin with `prettier-plugin-embed`.
//
// Prettier resolves the `estree` printer from a single plugin — two plugins that
// both define it can't be used together directly. Luckily the two customizations
// touch disjoint printer methods: the markdown comments plugin overrides
// `preprocess` + `printComment` while `prettier-plugin-embed` overrides `embed`
// (to format `sql`-tagged template literals via `prettier-plugin-sql`). This
// wrapper merges them into one printer.
//
// This file is ESM (`.mjs`) because `prettier-plugin-embed` is ESM-only.
import {createRequire} from "node:module";
import {
    options as embedOptions,
    parsers as embedParsers,
    printers as embedPrinters,
} from "prettier-plugin-embed";

const require = createRequire(import.meta.url);
const markdownCommentsPlugin = require("./prettier_estree_plugin_with_markdown_comments.cjs");

export const options = embedOptions;
export const parsers = embedParsers;

export const printers = {
    estree: {
        // `prettier-plugin-embed` spreads the builtin estree printer and adds its own
        // `embed`.
        ...embedPrinters.estree,
        // The markdown comments plugin spreads the builtin estree printer and wraps
        // `preprocess` and `printComment`.
        preprocess: markdownCommentsPlugin.printers.estree.preprocess,
        printComment: markdownCommentsPlugin.printers.estree.printComment,
    },
};
