import {
    ContentFileEntityRenderers,
    ContentFileEntityRenderersContext,
} from "~/client/web/content/content_file_entity_renderers_context.js";
import {addContentFileContentViewEntityPreviewBehavior} from "~/client/web/content/file_entity/internal/add_content_file_content_view_entity_preview_behavior.js";
import {
    addContentFileChannelEntityPreviewBehavior,
    renderContentFileChannelEntityPreview,
} from "~/client/web/content/file_entity/internal/content_file_channel_entity_preview.js";
import {
    addContentFileChatEntityPreviewBehavior,
    renderContentFileChatEntityPreview,
} from "~/client/web/content/file_entity/internal/content_file_chat_entity_preview.js";
import {renderContentFileDocumentEntityPreview} from "~/client/web/content/file_entity/internal/content_file_document_entity_preview.js";
import {renderContentFilePostEntityPreview} from "~/client/web/content/file_entity/internal/content_file_post_entity_preview.js";
import {renderContentFileSiteEntityPreview} from "~/client/web/content/file_entity/internal/content_file_site_entity_preview.js";
import {renderContentFileTaskCollectionEntityPreview} from "~/client/web/content/file_entity/internal/content_file_task_collection_entity_preview.js";
import {renderContentFileTaskEntityPreview} from "~/client/web/content/file_entity/internal/content_file_task_entity_preview.js";

// NOTE(calebmer): We export a React component instead of exporting
// `contentFileEntityRenderers` so that file entity renderers can be hot reloaded
// with React Fast Refresh. A change to a file entity renderer will bubble up to
// this file which React Fast Refresh can hot reload.
export function ContentFileEntityRenderersContextProvider({children}: {children: React.ReactNode}) {
    return (
        <ContentFileEntityRenderersContext.Provider value={contentFileEntityRenderers}>
            {children}
        </ContentFileEntityRenderersContext.Provider>
    );
}

const contentFileEntityRenderers: ContentFileEntityRenderers = {
    renderPreviewByType: {
        Document: renderContentFileDocumentEntityPreview,
        Channel: renderContentFileChannelEntityPreview,
        Chat: renderContentFileChatEntityPreview,
        Task: renderContentFileTaskEntityPreview,
        TaskCollection: renderContentFileTaskCollectionEntityPreview,
        Post: renderContentFilePostEntityPreview,
        Site: renderContentFileSiteEntityPreview,
    },
    addPreviewBehaviorByType: {
        Channel: addContentFileChannelEntityPreviewBehavior,
        Chat: addContentFileChatEntityPreviewBehavior,
        Document: addContentFileContentViewEntityPreviewBehavior,
        Post: addContentFileContentViewEntityPreviewBehavior,
    },
};
