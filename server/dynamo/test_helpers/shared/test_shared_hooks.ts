import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

/**
 * Test hooks that work across both Jest and Playwright.
 */
export const testSharedHooks: {
    beforeAll: (action: () => Promise<void>) => void;
    afterAll: (action: () => Promise<void>) => void;
    beforeEach: (action: () => Promise<void>) => void;
    afterEach: (action: () => Promise<void>) => void;
} = import.meta.jest
    ? globalThis
    : // Set by `playwright_setup.mjs`
      assertExists((globalThis as any).__playwrightTest);
