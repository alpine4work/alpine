import inspector from "inspector";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

// Same as `TEST_DEBUGGER_INSPECTOR_PORT` in `.env.development`. We inline it here
// since env files aren't always available in the runfiles for this helper.
const testDebuggerInspectorPort = 3039;

/**
 * Open an inspector port and wait for a debugger client to attach. Will throw an
 * error if you're not running in a test environment. You must pass in the commit
 * blocker string so you get an ESLint warning that prevents you from committing
 * this function call.
 *
 * To use this function go to chrome://inspect and make sure you've added
 * http://localhost:3039 to your "Discover network targets" list. Then call this
 * function where you want to start debugging.
 *
 * We recommend using `bazel run` to run your test when debugging instead of
 * `bazel test` or `dev test`. Since `bazel test` (which is used by `dev test`)
 * will time out and kill your debugging process.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function waitForTestDebugger(commitBlocker: CommitBlocker) {
    assert(process.env.NODE_ENV === "test");

    inspector.open(testDebuggerInspectorPort, undefined, true);

    // eslint-disable-next-line no-debugger
    debugger;
}
