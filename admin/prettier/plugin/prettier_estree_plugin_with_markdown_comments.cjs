"use strict";

function requireFromMainAsBackup(string) {
    try {
        return require(string);
    } catch (error) {
        try {
            // Resolve through Prettier's main module so this plugin works from Bazel runfiles
            // where relative resolution from this file is not reliable.
            return require.main.require(string);
        } catch {
            // Throw original error if both failed.
        }
        throw error;
    }
}

const prettier = requireFromMainAsBackup("prettier");
const estreePlugin = requireFromMainAsBackup("prettier/plugins/estree");
const {hardline, join} = prettier.doc.builders;

const markdownCommentLinesSymbol = Symbol("markdownCommentLines");
const markdownCommentAppendBlankLineAfterSymbol = Symbol("markdownCommentAppendBlankLineAfter");
const markdownSkippedCommentsSymbol = Symbol("markdownSkippedComments");

module.exports = {
    printers: {
        estree: {
            ...estreePlugin.printers.estree,
            async preprocess(ast, options) {
                const preprocessedAst = estreePlugin.printers.estree.preprocess
                    ? await estreePlugin.printers.estree.preprocess(ast, options)
                    : ast;
                return preprocessMarkdownComments(preprocessedAst, options);
            },
            printComment(path, options) {
                return printMarkdownComment(
                    path,
                    options,
                    estreePlugin.printers.estree.printComment,
                );
            },
        },
    },
};

function getCommentStart(options, comment) {
    return options.locStart ? options.locStart(comment) : comment.start;
}

function getCommentEnd(options, comment) {
    return options.locEnd ? options.locEnd(comment) : comment.end;
}

function getCommentSource(options, comment) {
    const start = getCommentStart(options, comment);
    const end = getCommentEnd(options, comment);
    return options.originalText.slice(start, end);
}

function isLineComment(commentSource) {
    return commentSource.startsWith("//") && !commentSource.startsWith("///");
}

function isMarkdownBlockComment(commentSource) {
    return commentSource.startsWith("/**") || commentSource.startsWith("/*!");
}

function isDirectiveLineComment(commentSource) {
    const lineText = commentSource.slice(2).trimStart();
    return /^(prettier-ignore|eslint-|@ts-|tslint:|istanbul ignore|c8 ignore|type-coverage:ignore|flowlint|biome-ignore|rome-ignore|deno-lint-ignore)/u.test(
        lineText,
    );
}

function isConsecutiveLineComment(options, previousComment, nextComment) {
    const betweenCommentStarts = options.originalText.slice(
        getCommentStart(options, previousComment),
        getCommentStart(options, nextComment),
    );
    const lineBreaksBetweenCommentStarts = betweenCommentStarts.match(/\r\n|\r|\n/gu)?.length ?? 0;
    if (lineBreaksBetweenCommentStarts !== 1) {
        return false;
    }

    const betweenText = options.originalText.slice(
        getCommentEnd(options, previousComment),
        getCommentStart(options, nextComment),
    );
    return /^[ \t]*(?:\r?\n)?[ \t]*$/.test(betweenText);
}

