"use strict";

// NOTE(calebmer): It would appear that when upgrading to Node.js v20 there is now
// a read-only global `performance` property. Reassign the property but make it
// writable so `jest.useFakeTimers()` can override it.
const performance = globalThis.performance;
Object.defineProperty(globalThis, "performance", {value: performance, writable: true});
