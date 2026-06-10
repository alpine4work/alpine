import fs from "fs/promises";
import {basename, join as joinPath} from "path";
import {fileURLToPath, pathToFileURL} from "url";
import {type ScreenshotTestDefinition} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";

const screenshotTestNamePattern = /^[a-z0-9_]+$/;
const screenshotTestFileSuffix = "_screenshot_test.js";

export function getScreenshotTestsDirectoryPath(): string {
    return fileURLToPath(new URL("..", import.meta.url));
}

export function getScreenshotTestPathFromName(screenshotTestName: string): string {
    if (!screenshotTestNamePattern.test(screenshotTestName)) {
        throw new InvalidArgumentError(quote`Invalid screenshot test name: ${screenshotTestName}`);
    }

    return joinPath(
        getScreenshotTestsDirectoryPath(),
        `${screenshotTestName}${screenshotTestFileSuffix}`,
    );
}

export function getScreenshotTestNameFromPath(screenshotTestPath: string): string {
    const screenshotTestFileName = basename(screenshotTestPath);
    if (!screenshotTestFileName.endsWith(screenshotTestFileSuffix)) {
        throw new InvalidArgumentError(
            quote`Invalid screenshot test file name: ${screenshotTestFileName}`,
        );
    }

    return screenshotTestFileName.slice(0, -screenshotTestFileSuffix.length);
}

export async function discoverScreenshotTestPaths(): Promise<Array<string>> {
    const screenshotTestsDirectoryPath = getScreenshotTestsDirectoryPath();
    const directoryEntries = await fs.readdir(screenshotTestsDirectoryPath, {
        withFileTypes: true,
    });

    return directoryEntries
        .filter(
            entry =>
                (entry.isFile() || entry.isSymbolicLink()) &&
                entry.name.endsWith(screenshotTestFileSuffix) &&
                !entry.name.startsWith("_"),
        )
        .map(entry => joinPath(screenshotTestsDirectoryPath, entry.name))
        .sort((screenshotTestPathA, screenshotTestPathB) =>
            getScreenshotTestNameFromPath(screenshotTestPathA).localeCompare(
                getScreenshotTestNameFromPath(screenshotTestPathB),
            ),
        );
}

export async function loadScreenshotTestDefinition(
    screenshotTestPath: string,
): Promise<ScreenshotTestDefinition> {
    const screenshotTestModule = (await import(pathToFileURL(screenshotTestPath).href)) as {
        run?: unknown;
    };

    if (typeof screenshotTestModule.run !== "function") {
        throw new InvalidArgumentError(
            `Screenshot test must export \`run\`: ${basename(screenshotTestPath)}`,
        );
    }

    return {
        testName: getScreenshotTestNameFromPath(screenshotTestPath),
        run: screenshotTestModule.run as ScreenshotTestDefinition["run"],
    };
}
