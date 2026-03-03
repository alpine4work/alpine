"use strict";

module.exports = {
    plugins: [
        require.resolve("./admin/prettier/plugin/prettier_estree_plugin_with_markdown_comments.cjs"),
    ],
    printWidth: 100,
    tabWidth: 4,
    trailingComma: "all",
    bracketSpacing: false,
    arrowParens: "avoid",
    proseWrap: "always",
    overrides: [
        // Use the HTML parser for Handlebars because it supports formatting JavaScript,
        // CSS, and ignores Handlebars partials.
        {
            files: "*.hbs",
            options: {parser: "html"},
        },
    ],
};
