import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {
    addContentFileChannelEntityPreviewBehavior,
    renderContentFileChannelEntityPreview,
} from "~/client/content/file_entity/internal/content_file_channel_entity_preview.js";
import {renderContentFileDocumentEntityPreview} from "~/client/content/file_entity/internal/content_file_document_entity_preview.js";

export const contentFileEntityRenderers: ContentFileEntityRenderers = {
    renderPreviewByType: {
        Document: renderContentFileDocumentEntityPreview,
        Channel: renderContentFileChannelEntityPreview,
        TaskCollection: () => {
            // NOCOMMIT: Implement!
        },
    },
    addPreviewBehaviorByType: {
        Channel: addContentFileChannelEntityPreviewBehavior,
    },
};
