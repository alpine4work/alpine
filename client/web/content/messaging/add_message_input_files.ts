import {Memo} from "react";
import {FileInfoWithEntity} from "~/client/web/content/internal/iterate_file_infos_in_element.js";
import {uploadFile} from "~/client/web/content/internal/upload_file.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Id, generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    attachFileAsUploader,
    attachFileFromAttachment,
    getFileAsUploader,
    getFileEntityIfPossible,
    getFileFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";

export type MessageInputFile =
    | {
          readonly type: "File";
          readonly key: Id;
          readonly attachmentTarget: Memo<FileAttachmentTarget> | "Uploader";
          readonly signedUrlSearch: string;
          readonly file: FileModel;
      }
    | {
          readonly type: "FileEntity";
          readonly key: Id;
          readonly fileEntityId: FileEntityId;
          readonly fileEntityResult: Result<FileEntityModel>;
      };

export async function addMessageInputFiles(
    context: AppContext,
    fileInfos: ReadonlyArray<FileInfoWithEntity>,
    {
        spaceId,
        attachmentTarget: toTarget,
        addGlobalLoadingIndicator,
        onAddFile,
    }: {
        spaceId: SpaceId;
        attachmentTarget: FileAttachmentTarget | null;
        addGlobalLoadingIndicator: (
            promise: Promise<unknown>,
            indicator: GlobalLoadingIndicator,
        ) => void;
        onAddFile: (file: MessageInputFile) => void;
    },
) {
    await runAllPromises(
        fileInfos.map((fileInfo): Promise<void> => {
            switch (fileInfo.type) {
                case "AttachFile": {
                    const fromTarget = fileInfo.target;

                    let promise: Promise<{
                        readonly signedUrlSearch: string;
                        readonly file: FileModel;
                    }>;

                    // If we're trying to attach the file to the same attachment target it's from
                    // then we don't need to perform another attach mutation. Instead, all we need
                    // to do is load the file (since it's not in our references).
                    if (!toTarget || isDeepEqual(fromTarget, toTarget)) {
                        if (fromTarget === "Uploader") {
                            promise = getFileAsUploader(context, {
                                spaceId: fileInfo.spaceId,
                                fileId: fileInfo.fileId,
                            });
                        } else {
                            promise = getFileFromAttachment(context, {
                                spaceId: fileInfo.spaceId,
                                fileId: fileInfo.fileId,
                                target: fromTarget,
                            });
                        }
                    }
                    // Otherwise, let's attach the file to its new attachment target.
                    else if (fromTarget === "Uploader") {
                        promise = attachFileAsUploader(context, {
                            spaceId: fileInfo.spaceId,
                            fileId: fileInfo.fileId,
                            target: toTarget,
                        });
                    } else {
                        promise = attachFileFromAttachment(context, {
                            spaceId: fileInfo.spaceId,
                            fileId: fileInfo.fileId,
                            fromTarget,
                            toTarget,
                        });
                    }

                    addGlobalLoadingIndicator(promise, {type: "Uploading"});

                    return promise.then(({signedUrlSearch, file}) => {
                        onAddFile({
                            type: "File",
                            key: generateId(),
                            attachmentTarget: markMemoIfNotRendering(fromTarget),
                            signedUrlSearch,
                            file,
                        });
                    });
                }
                case "UploadFile": {
                    const promise = uploadFile(context, {
                        spaceId,
                        attachmentTarget: toTarget,
                        input: fileInfo.input,
                        onAttach: ({signedUrlSearch, file}) => {
                            onAddFile({
                                type: "File",
                                key: generateId(),
                                attachmentTarget: markMemoIfNotRendering(toTarget ?? "Uploader"),
                                signedUrlSearch,
                                file,
                            });
                        },
                    });

                    // While a file is uploading show an "Uploading" loading indicator with the
                    // progress percentage. If multiple files are uploading at once then the
                    // global loading indicator implementation is responsible for putting together
                    // an aggregated summary.
                    addGlobalLoadingIndicator(promise, {
                        type: "Uploading",
                        progressStore: promise.progressStore,
                    });

                    return promise;
                }
                case "AttachFileEntity": {
                    const promise = (async () => {
                        if (fileInfo.spaceId !== spaceId) return;

                        const {fileEntityResult} = await getFileEntityIfPossible(context, {
                            spaceId,
                            fileEntityId: fileInfo.fileEntityId,
                        });

                        onAddFile({
                            type: "FileEntity",
                            key: generateId(),
                            fileEntityId: fileInfo.fileEntityId,
                            fileEntityResult,
                        });
                    })();

                    addGlobalLoadingIndicator(promise, {type: "Uploading"});

                    return promise;
                }
                default:
                    throw exhaustive(fileInfo);
            }
        }),
    );
}
