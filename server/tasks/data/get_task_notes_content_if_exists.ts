import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskNotesContentWithReferences,
    emptyTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

export function getTaskNotesContentIfExists(
    context: ServerActionContext,
    taskId: TaskId,
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContentWithReferences;
} | null> {
    return authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists(
        context,
        taskId,
        "View",
        async ({item, notesItem}) => ({
            spaceId: item.spaceId,
            version: notesItem?.version ?? 0,
            content: {
                doc: notesItem?.content ?? emptyTaskNotesContent,
                references: await getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
                    context,
                    item.spaceId,
                    FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                    notesItem?.content ?? emptyTaskNotesContent,
                    // Preload small files so we don't have to show a placeholder for them. This
                    // improves UX at the cost slowing the initial load. Right now we preload <100kb
                    // files up to 400kb. We'll have to tune this to find the right balance between UX
                    // and the performance hit.
                    {withPreloadedFiles: true},
                ),
            },
        }),
    );
}
