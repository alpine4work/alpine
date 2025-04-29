import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {
    addContentFileChannelEntityPreviewBehavior,
    renderContentFileChannelEntityPreview,
} from "~/client/content/file_entity/internal/content_file_channel_entity_preview.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model.js";

export const contentFileEntityRenderers: ContentFileEntityRenderers = {
    renderPreviewByType: {
        Document: (get, html, {fileEntity: unknownFileEntity}) => {
            const fileEntity = unknownFileEntity.deserialize(FileDocumentEntityModelSchema);

            // NOCOMMIT: Implement!
        },
        Channel: renderContentFileChannelEntityPreview,
        TaskCollection: () => {
            // NOCOMMIT: Implement!
        },
    },
    addPreviewBehaviorByType: {
        Channel: addContentFileChannelEntityPreviewBehavior,
    },
};
