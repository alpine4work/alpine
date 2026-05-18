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

function createUseUnicodeEscapeForCurlyQuoteMessage(codePoint) {
    return `Use the Unicode escape \`\\u${codePoint}\` instead of a raw curly quotation mark in strings.`;
}

function createUseHtmlEntityForCurlyQuoteMessage(codePoint) {
    return `Use the HTML entity \`&#x${codePoint};\` instead of a raw curly quotation mark in JSX.`;
}

function createUseStraightQuoteInCommentMessage(straightQuote) {
    return `Use a straight quotation mark \`${straightQuote}\` in comments instead of a curly quotation mark or quote escape.`;
}

const curlyQuoteCodePoints = new Map([
    ["\u201C", "201C"],
    ["\u201D", "201D"],
    ["\u2018", "2018"],
    ["\u2019", "2019"],
]);

const straightQuotesByCodePoint = new Map([
    ["201C", '"'],
    ["201D", '"'],
    ["2018", "'"],
    ["2019", "'"],
]);

const codePointsByDecimalHtmlEntity = new Map([
    ["8220", "201C"],
    ["8221", "201D"],
    ["8216", "2018"],
    ["8217", "2019"],
]);

const codePointsByNamedHtmlEntity = new Map([
    ["ldquo", "201C"],
    ["rdquo", "201D"],
    ["lsquo", "2018"],
    ["rsquo", "2019"],
]);

