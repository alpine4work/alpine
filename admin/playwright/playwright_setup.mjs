import {test} from "@playwright/test";

// Make the Playwright test module available globally for `test_shared_hooks.ts`.
globalThis.__playwrightTest = test;

// Globals expected by the `react-refresh` transform applied by SWC.
// `react-refresh` functions noop in tests.
globalThis.$RefreshReg$ = () => {};
globalThis.$RefreshSig$ = () => value => value;
