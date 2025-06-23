"use strict";

// We concat "NO" and "COMMIT" here so that if a developer does a text search
// for the string they only find instances of the string they themselves added.
// They won't find this file.
//
// eslint-disable-next-line no-useless-concat
const commitBlocker = "NO" + "COMMIT";

module.exports = {
    meta: {
        schema: [],
        messages: {
            commitBlocker: `Must remove all \`${commitBlocker}\` instances before committing`,
        },
    },

    create(context) {
        const sourceCode = context.sourceCode.getText();

        const regExp = new RegExp(commitBlocker, "g");

        const matches = sourceCode.matchAll(regExp);

        for (const match of matches) {
            context.report({
                loc: {
                    start: context.sourceCode.getLocFromIndex(match.index),
                    end: context.sourceCode.getLocFromIndex(match.index + match[0].length),
                },
                messageId: "commitBlocker",
            });
        }

        return {};
    },
};
