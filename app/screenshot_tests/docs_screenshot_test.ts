import {type TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";

export async function run(_context: TestActualContext, runner: ScreenshotTestRunner) {
    await runner.goto(null, "/docs");
    await runner.screenshot("a0", "home");

    await runner.goto(null, "/docs/api");
    await runner.screenshot("a1", "api-home");

    await runner.goto(null, "/docs/api/post/posts");
    await runner.screenshot("a2", "api-post-posts");

    await runner.goto(null, "/docs/api/schemas/AccountId");
    await runner.screenshot("a3", "api-schema-account-id");
}
