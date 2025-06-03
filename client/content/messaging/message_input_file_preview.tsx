import {Memo} from "react";
import {ContentFilePreview} from "~/client/content/content_file_preview_component.js";
import {MessageInputFilePreviewBase} from "~/client/content/messaging/internal/message_input_file_preview_base.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";

export function MessageInputFilePreview({
    signedUrlSearch,
    file,
    attachmentTarget,
    onRemove,
}: {
    signedUrlSearch: string;
    file: FileModel;
    attachmentTarget: Memo<FileAttachmentTarget> | "Uploader";
    onRemove: () => void;
}) {
    const spacingScale = useSpacingScale();

    return (
        <MessageInputFilePreviewBase onRemove={onRemove}>
            <ContentFilePreview
                size={convertRemLengthToPx("20", spacingScale)}
                signedUrlSearch={signedUrlSearch}
                file={file}
                attachmentTarget={attachmentTarget}
            />
        </MessageInputFilePreviewBase>
    );
}
