import {useState} from "react";
import {ContentFileDesktopViewerModal} from "~/client/content/internal/content_file_desktop_viewer_modal.js";
import {ContentFileMobileViewerModal} from "~/client/content/internal/content_file_mobile_viewer_modal.js";
import {ContentFilePreviewExpirationTimers} from "~/client/content/internal/render_content_file_preview.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {getFileFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";

// TODO(calebmer, #files): Polling while loading and refresh on expiration.

let handoffContentFileReferencesByFileId: Map<
    FileId,
    Set<{signedUrlSearch: string; file: FileModel}>
> | null = null;

/**
 * Handoff some previously loaded data to `<ContentFileDesktopViewerModal>` so
 * it doesn't have to fetch data from the server when it mounts.
 */
function handoffContentFileReference(reference: {signedUrlSearch: string; file: FileModel}) {
    handoffContentFileReferencesByFileId ??= new Map();

    const handoffContentFileReferences = getOrSetDefaultMapValue(
        handoffContentFileReferencesByFileId,
        reference.file.id,
        () => new Set(),
    );

    if (handoffContentFileReferences.has(reference)) return;

    handoffContentFileReferences.add(reference);

    setTimeout(() => {
        handoffContentFileReferences.delete(reference);

        if (handoffContentFileReferences.size === 0)
            handoffContentFileReferencesByFileId?.delete(reference.file.id);
    }, 1000);
}

export function ContentFileViewerModal({
    fileId,
    attachmentTarget,
    onClose,
}: {
    fileId: FileId;
    attachmentTarget: FileAttachmentTarget;
    onClose: () => void;
}) {
    const isMobile = useIsMobile();
    const {space} = useSpaceContext();

    const handoffFileReference = useConstant(() =>
        iterableFirst(handoffContentFileReferencesByFileId?.get(fileId) ?? emptyArray),
    );

    const fileReferenceResult = useLazyLoadRpc(
        getFileFromAttachment,
        {
            spaceId: space.id,
            fileId,
            target: attachmentTarget,
        },
        {
            initialOutput: handoffFileReference?.file.id === fileId ? handoffFileReference : null,
            // File data is immutable after it finishes loading. Don't automatically
            // revalidate whenever the browser becomes visible after being hidden.
            withoutAutomaticRevalidation: true,
        },
    );

    const [expirationTimers] = useState(() => new ContentFilePreviewExpirationTimers());

    if (fileReferenceResult.output === null) return null;

    if (isMobile) {
        return (
            <ContentFileMobileViewerModal
                file={fileReferenceResult.output.file}
                signedUrlSearch={fileReferenceResult.output.signedUrlSearch}
                attachmentTarget={attachmentTarget}
                expirationTimers={expirationTimers}
                onClose={onClose}
            />
        );
    } else {
        return (
            <ContentFileDesktopViewerModal
                file={fileReferenceResult.output.file}
                signedUrlSearch={fileReferenceResult.output.signedUrlSearch}
                attachmentTarget={attachmentTarget}
                expirationTimers={expirationTimers}
                onClose={onClose}
            />
        );
    }
}

ContentFileViewerModal.handoffFileReference = handoffContentFileReference;
