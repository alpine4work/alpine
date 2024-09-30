import {Node} from "prosemirror-model";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {ContentMentionAccountId, FileId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type ContentReferences = SchemaType<typeof ContentReferencesSchema>;

/**
 * Data referenced by content that doesn't live inside the content.
 *
 * For example, mentions store an `AccountId` in the content but don't store
 * the associated account name and avatar. Since a user could update their
 * account name and we don't want to then go update all content. So instead, we
 * load account data in this references object.
 */
export const ContentReferencesSchema = Schema.object({
    /**
     * Accounts referenced in mentions.
     */
    accountById: Schema.map(Schema.id<ContentMentionAccountId>(), AccountModel.schema),

    /**
     * Files attached to the content.
     *
     * Also includes the search part of the preview URL we'll need to render in
     * `previewUrlSearch`. We only include the search part since the path and
     * domain can be easily generated on the client so might as well save some
     * bytes over the network. The path pattern is `/files/:spaceId/:fileId`.
     * You won't find a Remix route for this path since it's handled by
     * `EdgeService`.
     */
    // TODO(calebmer, #files): Right now files are only allowed in document content
    // but eventually all content will need to support files. Which is why we have
    // it here even if that's a little premature.
    fileById: Schema.map(
        Schema.id<FileId>(),
        Schema.object({
            previewUrlSearch: Schema.string.nullable(),
            file: FileModel.schema(),
        }),
    ),
});

/**
 * A content node alongside its references. We pass around this type instead of
 * content alone to force the collocation of references with content. You can't
 * interpret a content node without its references.
 */
export type ContentWithReferences = {
    readonly doc: Node;
    readonly references: ContentReferences;
};

export const emptyContentReferences: ContentReferences = {
    accountById: new Map(),
    fileById: new Map(),
};

/**
 * Is the provided `ContentReferences` object empty?
 */
export function isEmptyContentReferences(references: ContentReferences): boolean {
    // If you add more data to `ContentReferences` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<keyof ContentReferences, "accountById" | "fileById">();

    return references.accountById.size === 0 && references.fileById.size === 0;
}

/**
 * Merge two `ContentReferences` into one. References in the second object are
 * considered newer than references in the first and will usually override
 * them.
 */
export function mergeContentReferences(
    references1: ContentReferences,
    references2: ContentReferences,
): ContentReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyContentReferences(references1)) return references2;
    if (isEmptyContentReferences(references2)) return references1;

    const accountById = new Map<ContentMentionAccountId, AccountModel>();

    // Merge accounts together...
    for (const [accountId, account] of concatIterables(
        references1.accountById,
        references2.accountById,
    )) {
        const existingAccount = accountById.get(accountId);
        accountById.set(accountId, existingAccount ? existingAccount.merge(account) : account);
    }

    return {
        accountById,
        fileById: mergeContentReferencesFileById(references1.fileById, references2.fileById),
    };
}

export function mergeContentReferencesFileById(
    fileById1: ContentReferences["fileById"],
    fileById2: ContentReferences["fileById"],
): ContentReferences["fileById"] {
    let newFileById: Map<FileId, {previewUrlSearch: string | null; file: FileModel}> | undefined;

    // Merge files together...
    //
    // Prefer `existingFileReference` in `FileModel.minLoadingCount()` to avoid
    // unnecessary re-renders. Pick the `previewUrlSearch` that expires later.
    for (const [fileId2, file2] of fileById2) {
        const fileReference1 = fileById1.get(fileId2);

        const newFileReference = {
            previewUrlSearch:
                fileReference1?.previewUrlSearch &&
                file2.previewUrlSearch &&
                getContentReferencesFileSignedUrlExpirationTime(fileReference1.previewUrlSearch) >=
                    getContentReferencesFileSignedUrlExpirationTime(file2.previewUrlSearch)
                    ? fileReference1.previewUrlSearch
                    : file2.previewUrlSearch,
            file: fileReference1
                ? FileModel.minLoadingCount(fileReference1.file, file2.file)
                : file2.file,
        };

        if (
            !fileReference1 ||
            newFileReference.previewUrlSearch !== fileReference1.previewUrlSearch ||
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

/**
 * Get the expiration time from a JWT token in `ContentReferences` for a file.
 */
export function getContentReferencesFileSignedUrlExpirationTime(previewUrlSearch: string): number {
    const searchParams = new URLSearchParams(previewUrlSearch.split("?", 2)[1]);
    const expirationTime = parseInt(searchParams.get("exp") ?? "", 10);
    assert(Number.isInteger(expirationTime));
    return expirationTime * 1000;
}
