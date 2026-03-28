"use strict";

module.exports = {
    printWidth: 100,
    tabWidth: 4,
    trailingComma: "all",
    bracketSpacing: false,
    arrowParens: "avoid",
    proseWrap: "always",
    plugins: ["prettier-plugin-embed", "prettier-plugin-sql"],
    embeddedSqlTags: ["sql"],
    // Disable all other embedded language identifiers so only SQL
    // tagged templates are formatted by prettier-plugin-embed.
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
        // Use the HTML parser for Handlebars because it supports formatting
        // JavaScript, CSS, and ignores Handlebars partials.
        {
            files: "*.hbs",
            options: {parser: "html"},
        },
    ],
};
