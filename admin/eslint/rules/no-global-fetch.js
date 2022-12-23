"use strict";

module.exports = {
    meta: {
        schema: [],
        messages: {
            noGlobalFetch:
                "Instead of using global `fetch()` use fetch with instrumentation from `~/shared/tracer/fetch_with_tracer`.",
        },
    },

    create(context) {
        return {
            CallExpression(node) {
                if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
                    context.report({
                        node: node.callee,
                        messageId: "noGlobalFetch",
                    });
                }
            },
        };
    },
};
