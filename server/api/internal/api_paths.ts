import {apiChatPaths} from "~/server/api/internal/chat/api_chat_paths.js";
import {apiDocumentsPaths} from "~/server/api/internal/documents/api_documents_paths.js";
import {apiForumPaths} from "~/server/api/internal/forum/api_forum_paths.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {apiSpacesPaths} from "~/server/api/internal/spaces/api_spaces_paths.js";
import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";

export const apiPaths: ApiPaths = {
    ...apiChatPaths,
    ...apiDocumentsPaths,
    ...apiForumPaths,
    ...apiSpacesPaths,
    ...apiTasksPaths,
};
