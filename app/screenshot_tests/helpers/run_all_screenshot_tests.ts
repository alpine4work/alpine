import {
    discoverScreenshotTestPaths,
    getScreenshotTestNameFromPath,
    getScreenshotTestPathFromName,
    loadScreenshotTestDefinition,
} from "~/app/screenshot_tests/helpers/load_screenshot_test_definition.js";
import {type ScreenshotTestDefinition} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {
    parseScreenshotTestMode,
    runScreenshotTests,
} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";

async function runAllScreenshotTests() {
    const mode = parseScreenshotTestMode(process.argv[2]);

    // Any additional positional arguments after the mode are read as a test-name
    // filter. `bazel run :preview` (no args) runs every discovered screenshot test;
    // `bazel run :preview -- sites search_modal` runs just those two and merges them
    // into one `preview.html` (the same `generateScreenshotTestPreviewHtml` helper
    // takes a list of names and produces one combined page).
    const filterNames = new Set(process.argv.slice(3));

    let screenshotTestPaths: Array<string>;
    if (filterNames.size > 0) {
        const discoveredPaths = await discoverScreenshotTestPaths();
        const discoveredNames = new Set(discoveredPaths.map(getScreenshotTestNameFromPath));
        for (const filterName of filterNames) {
            if (!discoveredNames.has(filterName)) {
                throw new InvalidArgumentError(
                    `No screenshot test named \`${filterName}\` exists. Existing names:\n` +
                        `  ${Array.from(discoveredNames).sort().join("\n  ")}`,
                );
            }
        }
        screenshotTestPaths = Array.from(mapIterable(filterNames, getScreenshotTestPathFromName));
    } else {
        screenshotTestPaths = await discoverScreenshotTestPaths();
    }

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
