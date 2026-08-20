"use strict";

const noGlobalError = require("./no-global-error.js");
const noGlobalFetch = require("./no-global-fetch.js");
const noInternalImports = require("./no-internal-imports.js");
const noModelInitialData = require("./no-model-initial-data.js");
const noPrivateImportsInOpenSource = require("./no-private-imports-in-open-source.js");
const onlyErasableTypes = require("./only-erasable-types.js");
const sortImportsBySource = require("./sort-imports-by-source.js");
const stringQuotes = require("./string-quotes.js");

// Intentionally named "commitBlockers" instead of the natural camel case transform
// of the file name because we don't want this code to show up when doing a case
// insensitive project search for the commit blocker string.
const commitBlockers = require("./no-commit-blockers.js");

module.exports = {
    rules: {
        "no-commit-blockers": commitBlockers,
        "no-global-error": noGlobalError,
        "no-global-fetch": noGlobalFetch,
        "no-internal-imports": noInternalImports,
        "no-model-initial-data": noModelInitialData,
        "no-private-imports-in-open-source": noPrivateImportsInOpenSource,
        "only-erasable-types": onlyErasableTypes,
        "sort-imports-by-source": sortImportsBySource,
        "string-quotes": stringQuotes,
    },
};
