import {ContentFileEntityPreview} from "~/client/web/content/content_file_entity_preview_component.js";
import {MessageInputFilePreviewBase} from "~/client/web/content/messaging/internal/message_input_file_preview_base.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
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

    const size = convertRemLengthToPx("20", spacingScale);

    return (
        <MessageInputFilePreviewBase onRemove={onRemove}>
            <ContentFileEntityPreview
                width={size}
                height={size}
                blockWidth={size}
                fileEntityId={fileEntityId}
                fileEntityResult={fileEntityResult}
            />
        </MessageInputFilePreviewBase>
    );
}