const stringQuoteReferences = /[\u201C\u201D\u2018\u2019]|["']|&#x(201C|201D|2018|2019);/giu;
const jsxQuoteReferences = /[\u201C\u201D\u2018\u2019]|["']|\\u(201C|201D|2018|2019)/giu;
const commentCurlyQuoteReferences =
    /[\u201C\u201D\u2018\u2019]|\\u(?:\{(201C|201D|2018|2019)\}|(201C|201D|2018|2019))|&#x(201C|201D|2018|2019);|&#(8216|8217|8220|8221);|&(ldquo|rdquo|lsquo|rsquo);/giu;

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
            "useUnicodeEscapeForCurlyQuote:\\u201C":
                createUseUnicodeEscapeForCurlyQuoteMessage("201C"),
            "useUnicodeEscapeForCurlyQuote:\\u201D":
                createUseUnicodeEscapeForCurlyQuoteMessage("201D"),
            "useUnicodeEscapeForCurlyQuote:\\u2018":
                createUseUnicodeEscapeForCurlyQuoteMessage("2018"),
            "useUnicodeEscapeForCurlyQuote:\\u2019":
                createUseUnicodeEscapeForCurlyQuoteMessage("2019"),
            "useHtmlEntityForCurlyQuote:&#x201C;": createUseHtmlEntityForCurlyQuoteMessage("201C"),
            "useHtmlEntityForCurlyQuote:&#x201D;": createUseHtmlEntityForCurlyQuoteMessage("201D"),
            "useHtmlEntityForCurlyQuote:&#x2018;": createUseHtmlEntityForCurlyQuoteMessage("2018"),
            "useHtmlEntityForCurlyQuote:&#x2019;": createUseHtmlEntityForCurlyQuoteMessage("2019"),
            useStraightDoubleQuoteInComment: createUseStraightQuoteInCommentMessage('"'),
            useStraightSingleQuoteInComment: createUseStraightQuoteInCommentMessage("'"),
        },
    },

    create(context) {
        const sourceCode = context.getSourceCode();

        function reportStringQuoteReferences(nodeStart, text, state = {ignoreNextMatch: false}) {
            const matches = text.matchAll(stringQuoteReferences);

            for (const match of matches) {
                const quoteReference = match[0];
                const start = nodeStart + match.index;
                const end = start + quoteReference.length;
                const curlyQuoteCodePoint = curlyQuoteCodePoints.get(quoteReference);

                if (curlyQuoteCodePoint !== undefined) {
                    const unicodeEscape = `\\u${curlyQuoteCodePoint}`;

                    context.report({
                        loc: {
                            start: sourceCode.getLocFromIndex(start),
                            end: sourceCode.getLocFromIndex(end),
                        },
                        messageId: `useUnicodeEscapeForCurlyQuote:${unicodeEscape}`,
                        fix: fixer => fixer.replaceTextRange([start, end], unicodeEscape),
                    });
                    continue;
                }

                if (match[1] !== undefined) {
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
                    continue;
                }

                if (state.ignoreNextMatch) {
                    state.ignoreNextMatch = false;
                    continue;
                }

                const {properQuote, charBefore} = parse(text, match.index);

                // If the character immediately before the quote is an `=` then we assume the
                // developer is writing an HTML attribute (e.g. `<mark class="highlight-red">`).
                // Don't warn for this quote or the next quote.
                if (charBefore === "=") {
                    state.ignoreNextMatch = true;
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

        function reportJsxQuoteReferences(nodeStart, text) {
            const matches = text.matchAll(jsxQuoteReferences);

            for (const match of matches) {
                const quoteReference = match[0];
                const start = nodeStart + match.index;
                const end = start + quoteReference.length;
                const curlyQuoteCodePoint = curlyQuoteCodePoints.get(quoteReference);

                if (curlyQuoteCodePoint !== undefined) {
                    const htmlEntity = `&#x${curlyQuoteCodePoint};`;

                    context.report({
                        loc: {
                            start: sourceCode.getLocFromIndex(start),
                            end: sourceCode.getLocFromIndex(end),
                        },
                        messageId: `useHtmlEntityForCurlyQuote:${htmlEntity}`,
                        fix: fixer => fixer.replaceTextRange([start, end], htmlEntity),
                    });
                    continue;
                }

                if (match[1] !== undefined) {
                    const codePoint = match[1].toUpperCase();
                    const htmlEntity = `&#x${codePoint};`;

                    context.report({
                        loc: {
                            start: sourceCode.getLocFromIndex(start),
                            end: sourceCode.getLocFromIndex(end),
                        },
                        messageId: `useHtmlEntity:\\u${codePoint}`,
                        fix: fixer => fixer.replaceTextRange([start, end], htmlEntity),
                    });
                    continue;
                }

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
         * Reports raw curly quote characters and curly quote escapes in comments. Comments
         * should use regular straight quotes instead.
         */
        function reportCommentCurlyQuoteReferences(comment) {
            const commentStart = comment.range[0] + 2;
            const matches = comment.value.matchAll(commentCurlyQuoteReferences);

            for (const match of matches) {
                const start = commentStart + match.index;
                const end = start + match[0].length;
                const codePoint = getCommentCurlyQuoteCodePoint(match[0]);
                const straightQuote = getStraightQuoteForCodePoint(codePoint);
                const messageId =
                    straightQuote === '"'
                        ? "useStraightDoubleQuoteInComment"
                        : "useStraightSingleQuoteInComment";

                context.report({
                    loc: {
                        start: sourceCode.getLocFromIndex(start),
                        end: sourceCode.getLocFromIndex(end),
                    },
                    messageId,
                    fix: fixer => fixer.replaceTextRange([start, end], straightQuote),
                });
            }
        }

        return {
            Program() {
                for (const comment of sourceCode.getAllComments()) {
                    reportCommentCurlyQuoteReferences(comment);
                }
            },
            Literal(node) {
                if (typeof node.value !== "string") return;

                const nodeStart = node.range[0] + 1;
                const text = node.raw.slice(1, -1);

                // JSX attribute strings should use HTML entities instead of Unicode escapes, just
                // like JSX text.
                if (node.parent.type === "JSXAttribute") {
                    reportJsxQuoteReferences(nodeStart, text);
                    return;
                }

                reportStringQuoteReferences(nodeStart, text);
            },
            TemplateLiteral(node) {
                const state = {ignoreNextMatch: false};

                for (const quasi of node.quasis) {
                    const nodeStart = quasi.range[0] + 1;
                    const text = quasi.value.raw;

                    reportStringQuoteReferences(nodeStart, text, state);
                }
            },
            JSXText(node) {
                const nodeStart = node.range[0];
                const text = node.raw;

                reportJsxQuoteReferences(nodeStart, text);
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

function getStraightQuoteForCodePoint(codePoint) {
    const straightQuote = straightQuotesByCodePoint.get(codePoint);

    if (straightQuote === undefined) {
        throw new Error(`Unexpected curly quote code point ${codePoint}`);
    }

    return straightQuote;
}

function getCommentCurlyQuoteCodePoint(quoteReference) {
    const curlyQuoteCodePoint = curlyQuoteCodePoints.get(quoteReference);
    if (curlyQuoteCodePoint !== undefined) return curlyQuoteCodePoint;

    const unicodeEscapeMatch = /^\\u(?:\{(201C|201D|2018|2019)\}|(201C|201D|2018|2019))$/i.exec(
        quoteReference,
    );
    if (unicodeEscapeMatch !== null) {
        return (unicodeEscapeMatch[1] ?? unicodeEscapeMatch[2]).toUpperCase();
    }

    const hexHtmlEntityMatch = /^&#x(201C|201D|2018|2019);$/i.exec(quoteReference);
    if (hexHtmlEntityMatch !== null) {
        return hexHtmlEntityMatch[1].toUpperCase();
    }

    const decimalHtmlEntityMatch = /^&#(8216|8217|8220|8221);$/.exec(quoteReference);
    if (decimalHtmlEntityMatch !== null) {
        return codePointsByDecimalHtmlEntity.get(decimalHtmlEntityMatch[1]);
    }

    const namedHtmlEntityMatch = /^&(ldquo|rdquo|lsquo|rsquo);$/i.exec(quoteReference);
    if (namedHtmlEntityMatch !== null) {
        return codePointsByNamedHtmlEntity.get(namedHtmlEntityMatch[1].toLowerCase());
    }

    throw new Error(`Unexpected curly quote reference ${quoteReference}`);
}
