import {
    discoverScreenshotTestPaths,
    loadScreenshotTestDefinition,
} from "~/app/screenshot_tests/helpers/load_screenshot_test_definition.js";
import {type ScreenshotTestDefinition} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {
    parseScreenshotTestMode,
    runScreenshotTests,
} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";

async function runAllScreenshotTests() {
    const mode = parseScreenshotTestMode(process.argv[2]);
    const screenshotTestPaths = await discoverScreenshotTestPaths();
    const definitions: Array<ScreenshotTestDefinition> = [];

    for (const screenshotTestPath of screenshotTestPaths) {
        definitions.push(await loadScreenshotTestDefinition(screenshotTestPath));
    }

    await runScreenshotTests({mode, definitions});
}

runAllScreenshotTests().then(
    () => {
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    },
);
