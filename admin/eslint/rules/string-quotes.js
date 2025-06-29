/* eslint-disable string-quotes */

"use strict";

module.exports = {
    meta: {
        schema: [],
        fixable: "code",
        messages: {
            useProperQuotes:
                "Use proper quotation marks (`“`, `”`, `‘`, `’`) instead of straight quotation marks (`'`, `\"`) in strings. To make sure we use proper quotation marks in the UI we require all strings to use proper quotation marks.",
        },
    },

    create(context) {
        const sourceCode = context.getSourceCode();

        return {
            Literal(node) {
                if (typeof node.value === "string") {
                    const nodeStart = node.range[0] + 1;
                    const text = node.raw.slice(1, -1);
                    const matches = text.matchAll(/["']/g);

                    for (const match of matches) {
                        const start = nodeStart + match.index;
                        const end = start + 1;

                        const {properQuote} = parse(text, match.index);

                        context.report({
                            loc: {
                                start: sourceCode.getLocFromIndex(start),
                                end: sourceCode.getLocFromIndex(end),
                            },
                            messageId: "useProperQuotes",
                            fix: fixer => fixer.replaceTextRange([start, end], properQuote),
                        });
                    }
                }
            },
            TemplateElement(node) {
                const nodeStart = node.range[0] + 1;
                const text = node.value.raw;
                const matches = text.matchAll(/["']/g);

                for (const match of matches) {
                    const start = nodeStart + match.index;
                    const end = start + 1;

                    const {properQuote} = parse(text, match.index);

                    context.report({
                        loc: {
                            start: sourceCode.getLocFromIndex(start),
                            end: sourceCode.getLocFromIndex(end),
                        },
                        messageId: "useProperQuotes",
                        fix: fixer => fixer.replaceTextRange([start, end], properQuote),
                    });
                }
            },
            JSXText(node) {
                const nodeStart = node.range[0];
                const text = node.raw;
                const matches = text.matchAll(/["']/g);

                for (const match of matches) {
                    const start = nodeStart + match.index;
                    const end = start + 1;

                    const {properQuote} = parse(text, match.index);

                    context.report({
                        loc: {
                            start: sourceCode.getLocFromIndex(start),
                            end: sourceCode.getLocFromIndex(end),
                        },
                        messageId: "useProperQuotes",
                        fix: fixer => fixer.replaceTextRange([start, end], properQuote),
                    });
                }
            },
        };
    },
};

function parse(text, index) {
    const quoteChar = text[index];

    let charBefore = null;
    let charAfter = null;

    for (let i = index + 1; i < text.length; i++) {
        const char = text[i];

        if (charAfter === null) {
            charAfter = char;
            break;
        }
    }

    for (let i = index - 1; i >= 0; i--) {
        const char = text[i];

        if (charBefore === null) {
            charBefore = char;
            break;
        }
    }

    let properQuote;

    if (quoteChar === '"') {
        if (charBefore !== null && /\p{White_Space}/u.test(charBefore)) {
            properQuote = "“";
        } else {
            properQuote = "”";
        }
    } else {
        if (charBefore !== null && /\p{White_Space}/u.test(charBefore)) {
            properQuote = "‘";
        } else {
            properQuote = "’";
        }
    }

    return {
        properQuote,
        charBefore,
        charAfter,
    };
}
