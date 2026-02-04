import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {Readable} from "stream";
import {isCloudflareR2NoSuchKeyError} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getFileIfExistsFromAttachment} from "~/server/files/data/files_actions.js";
import {getFileEntityIfPossible} from "~/server/files/data/get_file_entity_if_possible.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getAccountIfExists} from "~/server/spaces/get_account.js";
import {
    ContentReferencedIds,
    getContentReferencedIdsForNode,
    getContentReferencedIdsForNodes,
    getContentReferencedIdsForSteps,
} from "~/shared/content/content_referenced_ids.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileModel, getFileModelDataAttachReadiness} from "~/shared/files/file_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {Result} from "~/shared/helpers/control/result.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

export function getContentReferencesForNode(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    content: Node,
    options?: {withPreloadedFiles?: boolean},
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForNode(content);
    return getContentReferences(context, spaceId, fileAuthorizer, referencedIds, options);
}

// `MessageContent` doesn't have files so you don't need a `FileAuthorizer`.
export function getMessageContentReferencesForNode(
    context: ServerActionContext,
    spaceId: SpaceId,
    content: MessageContent,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForNode(content);
    return getContentReferences(context, spaceId, "AssertHasNoFiles", referencedIds);
}

// `MessageContent` doesn't have files so you don't need a `FileAuthorizer`.
export function getMessageContentReferencesForNodes(
    context: ServerActionContext,
    spaceId: SpaceId,
    content: Iterable<MessageContent>,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForNodes(content);
    return getContentReferences(context, spaceId, "AssertHasNoFiles", referencedIds);
}

export function getContentReferencesForSteps(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    steps: ReadonlyArray<Step>,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForSteps(steps);
    return getContentReferences(context, spaceId, fileAuthorizer, referencedIds);
}

/**
 * The minimum file length (in bytes) to consider the file "small". We load
 * some small files on the backend and include them in our response so the
 * client doesn't need to make an additional network request for them.
 */
const maxPreloadSmallFileContentLength = 100000;

/**
 * The maximum amount of small file content we'll load before we stop loading
 * small file content. We'll only load the first ~4 small files in a document
 * before not preloading anything else.
 *
 * This number was picked because the DynamoDB item limit is 400kb. There's
 * absolutely no relationship between the DynamoDB item limit and this limit.
 * We should experiment to see what the right balance here is between UX and
 * delaying the initial load.
 */
const totalPreloadSmallFileContentLengthLimit = maxPreloadSmallFileContentLength * 4;

/**
 * Get entities referenced in content.
 *
 * Must provide a `FileAuthorizer` to authorize files. Accounts are granted
 * access to files that are attached to the content they're looking at.
 * `FileAuthorizer` carries information about the attachment target and how to
 * authorize access to the attachment target.
 *
 * If `withPreloadedFiles` is true will preload ~4 files under 100kb so we can
 * render the files immediately without needing to make a second network
 * request. This improves the user experience when loading a document with
 * small files (e.g. an SVG or a logo) without slowing down this initial
 * request too much. Must explicitly opt-in to file preloading since it can be
 * expensive if you're loading multiple pieces of content at once.
 */
