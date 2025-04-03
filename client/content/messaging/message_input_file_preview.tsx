import {X} from "phosphor-react";
import {Memo} from "react";
import {ContentFileMiniPreview} from "~/client/content/content_file_mini_preview.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
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
        <Box position="relative" zIndex="0" width="20" height="20">
            <Box position="absolute" zIndex="20" top="-1" right="-1">
                <IconButton
                    size="xs"
                    variant="quiet-elevation-10"
                    description="Remove"
                    onPress={onRemove}
                    // Not focusable so clicking on this button doesn't unfocus
                    // the input.
                    isFocusable={false}
                >
                    <X />
                </IconButton>
            </Box>
            <ContentFileMiniPreview
                size={convertRemLengthToPx("20", spacingScale)}
                signedUrlSearch={signedUrlSearch}
                file={file}
                attachmentTarget={attachmentTarget}
            />
        </Box>
    );
}
