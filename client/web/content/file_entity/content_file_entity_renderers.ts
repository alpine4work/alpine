import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {addContentFileContentViewEntityPreviewBehavior} from "~/client/web/content/file_entity/internal/add_content_file_content_view_entity_preview_behavior.js";
import {
    addContentFileChannelEntityPreviewBehavior,
    renderContentFileChannelEntityPreview,
} from "~/client/web/content/file_entity/internal/content_file_channel_entity_preview.js";
import {renderContentFileDocumentEntityPreview} from "~/client/web/content/file_entity/internal/content_file_document_entity_preview.js";
import {renderContentFilePostEntityPreview} from "~/client/web/content/file_entity/internal/content_file_post_entity_preview.js";
import {renderContentFileTaskCollectionEntityPreview} from "~/client/web/content/file_entity/internal/content_file_task_collection_entity_preview.js";

export const contentFileEntityRenderers: ContentFileEntityRenderers = {
    renderPreviewByType: {
        Document: renderContentFileDocumentEntityPreview,
        Channel: renderContentFileChannelEntityPreview,
        TaskCollection: renderContentFileTaskCollectionEntityPreview,
        Post: renderContentFilePostEntityPreview,
    },
    addPreviewBehaviorByType: {
        Channel: addContentFileChannelEntityPreviewBehavior,
        Document: addContentFileContentViewEntityPreviewBehavior,
        Post: addContentFileContentViewEntityPreviewBehavior,
    },
};
