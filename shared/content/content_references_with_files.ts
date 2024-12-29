import {
    ContentReferences,
    ContentReferencesSchema,
    emptyContentReferences,
    isEmptyContentReferences,
    mergeContentReferences,
} from "~/shared/content/content_references.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type ContentReferencesWithFiles = SchemaType<typeof ContentReferencesWithFilesSchema>;

/**
 * Documents may have content which needs data beyond what the base content
 * type needs.
 */
export const ContentReferencesWithFilesSchema = ContentReferencesSchema.merge(
    Schema.object({
        /**
         * Files attached to the content.
         *
         * Also includes the search part of the preview URL we'll need to render in
         * `signedUrlSearch`. We only include the search part since the path and
         * domain can be easily generated on the client so might as well save some
         * bytes over the network. The path pattern is `/files/:spaceId/:fileId`.
         * You won't find a Remix route for this path since it's handled by
         * `EdgeService`.
         */
        fileById: Schema.map(
            Schema.id<FileId>(),
            Schema.object({
                signedUrlSearch: Schema.string,
                file: FileModel.schema,
            }),
        ),
    }),
);

export const emptyContentReferencesWithFiles: ContentReferencesWithFiles = {
    ...emptyContentReferences,
    fileById: new Map(),
};

export function isEmptyContentReferencesWithFiles(references: ContentReferencesWithFiles): boolean {
    // If you add more data to `ContentReferencesWithFiles` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<
        Exclude<keyof ContentReferencesWithFiles, keyof ContentReferences>,
        "fileById"
    >();

    return isEmptyContentReferences(references) && references.fileById.size === 0;
}

export function mergeContentReferencesWithFiles(
    references1: ContentReferencesWithFiles,
    references2: ContentReferencesWithFiles,
): ContentReferencesWithFiles {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyContentReferencesWithFiles(references1)) return references2;
    if (isEmptyContentReferencesWithFiles(references2)) return references1;

    const referencesBase = mergeContentReferences(references1, references2);

    return {
        ...referencesBase,
        fileById: mergeContentReferencesFileById(references1.fileById, references2.fileById),
    };
}

function mergeContentReferencesFileById(
    fileById1: ContentReferencesWithFiles["fileById"],
    fileById2: ContentReferencesWithFiles["fileById"],
): ContentReferencesWithFiles["fileById"] {
    let newFileById: Map<FileId, {signedUrlSearch: string; file: FileModel}> | undefined;

    // Merge files together...
    //
    // Prefer `existingFileReference` in `FileModel.minLoadingCount()` to avoid
    // unnecessary re-renders. Pick the `signedUrlSearch` that expires later.
    for (const [fileId2, file2] of fileById2) {
        const fileReference1 = fileById1.get(fileId2);

        const newFileReference = {
            signedUrlSearch: fileReference1
                ? mergeContentReferencesFileSignedUrlSearches(
                      fileReference1.signedUrlSearch,
                      file2.signedUrlSearch,
                  )
                : file2.signedUrlSearch,
            file: fileReference1
                ? FileModel.minLoadingCount(fileReference1.file, file2.file)
                : file2.file,
        };

        if (
            !fileReference1 ||
            newFileReference.signedUrlSearch !== fileReference1.signedUrlSearch ||
            newFileReference.file !== fileReference1.file
        ) {
            newFileById ??= new Map(fileById1);
            newFileById.set(fileId2, newFileReference);
        }
    }

    // If there's nothing new in `fileById2` then `newFileById` won't have been
    // initialized.
    return newFileById ?? fileById1;
}

export function getContentReferencesFileSignedUrlSearchExpirationTime(
    signedUrlSearch: string,
): number {
    const searchParams = new URLSearchParams(signedUrlSearch.split("?", 2)[1]);
    const expirationTime = parseInt(searchParams.get("exp") ?? "", 10);
    assert(Number.isInteger(expirationTime));
    return expirationTime * 1000;
}

export function mergeContentReferencesFileSignedUrlSearches(
    oldSignedUrlSearch: string,
    newSignedUrlSearch: string,
): string {
    const oldExpirationTime =
        getContentReferencesFileSignedUrlSearchExpirationTime(oldSignedUrlSearch);
    const newExpirationTime =
        getContentReferencesFileSignedUrlSearchExpirationTime(newSignedUrlSearch);

    if (oldExpirationTime >= newExpirationTime) return oldSignedUrlSearch;

    // If the new signed URL search has an expiration time less than an hour after
    // our old expiration time then keep our old URL. This is because every time we
    // update the URL the browser needs to fetch the image from our server. We
    // don't want to refetch the image (which'll show the image loading placeholder
    // to the user) if the expiration time hasn't been extended by much.
    //
    // Our URL signatures expire after 24 hours so it's basically unnoticeable if
    // we only accept new URLs that expire at least an hour after our old URL.
    if (newExpirationTime - oldExpirationTime < 1000 * 60 * 60) return oldSignedUrlSearch;

    return newSignedUrlSearch;
}
