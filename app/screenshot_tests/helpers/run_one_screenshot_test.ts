import {
    getScreenshotTestPathFromName,
    loadScreenshotTestDefinition,
} from "~/app/screenshot_tests/helpers/load_screenshot_test_definition.js";
import {
    parseScreenshotTestMode,
    runScreenshotTests,
} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";

async function runOneScreenshotTest() {
    const screenshotTestName = process.argv[2];
    if (screenshotTestName === undefined) {
        throw new InvalidArgumentError("Expected screenshot test name as first argument");
    }

    const mode = parseScreenshotTestMode(process.argv[3]);
    const screenshotTestPath = getScreenshotTestPathFromName(screenshotTestName);
    const definition = await loadScreenshotTestDefinition(screenshotTestPath);

    await runScreenshotTests({mode, definitions: [definition]});
}

runOneScreenshotTest().then(
    () => {
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    },
);
