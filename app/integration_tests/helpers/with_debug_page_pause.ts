import {Page} from "@playwright/test";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

/**
 * If you're debugging an integration test, wrap your test body in this. When
 * running with `--headed` it'll always pause the test once it completes whether
 * the test errors or completes normally.
 *
 * If the test errors then the error will be logged before pausing.
 *
 * Requires a `CommitBlocker` string since you shouldn't commit this function call.
 * Once you're done debugging a test, remove the call. Normally there's an ESLint
 * warning when you call `page.pause()` but since this function calls it for you we
 * ask for `CommitBlocker` so there will be an ESLint warning for you on that
 * string.
 *
 * I (@calebmer) like to write integration tests from scratch with this. I write a
 * bit of the test, then run to make sure it works, maybe use Playwright's record
 * feature while the browser is paused, and repeat.
 */
export async function withDebugPagePause<Value>(
    commitBlocker: CommitBlocker,
    page: Page,
    action: () => Promise<Value>,
) {
    try {
        const value = await action();
        return value;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        throw error;
    } finally {
        // eslint-disable-next-line playwright/no-page-pause
        await page.pause();
    }
}
