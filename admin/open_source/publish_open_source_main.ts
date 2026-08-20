import {readOpenSourceArchiveContext} from "~/admin/open_source/internal/read_open_source_publication_context.js";
import {packageOpenSourceRepositoryArchive} from "~/admin/open_source/publish_open_source.js";

/** Runs Bazel's hermetic public archive action. */
function main() {
    try {
        const context = readOpenSourceArchiveContext({});
        const manifest = packageOpenSourceRepositoryArchive(context);
        process.stdout.write(
            `Packaged ${manifest.entries.length} files in ${context.outputArchivePath}.\n`,
        );
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
        );
        process.exitCode = 1;
    }
}

main();
