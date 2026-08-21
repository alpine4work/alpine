import {appendOpenSourceCliPatchEntries} from "~/admin/open_source/internal/append_open_source_cli_patch_entries.js";
import {
    type OpenSourcePublicationManifest,
    collectOpenSourcePublicationManifestFromDeclaredSources,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";
import {archiveOpenSourcePublicationManifest} from "~/admin/open_source/internal/package_open_source_publication_manifest.js";
import {type OpenSourceArchiveContext} from "~/admin/open_source/internal/read_open_source_publication_context.js";
import {validateOpenSourcePublicationManifest} from "~/admin/open_source/internal/validate_open_source_publication_manifest.js";

/**
 * Builds the public archive from Bazel's declared tagged source inputs.
 *
 * The local result command only unpacks this archive. This function reads only the
 * paths Bazel passes in, so it cannot add an untracked or untagged file to the
 * ZIP.
 */
function packageOpenSourceRepositoryArchive({
    allowedBazelPackages,
    cliPatchListPath,
    cliPatchSources,
    inputSources,
    manifestOutputPath,
    outputArchivePath,
    stubDestinations,
    zipperPath,
}: OpenSourceArchiveContext): OpenSourcePublicationManifest {
    const manifest = appendOpenSourceCliPatchEntries({
        cliPatchListPath,
        cliPatchSources,
        manifest: collectOpenSourcePublicationManifestFromDeclaredSources({
            stubDestinations,
            sourceInputs: inputSources,
        }),
    });
    validateOpenSourcePublicationManifest({
        allowedBazelPackages,
        manifest,
        stubDestinations,
    });
    archiveOpenSourcePublicationManifest({
        archivePath: outputArchivePath,
        manifest,
        manifestOutputPath,
        zipperPath,
    });
    return manifest;
}

export {packageOpenSourceRepositoryArchive};
