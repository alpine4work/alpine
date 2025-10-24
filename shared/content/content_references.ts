import {Node} from "prosemirror-model";
import {FileEntityId, FileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {FileEntityModel, FileEntityModelResultSchema} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {Result} from "~/shared/helpers/control/result.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SearchMentionEntityId,
    SearchMentionEntityIdSchema,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type ContentReferences = SchemaType<typeof ContentReferencesSchema>;

export type ContentReferencesSearchEntity = SchemaType<typeof ContentReferencesSearchEntitySchema>;

const ContentReferencesSearchEntitySchema = Schema.booleanUnion(
    "isPrivate",
    Schema.object({isPrivate: Schema.value(true)}),
    Schema.object({isPrivate: Schema.value(false), entity: SearchEntityModel.schema}),
);

export type ContentReferencesFile = SchemaType<typeof ContentReferencesFileSchema>;

const ContentReferencesFileSchema = Schema.object({
    signedUrlSearch: Schema.string,
    file: FileModel.schema,
});

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
    accountById: Schema.map(Schema.id<AccountId>(), AccountModel.schema),

    /**
     * Search entities referenced in mentions.
     */
    searchEntityById: Schema.map(SearchMentionEntityIdSchema, ContentReferencesSearchEntitySchema),

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
    // NOTE(calebmer, 2024-12-29): While this is in `ContentReferences`, not all
    // content types support files. Notably `MessageContent` does not support
    // files. Instead we attach files at the message level instead of directly
    // within content. When I added `fileById` here I thought I was going to be
    // adding files to `MessageContent` as well.
    //
    // Now, separating the `ContentReferences` type into `ContentReferences` (which
    // doesn't have `fileById`) and, say, `ContentReferencesWithFiles` (which does
    // have `fileById`) used by `PostContentWithReferences` and
    // `TaskNotesContentWithReferences` adds a lot of unnecessary complexity.
    // `fileById` here adds such a minimal amount of overhead, the excessive extra
    // code complexity isn't worth it at the moment.
    //
    // Because this property is optional when there are zero files the overhead of
    // including this property for messages is pretty minimal.
    //
    // (If you look at the parent commit you can see my half complete, abandoned,
    // attempt at splitting this type in two.)
    fileById: Schema.map(Schema.id<FileId>(), ContentReferencesFileSchema).minSize(1).optional(),

    /**
     * Entities attached to content in files.
     *
     * In additional to arbitrary binary blobs, we allow attaching some Alpine
     * entities as files. This allows entities to use the file layout engine, put
     * multiple entities next to each other in rows, and place entities next to
     * files.
     */
    // NOTE(calebmer, 2025-04-28): Similarly to `fileById`, `MessageContent` will
    // never have any `fileEntityById`s. See the documentation comment on
    // `fileById` for more info.
    fileEntityById: Schema.map(FileEntityIdSchema, FileEntityModelResultSchema)
        .minSize(1)
        .optional(),
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
    accountById: emptyMap,
    searchEntityById: emptyMap,
};

/**
 * Is the provided `ContentReferences` object empty?
 */
export function isEmptyContentReferences(references: ContentReferences): boolean {
    // If you add more data to `ContentReferences` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<
        keyof ContentReferences,
        "accountById" | "searchEntityById" | "fileById" | "fileEntityById"
    >();

    return (
        references.accountById.size === 0 &&
        references.searchEntityById.size === 0 &&
        (references.fileById?.size ?? 0) === 0 &&
        (references.fileEntityById?.size ?? 0) === 0
    );
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

    const accountById = new Map<AccountId, AccountModel>();

    // Merge accounts together...
    for (const [accountId, account] of concatIterables(
        references1.accountById,
        references2.accountById,
    )) {
        const existingAccount = accountById.get(accountId);
        accountById.set(accountId, existingAccount ? existingAccount.merge(account) : account);
    }

    const searchEntityById = new Map<SearchMentionEntityId, ContentReferencesSearchEntity>();

    // Merge search entities together...
    for (const [entityId, entity] of concatIterables(
        references1.searchEntityById,
        references2.searchEntityById,
    )) {
        const existingEntity = searchEntityById.get(entityId);

        if (!existingEntity || existingEntity.isPrivate) {
            searchEntityById.set(entityId, entity);
        } else if (entity.isPrivate) {
            searchEntityById.set(entityId, existingEntity);
        } else {
            searchEntityById.set(entityId, {
                isPrivate: false,
                entity: existingEntity.entity.merge(entity.entity),
            });
        }
    }

    return {
        accountById,
        searchEntityById,
        fileById: mergeContentReferencesFileById(references1.fileById, references2.fileById),
        fileEntityById: mergeContentReferencesFileEntityById(
            references1.fileEntityById,
            references2.fileEntityById,
        ),
    };
}

