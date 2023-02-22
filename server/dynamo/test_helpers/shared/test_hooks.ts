import {assert} from "~/shared/helpers/control/assert";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

/**
 * Test hooks that work across both Jest and Playwright.
 */
export const testHooks: {
    beforeAll: (action: () => Promise<void>) => void;
    afterAll: (action: () => Promise<void>) => void;
} = typeof jest !== "undefined" ? globalThis : require("@playwright/test").test;
