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
 * The local result command only unpacks this archive. Keeping publication here
 * ensures the archive action never discovers untracked or untagged filesystem
 * files.
 */
function packageOpenSourceRepositoryArchive({
    allowedBazelPackages,
    inputSources,
    manifestOutputPath,
    outputArchivePath,
    stubDestinations,
    zipperPath,
}: OpenSourceArchiveContext): OpenSourcePublicationManifest {
    const manifest = collectOpenSourcePublicationManifestFromDeclaredSources({
        stubDestinations,
        sourceInputs: inputSources,
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
