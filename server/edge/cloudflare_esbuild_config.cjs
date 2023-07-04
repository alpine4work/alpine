"use strict";

module.exports = {
    target: "node14",
    platform: "neutral",
    format: "esm",
    mainFields: ["browser", "module", "main"],
    conditions: ["worker"],
};
