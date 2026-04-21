/* eslint-disable cyberworlds/string-quotes */

"use strict";

function createProperQuoteMessage(properQuote, replacedQuote) {
    return `Use the proper quotation mark \`${properQuote}\` here instead of a straight quotation mark (\`${replacedQuote}\`). To make sure we use proper quotation marks in the UI we require all strings to use proper quotation marks.`;
}

function createUseHtmlEntityMessage(codePoint) {
    return `Use the HTML entity \`&#x${codePoint};\` instead of \`\\u${codePoint}\` in JSX. Unicode escapes are not interpreted in JSX and will render literally.`;
}

function createUseUnicodeEscapeMessage(codePoint) {
    return `Use the Unicode escape \`\\u${codePoint}\` instead of \`&#x${codePoint};\` in strings. HTML entities are not interpreted in JavaScript strings and will render literally.`;
}

module.exports = {
    meta: {
        schema: [],
        fixable: "code",
        messages: {
            "useProperQuote:\\u201C": createProperQuoteMessage("\\u201C", '"'),
            "useProperQuote:\\u201D": createProperQuoteMessage("\\u201D", '"'),
            "useProperQuote:\\u2018": createProperQuoteMessage("\\u2018", "'"),
            "useProperQuote:\\u2019": createProperQuoteMessage("\\u2019", "'"),
            "useJsxProperQuote:&#x201C;": createProperQuoteMessage("&#x201C;", '"'),
            "useJsxProperQuote:&#x201D;": createProperQuoteMessage("&#x201D;", '"'),
            "useJsxProperQuote:&#x2018;": createProperQuoteMessage("&#x2018;", "'"),
            "useJsxProperQuote:&#x2019;": createProperQuoteMessage("&#x2019;", "'"),
            "useHtmlEntity:\\u201C": createUseHtmlEntityMessage("201C"),
            "useHtmlEntity:\\u201D": createUseHtmlEntityMessage("201D"),
            "useHtmlEntity:\\u2018": createUseHtmlEntityMessage("2018"),
            "useHtmlEntity:\\u2019": createUseHtmlEntityMessage("2019"),
            "useUnicodeEscape:&#x201C;": createUseUnicodeEscapeMessage("201C"),
            "useUnicodeEscape:&#x201D;": createUseUnicodeEscapeMessage("201D"),
            "useUnicodeEscape:&#x2018;": createUseUnicodeEscapeMessage("2018"),
            "useUnicodeEscape:&#x2019;": createUseUnicodeEscapeMessage("2019"),
        },
    },

    create(context) {
        const sourceCode = context.getSourceCode();

        /**
         * Reports straight quotes that should be curly quotes, using Unicode escapes.
         * Also reports HTML entities that should be Unicode escapes.
         * Used for regular strings and template literals.
         */
        function reportStringStraightQuotes(nodeStart, text) {
            const matches = text.matchAll(/["']/g);
            let ignoreNextMatch = false;

            for (const match of matches) {
                if (ignoreNextMatch) {
                    ignoreNextMatch = false;
                    continue;
                }

                const start = nodeStart + match.index;
                const end = start + 1;

                const {properQuote, charBefore} = parse(text, match.index);

                // If the character immediately before the quote is an `=` then we assume the
                // developer is writing an HTML attribute (e.g. `<mark class="highlight-red">`).
                // Don't warn for this quote or the next quote.
                if (charBefore === "=") {
                    ignoreNextMatch = true;
                    continue;
                }

                context.report({
                    loc: {
                        start: sourceCode.getLocFromIndex(start),
                        end: sourceCode.getLocFromIndex(end),
                    },
                    messageId: `useProperQuote:${properQuote}`,
                    fix: fixer => fixer.replaceTextRange([start, end], properQuote),
                });
            }
        }

        /**
         * Reports HTML entities that should be Unicode escapes.
         * Used for regular strings and template literals.
         */
        function reportStringHtmlEntities(nodeStart, text) {
            const entityMatches = text.matchAll(/&#x(201C|201D|2018|2019);/gi);

            for (const match of entityMatches) {
                const start = nodeStart + match.index;
                const end = start + match[0].length;
                const codePoint = match[1].toUpperCase();
                const unicodeEscape = `\\u${codePoint}`;
                const htmlEntity = `&#x${codePoint};`;

                context.report({
                    loc: {
                        start: sourceCode.getLocFromIndex(start),
                        end: sourceCode.getLocFromIndex(end),
                    },
                    messageId: `useUnicodeEscape:${htmlEntity}`,
                    fix: fixer => fixer.replaceTextRange([start, end], unicodeEscape),
                });
            }
        }

        /**
         * Reports straight quotes that should be curly quotes, using HTML entities.
         * Used for JSX text and JSX attribute strings.
         */
        function reportJsxStraightQuotes(nodeStart, text) {
            const quoteMatches = text.matchAll(/["']/g);

            for (const match of quoteMatches) {
                const start = nodeStart + match.index;
                const end = start + 1;

                const {properQuote} = parse(text, match.index);
                const properHtmlEntity = `&#x${properQuote.slice(2)};`;

                context.report({
                    loc: {
                        start: sourceCode.getLocFromIndex(start),
                        end: sourceCode.getLocFromIndex(end),
                    },
                    messageId: `useJsxProperQuote:${properHtmlEntity}`,
                    fix: fixer => fixer.replaceTextRange([start, end], properHtmlEntity),
                });
            }
        }

        /**
         * Reports Unicode escapes that should be HTML entities.
         * Used for JSX text and JSX attribute strings.
         */
        function reportJsxUnicodeEscapes(nodeStart, text) {
            const escapeMatches = text.matchAll(/\\u(201C|201D|2018|2019)/g);

            for (const match of escapeMatches) {
                const start = nodeStart + match.index;
                const end = start + match[0].length;
                const codePoint = match[1];
                const htmlEntity = `&#x${codePoint};`;

                context.report({
                    loc: {
                        start: sourceCode.getLocFromIndex(start),
                        end: sourceCode.getLocFromIndex(end),
                    },
                    messageId: `useHtmlEntity:\\u${codePoint}`,
                    fix: fixer => fixer.replaceTextRange([start, end], htmlEntity),
                });
            }
        }

        return {
            Literal(node) {
                if (typeof node.value !== "string") return;

                const nodeStart = node.range[0] + 1;
                const text = node.raw.slice(1, -1);

                // JSX attribute strings should use HTML entities instead of Unicode escapes,
                // just like JSX text.
                if (node.parent.type === "JSXAttribute") {
                    reportJsxStraightQuotes(nodeStart, text);
                    reportJsxUnicodeEscapes(nodeStart, text);
                    return;
                }

                reportStringStraightQuotes(nodeStart, text);
                reportStringHtmlEntities(nodeStart, text);
            },
            TemplateElement(node) {
                // Skip template literals tagged with `sql`. SQL syntax requires
                // straight quotes (e.g. string literals like `'foo'`) and must
                // not be rewritten to curly quotes.
                const templateLiteral = node.parent;
                if (
                    templateLiteral &&
                    templateLiteral.type === "TemplateLiteral" &&
                    templateLiteral.parent &&
                    templateLiteral.parent.type === "TaggedTemplateExpression" &&
                    templateLiteral.parent.quasi === templateLiteral &&
                    templateLiteral.parent.tag.type === "Identifier" &&
                    templateLiteral.parent.tag.name === "sql"
                ) {
                    return;
                }

                const nodeStart = node.range[0] + 1;
                const text = node.value.raw;

                reportStringStraightQuotes(nodeStart, text);
                reportStringHtmlEntities(nodeStart, text);
            },
            JSXText(node) {
                const nodeStart = node.range[0];
                const text = node.raw;

                reportJsxStraightQuotes(nodeStart, text);
                reportJsxUnicodeEscapes(nodeStart, text);
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
            properQuote = "\\u201C";
        } else {
            properQuote = "\\u201D";
        }
    } else {
        if (charBefore !== null && /\p{White_Space}/u.test(charBefore)) {
            properQuote = "\\u2018";
        } else {
            properQuote = "\\u2019";
        }
    }

    return {
        properQuote,
        charBefore,
        charAfter,
    };
}
