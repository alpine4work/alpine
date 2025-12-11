import {assert} from "~/shared/helpers/control/assert.js";

// This file should only run in a Node.js development environment.
assert(process.release.name === "node");

// Only add our noop `react-refresh` globals in development/test environments
// when SWC compiles with the `react-refresh` transform.
if (process.env.NODE_ENV !== "production") {
    assert(!(globalThis as any).$RefreshReg$);
    assert(!(globalThis as any).$RefreshSig$);

    // Globals expected by the `react-refresh` transform applied by SWC.
    // `react-refresh` functions noop in tests.
    (globalThis as any).$RefreshReg$ = () => {};
    (globalThis as any).$RefreshSig$ = () => (value: unknown) => value;
}
