import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {
    addContentFileChannelEntityPreviewBehavior,
    renderContentFileChannelEntityPreview,
} from "~/client/content/file_entity/internal/content_file_channel_entity_preview.js";
import {renderContentFileDocumentEntityPreview} from "~/client/content/file_entity/internal/content_file_document_entity_preview.js";
import {renderContentFilePostEntityPreview} from "~/client/content/file_entity/internal/content_file_post_entity_preview.js";
import {renderContentFileTaskCollectionEntityPreview} from "~/client/content/file_entity/internal/content_file_task_collection_entity_preview.js";

export const contentFileEntityRenderers: ContentFileEntityRenderers = {
    renderPreviewByType: {
        Document: renderContentFileDocumentEntityPreview,
        Channel: renderContentFileChannelEntityPreview,
        TaskCollection: renderContentFileTaskCollectionEntityPreview,
        Post: renderContentFilePostEntityPreview,
    },
    addPreviewBehaviorByType: {
        Channel: addContentFileChannelEntityPreviewBehavior,
    },
};
