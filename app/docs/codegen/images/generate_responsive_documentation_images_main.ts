import fs from "fs/promises";
import {join, relative, resolve} from "path";
import {generateResponsiveDocumentationImage} from "~/app/docs/codegen/images/generate_responsive_documentation_image.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const documentationImageUrlPrefixes = ["/api/", "/blog/", "/docs/"] as const;

/** Generate one responsive documentation image tree and manifest fragment. */
async function main() {
    const [
        sourceExecPath,
        sourceUrl,
        outputDirectoryPath,
        outputRelativePath,
        outputUrlBase,
        outputManifestPath,
        isAuthorImageValue,
    ] = process.argv.slice(2);
    assert(sourceExecPath !== undefined, "Expected documentation image source path");
    assert(sourceUrl !== undefined, "Expected documentation image source URL");
    assert(outputDirectoryPath !== undefined, "Expected documentation image output directory");
    assert(outputRelativePath !== undefined, "Expected documentation image output path");
    assert(outputUrlBase !== undefined, "Expected documentation image output URL");
    assert(outputManifestPath !== undefined, "Expected documentation image manifest path");
    assert(
        isAuthorImageValue === "true" || isAuthorImageValue === "false",
        "Expected documentation author image flag",
    );
    assert(
        documentationImageUrlPrefixes.some(prefix => sourceUrl.startsWith(prefix)),
        `Unexpected documentation image URL: ${sourceUrl}`,
    );

    const bazelPackageDirectoryPath = join(
        assertExists(process.env.BAZEL_BINDIR),
        assertExists(process.env.BAZEL_PACKAGE),
    );
    const sourcePath = resolve(process.cwd(), relative(bazelPackageDirectoryPath, sourceExecPath));

    await fs.rm(outputDirectoryPath, {recursive: true, force: true});
    const image = await generateResponsiveDocumentationImage({
        sourcePath,
        sourceUrl,
        outputDirectoryPath,
        outputRelativePath,
        outputUrlBase,
        isAuthorImage: isAuthorImageValue === "true",
        copyStableSource: false,
    });
    await fs.writeFile(
        outputManifestPath,
        `${JSON.stringify({imageBySource: {[sourceUrl]: image}}, null, 2)}\n`,
    );
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
