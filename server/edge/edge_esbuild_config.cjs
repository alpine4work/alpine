"use strict";

const compilationMode = process.env.JS_BINARY__COMPILATION_MODE;
if (!compilationMode) throw new Error("Expected compilation mode env variable");

module.exports = {
    target: "node14",
    platform: "neutral",
    format: "esm",
    mainFields: ["browser", "module", "main"],
    conditions: ["worker"],
    define: {
        "process.env.NODE_ENV": JSON.stringify(
            compilationMode === "opt" ? "production" : "development",
        ),
    },
};
