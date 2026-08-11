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
    // Let prettier-plugin-embed handle only SQL. Empty arrays let Prettier keep its
    // native formatting for tags such as `markdown` and `html`. GLSL formatting needs
    // prettier-plugin-glsl, which this project does not use.
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
