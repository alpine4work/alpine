import {ContentFileEntityMiniPreview} from "~/client/content/content_file_entity_mini_preview.js";
import {MessageInputFilePreviewBase} from "~/client/content/messaging/internal/message_input_file_preview_base.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {Result} from "~/shared/helpers/control/result.js";

export function MessageInputFileEntityPreview({
    fileEntityId,
    fileEntityResult,
    onRemove,
}: {
    fileEntityId: FileEntityId;
    fileEntityResult: Result<FileEntityModel>;
    onRemove: () => void;
}) {
    const spacingScale = useSpacingScale();

    return (
        <MessageInputFilePreviewBase onRemove={onRemove}>
            <ContentFileEntityMiniPreview
                size={convertRemLengthToPx("20", spacingScale)}
                fileEntityId={fileEntityId}
                fileEntityResult={fileEntityResult}
            />
        </MessageInputFilePreviewBase>
    );
}
