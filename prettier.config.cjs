"use strict";

module.exports = {
    // NOTE: Prettier resolves the `estree` printer from a single plugin, so our
    // markdown comments plugin and `prettier-plugin-embed` (SQL tagged template
    // formatting) can't both be listed directly. The `_and_embed` plugin merges the
    // two printers — they override disjoint printer methods.
    plugins: [
        require.resolve("./admin/prettier/plugin/prettier_estree_plugin_with_markdown_comments_and_embed.mjs"),
        "prettier-plugin-sql",
    ],
    printWidth: 100,
    tabWidth: 4,
    trailingComma: "all",
    bracketSpacing: false,
    arrowParens: "avoid",
    proseWrap: "always",
    embeddedSqlTags: ["sql"],
    // Disable all other embedded language identifiers so only SQL tagged templates are
    // formatted by prettier-plugin-embed.
    embeddedMarkdownTags: [],
    embeddedCssTags: [],
    embeddedGlslTags: [],
    embeddedGraphqlTags: [],
    embeddedHtmlTags: [],
    embeddedJsonTags: [],
    embeddedLatexTags: [],
    embeddedPhpTags: [],
    embeddedRubyTags: [],
    embeddedTsTags: [],
    embeddedXmlTags: [],
    embeddedYamlTags: [],
    language: "sqlite",
    keywordCase: "upper",
    dataTypeCase: "upper",
    functionCase: "upper",
    overrides: [
        // Use the HTML parser for Handlebars because it supports formatting JavaScript,
        // CSS, and ignores Handlebars partials.
        {
            files: "*.hbs",
            options: {parser: "html"},
        },
    ],
};