function mergeContentReferencesFileById(
    fileById1: ContentReferences["fileById"],
    fileById2: ContentReferences["fileById"],
): ContentReferences["fileById"] {
    let newFileById: Map<FileId, {signedUrlSearch: string; file: FileModel}> | undefined;

    // Merge files together...
    //
    // Prefer `existingFileReference` in `FileModel.minLoadingCount()` to avoid
    // unnecessary re-renders. Pick the `signedUrlSearch` that expires later.
    if (fileById2 !== undefined) {
        for (const [fileId2, file2] of fileById2) {
            const fileReference1 = fileById1?.get(fileId2);

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
    }

    // If there's nothing new in `fileById2` then `newFileById` won't have been
    // initialized.
    const actualNewFileById = newFileById ?? fileById1;
    if (actualNewFileById !== undefined && actualNewFileById.size === 0) return undefined;
    return actualNewFileById;
}

function mergeContentReferencesFileEntityById(
    fileEntityById1: ContentReferences["fileEntityById"],
    fileEntityById2: ContentReferences["fileEntityById"],
): ContentReferences["fileEntityById"] {
    let newFileEntityById: Map<FileEntityId, Result<FileEntityModel>> | undefined;

    // Merge file entities together...
    if (fileEntityById2 !== undefined) {
        for (const [fileId2, fileEntityResult2] of fileEntityById2) {
            const fileEntityResult1 = fileEntityById1?.get(fileId2);

            if (!fileEntityResult1) {
                newFileEntityById ??= new Map(fileEntityById1);
                newFileEntityById.set(fileId2, fileEntityResult2);
                continue;
            }

            let newFileEntityResult: Result<FileEntityModel> | undefined;
            if (!fileEntityResult1.ok) {
                if (!fileEntityResult2.ok) {
                    // Prefer the first result if neither are ok
                    newFileEntityResult = fileEntityResult1;
                } else {
                    // Prefer the `ok: true` result
                    newFileEntityResult = fileEntityResult2;
                }
            } else {
                if (!fileEntityResult2.ok) {
                    // Prefer the `ok: true` result
                    newFileEntityResult = fileEntityResult1;
                } else {
                    const minVersionsLength = Math.min(
                        fileEntityResult1.value.versions.length,
                        fileEntityResult2.value.versions.length,
                    );

                    // Pick the entity with the highest version number. Stop at the first version
                    // that's not equal to the other entity's version. This is a generic conflict
                    // resolution mechanism designed to work without us knowing how to interpret the
                    // underlying file entity data.
                    for (let i = 0; i < minVersionsLength; i++) {
                        const version1 = fileEntityResult1.value.versions[i]!;
                        const version2 = fileEntityResult2.value.versions[i]!;

                        if (version1 > version2) {
                            newFileEntityResult = fileEntityResult1;
                            break;
                        } else if (version1 < version2) {
                            newFileEntityResult = fileEntityResult2;
                            break;
                        }
                    }

                    if (!newFileEntityResult) {
                        if (
                            fileEntityResult1.value.versions.length >
                            fileEntityResult2.value.versions.length
                        ) {
                            newFileEntityResult = fileEntityResult1;
                        } else {
                            newFileEntityResult = fileEntityResult2;
                        }
                    }
                }
            }

            if (newFileEntityResult !== fileEntityResult1) {
                newFileEntityById ??= new Map(fileEntityById1);
                newFileEntityById.set(fileId2, newFileEntityResult);
            }
        }
    }

    // If there's nothing new in `fileEntityById2` then `newFileEntityById` won't
    // have been initialized.
    const actualNewFileEntityById = newFileEntityById ?? fileEntityById1;
    if (actualNewFileEntityById !== undefined && actualNewFileEntityById.size === 0)
        return undefined;
    return actualNewFileEntityById;
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
