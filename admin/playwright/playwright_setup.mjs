import {test} from "@playwright/test";

// Make the Playwright test module available globally for `test_shared_hooks.ts`.
globalThis.__playwrightTest = test;
