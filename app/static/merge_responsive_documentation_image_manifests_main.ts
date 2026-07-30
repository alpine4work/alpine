import fs from "fs/promises";
import {join, relative, resolve} from "path";
import {mergeResponsiveDocumentationImageManifests} from "~/app/static/merge_responsive_documentation_image_manifests.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/** Merge per-source responsive documentation image manifest fragments. */
async function main() {
    const [outputPath, ...inputPaths] = process.argv.slice(2);
    const bazelPackageDirectoryPath = join(
        assertExists(process.env.BAZEL_BINDIR),
        assertExists(process.env.BAZEL_PACKAGE),
    );
    const values = await runAllPromises(
        inputPaths.map(async inputPath => {
            const resolvedInputPath = resolve(
                process.cwd(),
                relative(bazelPackageDirectoryPath, inputPath),
            );
            return JSON.parse(await fs.readFile(resolvedInputPath, "utf8")) as unknown;
        }),
    );
    await fs.writeFile(
        assertExists(outputPath, "Expected responsive documentation image manifest output path"),
        `${JSON.stringify(mergeResponsiveDocumentationImageManifests(values), null, 2)}\n`,
    );
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
