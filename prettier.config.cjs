"use strict";

module.exports = {
    printWidth: 100,
    tabWidth: 4,
    trailingComma: "all",
    bracketSpacing: false,
    arrowParens: "avoid",
    proseWrap: "always",
    overrides: [
        // Use the HTML parser for Handlebars because it supports formatting
        // JavaScript, CSS, and ignores Handlebars partials.
        {
            files: "*.hbs",
            options: {parser: "html"},
        },
    ],
};