function hasBlankLineAfterComment(options, comment) {
    const afterCommentText = options.originalText.slice(getCommentEnd(options, comment));
    return /^[ \t]*(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/u.test(afterCommentText);
}

function markdownFromLineCommentBlock(options, comments) {
    return comments
        .map(comment => {
            const commentSource = getCommentSource(options, comment);
            const lineText = commentSource.slice(2);
            return lineText.startsWith(" ") ? lineText.slice(1) : lineText;
        })
        .join("\n");
}

function markdownFromJSDocComment(commentSource) {
    const commentContent = commentSource.slice(3, -2);
    const rawLines = commentContent.split(/\r?\n/u);
    const markdownLines = rawLines.map((rawLine, index) => {
        if (rawLines.length === 1 && index === 0) {
            return rawLine.trim();
        }
        return rawLine.replace(/^\s*\* ?/u, "");
    });

    while (markdownLines.length > 0 && markdownLines[0].trim() === "") {
        markdownLines.shift();
    }

    while (markdownLines.length > 0 && markdownLines[markdownLines.length - 1].trim() === "") {
        markdownLines.pop();
    }

    return markdownLines.join("\n");
}

async function formatMarkdownComment(markdownSource, options) {
    if (markdownSource.trim() === "") {
        return [];
    }

    let formattedMarkdown = await prettier.format(markdownSource, {
        parser: "markdown",
        printWidth: 80,
        tabWidth: 4,
        trailingComma: "all",
        bracketSpacing: false,
        arrowParens: "avoid",
        proseWrap: "always",
        endOfLine: options.endOfLine,
    });

    // Remove trailing newline.
    formattedMarkdown = formattedMarkdown.replace(/\r?\n$/u, "");

    return formattedMarkdown.split(/\r?\n/u);
}

function lineCommentLinesFromMarkdown(markdownLines) {
    return markdownLines.map(markdownLine =>
        markdownLine.length === 0 ? "//" : `// ${markdownLine}`,
    );
}

function jsdocCommentLinesFromMarkdown(commentSource, markdownLines) {
    const opening = commentSource.startsWith("/*!") ? "/*!" : "/**";
    const isOriginalSingleLine = !/\r?\n/u.test(commentSource);
    const singleLineJSDoc = markdownLines.length === 1 && `${opening} ${markdownLines[0]} */`;
    if (
        isOriginalSingleLine &&
        singleLineJSDoc &&
        markdownLines[0].length > 0 &&
        !markdownLines[0].includes("*/") &&
        singleLineJSDoc.length <= 80
    ) {
        return [singleLineJSDoc];
    }

    if (markdownLines.length === 0) {
        return [`${opening} */`];
    }

    return [
        opening,
        ...markdownLines.map(markdownLine =>
            markdownLine.length === 0 ? " *" : ` * ${markdownLine}`,
        ),
        " */",
    ];
}

function removeSkippedCommentsFromAst(ast, skippedComments) {
    const visitedNodes = new WeakSet();
    removeSkippedCommentsFromAstNode({
        node: ast,
        skippedComments,
        visitedNodes,
    });
}

function removeSkippedCommentsFromAstNode({node, skippedComments, visitedNodes}) {
    if (!node || typeof node !== "object") {
        return;
    }
    if (visitedNodes.has(node)) {
        return;
    }
    visitedNodes.add(node);

    if (Array.isArray(node)) {
        for (const arrayItem of node) {
            removeSkippedCommentsFromAstNode({
                node: arrayItem,
                skippedComments,
                visitedNodes,
            });
        }
        return;
    }

    if (Array.isArray(node.comments)) {
        node.comments = node.comments.filter(comment => !skippedComments.has(comment));
    }

    for (const nodeValue of Object.values(node)) {
        removeSkippedCommentsFromAstNode({
            node: nodeValue,
            skippedComments,
            visitedNodes,
        });
    }
}

async function preprocessMarkdownComments(ast, options) {
    const comments = options[Symbol.for("comments")] ?? ast.comments ?? [];
    const printedComments = options[Symbol.for("printedComments")];
    const markdownCommentLinesByComment = new WeakMap();
    const markdownCommentAppendBlankLineAfter = new WeakSet();
    const skippedComments = new WeakSet();
    const commentsInOrder = [...comments].sort(
        (leftComment, rightComment) =>
            getCommentStart(options, leftComment) - getCommentStart(options, rightComment),
    );

    for (let commentIndex = 0; commentIndex < commentsInOrder.length; ) {
        const currentComment = commentsInOrder[commentIndex];
        const commentSource = getCommentSource(options, currentComment);

        if (isLineComment(commentSource)) {
            const lineCommentBlock = [currentComment];
            commentIndex += 1;

            while (commentIndex < commentsInOrder.length) {
                const nextComment = commentsInOrder[commentIndex];
                const nextCommentSource = getCommentSource(options, nextComment);
                if (!isLineComment(nextCommentSource)) {
                    break;
                }
                if (
                    !isConsecutiveLineComment(
                        options,
                        lineCommentBlock[lineCommentBlock.length - 1],
                        nextComment,
                    )
                ) {
                    break;
                }
                lineCommentBlock.push(nextComment);
                commentIndex += 1;
            }

            if (
                lineCommentBlock.some(lineComment =>
                    isDirectiveLineComment(getCommentSource(options, lineComment)),
                )
            ) {
                continue;
            }

            const markdownSource = markdownFromLineCommentBlock(options, lineCommentBlock);
            let markdownLines = await formatMarkdownComment(markdownSource, options);
            if (markdownLines.length === 0) {
                markdownLines = [""];
            }
            const anchorComment = lineCommentBlock[0];
            const lastCommentInBlock = lineCommentBlock[lineCommentBlock.length - 1];
            markdownCommentLinesByComment.set(
                anchorComment,
                lineCommentLinesFromMarkdown(markdownLines),
            );
            if (
                lineCommentBlock.length > 1 &&
                hasBlankLineAfterComment(options, lastCommentInBlock)
            ) {
                markdownCommentAppendBlankLineAfter.add(anchorComment);
            }

            for (
                let lineCommentIndex = 1;
                lineCommentIndex < lineCommentBlock.length;
                lineCommentIndex += 1
            ) {
                const groupedComment = lineCommentBlock[lineCommentIndex];
                skippedComments.add(groupedComment);
                groupedComment.leading = false;
                groupedComment.trailing = false;
                groupedComment.printed = true;
                if (printedComments) {
                    printedComments.add(groupedComment);
                }
            }

            continue;
        }

        if (isMarkdownBlockComment(commentSource)) {
            const markdownSource = markdownFromJSDocComment(commentSource);
            const markdownLines = await formatMarkdownComment(markdownSource, options);
            markdownCommentLinesByComment.set(
                currentComment,
                jsdocCommentLinesFromMarkdown(commentSource, markdownLines),
            );
        }

        commentIndex += 1;
    }

    removeSkippedCommentsFromAst(ast, skippedComments);
    options[markdownCommentLinesSymbol] = markdownCommentLinesByComment;
    options[markdownCommentAppendBlankLineAfterSymbol] = markdownCommentAppendBlankLineAfter;
    options[markdownSkippedCommentsSymbol] = skippedComments;
    return ast;
}

function printMarkdownComment(path, options, printComment) {
    const comment = path.node;
    if (options[markdownSkippedCommentsSymbol]?.has(comment)) {
        return "";
    }

    const markdownCommentLines = options[markdownCommentLinesSymbol]?.get(comment);
    if (markdownCommentLines) {
        const markdownCommentDoc = join(hardline, markdownCommentLines);
        if (options[markdownCommentAppendBlankLineAfterSymbol]?.has(comment)) {
            return [markdownCommentDoc, hardline];
        }
        return markdownCommentDoc;
    }

    return printComment(path, options);
}
