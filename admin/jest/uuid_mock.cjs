"use strict";

// Mock for the `uuid` package. The `uuid` package ships an ESM-only browser build
// which `jest-environment-jsdom` resolves by default, causing a `SyntaxError`
// since Jest loads it as CommonJS.
//
// The only transitive consumer is `@giphy/js-util` which calls `uuid.v4()` for
// pingback IDs. A deterministic stub is fine in tests.

let counter = 0;

module.exports = {
    v4() {
        counter++;
        return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
};
