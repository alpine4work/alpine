import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

/**
 * Test hooks that work across both Jest and Playwright.
 */
export const testSharedHooks: {
    beforeAll: (action: () => MaybePromise<void>, timeout?: number) => void;
    afterAll: (action: () => MaybePromise<void>, timeout?: number) => void;
    beforeEach: (action: () => MaybePromise<void>, timeout?: number) => void;
    afterEach: (action: () => MaybePromise<void>, timeout?: number) => void;
} = import.meta.jest
    ? globalThis
    : // Set by `playwright_setup.mjs`
      assertExists((globalThis as any).__playwrightTest);
