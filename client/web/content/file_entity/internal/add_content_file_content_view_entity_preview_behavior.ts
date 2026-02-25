import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {addContentFileEntityPreviewBehavior} from "~/client/web/content/internal/content_file_entity_preview.js";
import {addContentFilePreviewBehavior} from "~/client/web/content/internal/content_file_preview.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {
    FileChatEntityModel,
    FileChatEntityModelSchema,
} from "~/shared/chat/file_chat_entity_model_schema.js";
import {
    ContentReferences,
    emptyContentReferences,
    mergeContentReferences,
} from "~/shared/content/content_references.js";
import {fileClassName} from "~/shared/design/core/constant_class_names.js";
import {
    FileDocumentEntityModel,
    FileDocumentEntityModelSchema,
} from "~/shared/documents/file_document_entity_model_schema.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {
    FilePostEntityModel,
    FilePostEntityModelSchema,
} from "~/shared/forum/file_post_entity_model_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {undefinedStore} from "~/shared/store/const_store.js";

type FileContentViewEntityPreviewFileEntity =
    | FileDocumentEntityModel
    | FilePostEntityModel
    | FileChatEntityModel;

export function addContentFileContentViewEntityPreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {
        fileEntity: unknownParentFileEntity,
        fileEntityRenderers,
        spaceId,
        getReporter,
    }: {
        fileEntity: FileEntityModel;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        spaceId: SpaceId;
        getReporter: () => Reporter;
    },
) {
    const parentFileEntity = (() => {
        switch (unknownParentFileEntity.type) {
            case "Document":
                return unknownParentFileEntity.deserialize(FileDocumentEntityModelSchema);
            case "Post":
                return unknownParentFileEntity.deserialize(FilePostEntityModelSchema);
            case "Chat":
                return unknownParentFileEntity.deserialize(FileChatEntityModelSchema);
            default:
                throw new InternalError(
                    "`unknownParentFileEntity` must be of type `Document`, `Post`, or `Chat`",
                );
        }
    })();

    const contentReferences = getFileContentViewEntityPreviewReferences(parentFileEntity);

    const cleanupFunctions: Array<() => void> = [];

    // Find all immediate files and file entities inside this element
    const allFileElements = element.querySelectorAll(
        `.${fileClassName}, .${contentStyles.fileEntityClassName}`,
    );

    const fileEntityChildrenElements = Array.from(allFileElements).filter(child => {
        // We don't want to handle any nested file entities here, as this
        // function is recursive and the nested ones will be handled later.
        return child.parentElement?.closest(`.${contentStyles.fileEntityClassName}`) === element;
    });

    for (const fileElement of fileEntityChildrenElements) {
        assert(fileElement instanceof HTMLElement);

        const fileIdString = fileElement.getAttribute("data-file");

        // The `data-file` attribute must exist (thanks to the `withFileIdAttribute`)
        // even if it's the string `"null"`. Just to make sure we're not incorrectly
        // processing any file elements.
        assert(fileIdString !== null);

        const fileId: FileId | FileEntityId | null =
            fileIdString !== "null" ? (fileIdString as FileId | FileEntityId) : null;

        if (fileId !== null && isFileEntityId(fileId)) {
            const fileEntityResult =
                fileId !== null ? contentReferences?.fileEntityById?.get(fileId) : undefined;

            // Recursively call our child entity previews
            const cleanup = addContentFileEntityPreviewBehavior(getContext, fileElement, {
                // All child files should be inert. You shouldn't be able to interact with them
                // inside the content preview.
                isInert: true,
                spaceId,
                fileEntityId: fileId,
                fileEntityResult,
                fileEntityRenderers,
                getReporter,
                navigate: () => {
                    throw new UnimplementedError(
                        "Shouldn\u2019t be able to navigate from inert file entity preview",
                    );
                },
            });

            cleanupFunctions.push(cleanup);
        } else {
            const file = fileId !== null ? contentReferences?.fileById?.get(fileId) : undefined;

            const fileRegistry = getFileRegistry(spaceId);

            const fileStore = file ? fileRegistry.getFileStore(file) : undefinedStore;

            let cleanupBehavior: (() => void) | null = null;

            const update = () => {
                cleanupBehavior?.();
                cleanupBehavior = null;

                cleanupBehavior = addContentFilePreviewBehavior(getContext, fileElement, {
                    // All child files should be inert. You shouldn't be able to interact with them
                    // inside the content preview.
                    isInert: true,
                    spaceId,
                    file: fileStore.getSnapshot(),
                    attachmentTarget:
                        getFileContentViewEntityPreviewAttachmentTarget(parentFileEntity),
                    getReporter,
                    rootNavigate: () => {
                        throw new UnimplementedError(
                            "Shouldn\u2019t be able to navigate from inert file preview",
                        );
                    },
                });
            };

            const unsubscribeFromStore = fileStore.subscribe(update);
            update();

            cleanupFunctions.push(() => {
                unsubscribeFromStore();
                cleanupBehavior?.();
                cleanupBehavior = null;
            });
        }
    }

    return () => {
        for (const cleanup of cleanupFunctions) {
            cleanup();
        }
    };
}

function getFileContentViewEntityPreviewReferences(
    fileEntity: FileContentViewEntityPreviewFileEntity,
): ContentReferences {
    switch (fileEntity.type) {
        case "Document": {
            return fileEntity.preview?.content.references ?? emptyContentReferences;
        }
        case "Post": {
            return fileEntity.content.references;
        }
        case "Chat": {
            let references = emptyContentReferences;

            for (const message of concatIterables(
                fileEntity.otherReferencedMessages,
                fileEntity.messages,
            )) {
                if (message.payload.type !== "Content") continue;
                references = mergeContentReferences(references, message.payload.content.references);
            }

            return references;
        }
        default:
            throw exhaustive(fileEntity);
    }
}

function getFileContentViewEntityPreviewAttachmentTarget(
    fileEntity: FileContentViewEntityPreviewFileEntity,
): FileAttachmentTarget {
    switch (fileEntity.type) {
        case "Document":
            return {type: "Document", documentId: fileEntity.id};
        case "Post":
            return {type: "Post", postId: fileEntity.id};
        case "Chat":
            return {type: "ChatMessages", chatId: fileEntity.id};
        default:
            throw exhaustive(fileEntity);
    }
}