export async function getContentReferences(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    referencedIds: ContentReferencedIds,
    {withPreloadedFiles = false}: {withPreloadedFiles?: boolean} = {},
): Promise<ContentReferences> {
    const searchEntityIds = Array.from(referencedIds.searchEntityIds);

    // IMPORTANT: This function may be called multiple times on the same content in
    // an action. So all data loading functions are cached.
    //
    // For example, in `notifications_realtime_table.ts` `processNotificationEvent()`
    // function we may load content references once when we build an inbox entry
    // model and again in `printNotificationEventAlertContentBody()` when we print
    // for push notifications.
    //
    // Another example, when a new message is created our messaging realtime
    // services need to load the content references from the perspective of
    // multiple accounts. We call an RPC like `getChatMessageReferences()` multiple
    // times in a batched request using `/api/rpc/_batchByActor`. In this case,
    // ideally we want to load the underlying data once and then apply different
    // permission rules depending on the actor on top of that.
    //
    // File preloading is not cached. If the caller explicitly opts in with
    // `withPreloadedFiles` then they shouldn't expect results to be cached.
    const [accounts, searchEntities, fileReferences, fileEntities] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId => {
                // You may have copy/pasted some content from a different space. In that case a
                // mentioned user may not exist.
                return getAccountIfExists(context, spaceId, accountId);
            }),
        ),
        runAllPromises(
            mapIterable(searchEntityIds, entityId => {
                // You may have copy/pasted some content from a different space. In that case a
                // mentioned entity may not exist.
                //
                // @ts-expect-error: TODO(calebmer): TypeScript error revealed by the refactor
                // which introduces `SearchInjectionContextModule`. I don't want to introduce a
                // behavior change in this already large PR so ignoring the error for now since
                // nothing's broken in the product right now.
                return context.searchInjection.getSearchMentionEntityIfPossible(spaceId, entityId);
            }),
        ),
        runAllPromises(
            mapIterable(referencedIds.fileIds, fileId => {
                if (fileAuthorizer === "AssertHasNoFiles") {
                    throw new InternalError("Expected content to not include any referenced files");
                }
                return getContentFileReference(context, spaceId, fileId, fileAuthorizer);
            }),
        ).then(fileReferences => {
            if (!withPreloadedFiles) return fileReferences;

            let preloadedSmallFileContentLength = 0;

            return runAllPromises(
                // Go through `fileReferences` in order and preload small files up to our
                // limit. We make the determination of whether or not to preload synchronously
                // so there are no race conditions. We'll always preload the same files.
                //
                // TODO(calebmer): Should we perform this preload optimization for messages
                // too? I think it's less important from a UX perspective to preload files for
                // messages so I'm not implementing it for now. since while images are very
                // important to interpreting a document's content and it can be disruptive if
                // they aren't there (e.g. a logo) that's less true for messages where files
                // are more auxiliary to the message content. Files shared in a messaging view
                // is more akin to file sharing whereas files attached to a document is more
                // akin to decorating content.
                mapIterable(fileReferences, async fileReference => {
                    if (!fileReference) return null;

                    if (
                        fileReference.file.initialData.preview?.type !== "Image" ||
                        fileReference.file.initialData.isUploading ||
                        fileReference.file.initialData.preview?.isProcessing
                    ) {
                        return fileReference;
                    }

                    const contentLength = isObject(fileReference.file.initialData.preview.content)
                        ? fileReference.file.initialData.preview.content.contentLength
                        : fileReference.file.initialData.contentLength;

                    if (
                        contentLength > maxPreloadSmallFileContentLength ||
                        preloadedSmallFileContentLength + contentLength >
                            totalPreloadSmallFileContentLengthLimit
                    ) {
                        return fileReference;
                    }

                    preloadedSmallFileContentLength += contentLength;

                    try {
                        const object = await context.r2.GetObject({
                            Bucket: filesBucketName,
                            Key: isObject(fileReference.file.initialData.preview.content)
                                ? `${spaceId}/${fileReference.file.id}-preview`
                                : `${spaceId}/${fileReference.file.id}`,
                        });

                        assert(object.Body instanceof Readable);

                        const objectBodyChunks = [];
                        for await (const objectBodyChunk of object.Body) {
                            objectBodyChunks.push(objectBodyChunk);
                        }
                        const objectBody = Buffer.concat(objectBodyChunks);

                        return {
                            ...fileReference,
                            file: new FileModel({
                                ...fileReference.file.initialData,
                                imagePreviewContentIfSmall: objectBody.toString("base64"),
                            }),
                        };
                    } catch (error) {
                        // Be resilient against the file not existing in Cloudflare R2 yet. For
                        // example, while the file is uploading.
                        if (isCloudflareR2NoSuchKeyError(error)) return fileReference;

                        throw error;
                    }
                }),
            );
        }),
        runAllPromises(
            mapIterable(
                referencedIds.fileEntityIds,
                async (entityId): Promise<[FileEntityId, Result<FileEntityModel>] | null> => {
                    const entityResult = await getFileEntityIfPossible(context, spaceId, entityId);
                    if (!entityResult) return null;
                    return [entityId, entityResult];
                },
            ),
        ),
    ]);

    const accountById = new Map(
        filterMapIterable(accounts, account => {
            if (!account) return;
            return [account.id, account];
        }),
    );

    const searchEntityById = new Map(
        filterMapIterable(searchEntities, (searchEntity, index) => {
            if (!searchEntity) return;
            const searchEntityId = searchEntityIds[index]!;
            return [searchEntityId, searchEntity];
        }),
    );

    const fileById = new Map(
        filterMapIterable(fileReferences, fileReference => {
            if (!fileReference) return;
            return [fileReference.file.id, fileReference];
        }),
    );

    const fileEntityById = new Map(filterIterable(fileEntities, isNonNullable));

    return {
        accountById,
        searchEntityById,
        fileById: fileById.size > 0 ? fileById : undefined,
        fileEntityById: fileEntityById.size > 0 ? fileEntityById : undefined,
    };
}

export async function getContentFileReference(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    fileAuthorizer: FileAuthorizer,
): Promise<{type: "File"; signedUrlSearch: string; file: FileModel} | null> {
    let file = await getFileIfExistsFromAttachment(context, spaceId, fileId, fileAuthorizer, {
        consistency: "Eventual",
    });

    // The client (in `uploadFileFromContentEditor()`) will not attach a file to
    // content until the preview is at least partially available. So if we see an
    // unavailable preview here that's probably because of eventual consistency
    // lag. Try reading again with strong consistency and returning that.
    //
    // We don't want to show a file with an unavailable preview to the user since
    // it'll have the incorrect size then after a bit will flash in with the
    // correct size changing the document's layout. We're ok with showing a
    // partially available preview since at least the layout will be stable even if
    // we don't have e.g. the image preview's placeholder.
    if (!file || getFileModelDataAttachReadiness(file.initialData) === "PreviewUnavailable") {
        file = await getFileIfExistsFromAttachment(context, spaceId, fileId, fileAuthorizer, {
            consistency: "Strong",
        });
    }

    if (!file) return null;

    const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
        spaceId,
        fileId,
    );

    return {type: "File", signedUrlSearch: signedUrl.search, file};
}
