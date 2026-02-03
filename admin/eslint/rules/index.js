"use strict";

const noCommitBlockers = require("./no-commit-blockers.js");
const noGlobalError = require("./no-global-error.js");
const noGlobalFetch = require("./no-global-fetch.js");
const noInternalImports = require("./no-internal-imports.js");
const onlyErasableTypes = require("./only-erasable-types.js");
const sortImportsBySource = require("./sort-imports-by-source.js");
const stringQuotes = require("./string-quotes.js");

module.exports = {
    rules: {
        "no-commit-blockers": noCommitBlockers,
        "no-global-error": noGlobalError,
        "no-global-fetch": noGlobalFetch,
        "no-internal-imports": noInternalImports,
        "only-erasable-types": onlyErasableTypes,
        "sort-imports-by-source": sortImportsBySource,
        "string-quotes": stringQuotes,
    },
};
