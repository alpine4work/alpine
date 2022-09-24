"use strict";

module.exports = {
    meta: {
        schema: [],
        messages: {
            newGlobalError:
                "Instead of using `new Error()` use a class from `~/shared/error/error`.",
        },
    },

    create(context) {
        return {
            NewExpression(node) {
                if (node.callee.type === "Identifier" && node.callee.name === "Error") {
                    context.report({
                        node: node.callee,
                        messageId: "newGlobalError",
                    });
                }
            },
        };
    },
};
