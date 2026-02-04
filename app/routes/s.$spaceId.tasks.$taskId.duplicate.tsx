import {useParams, useSearchParams} from "@remix-run/react";
import {useCallback, useMemo} from "react";
import {deserializeTaskIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ContentDuplicationView} from "~/client/web/content/with_navigation/content_duplication_view.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {
    ContentDuplicationVariableValues,
    decodeContentDuplicationVariableSchemaFromUrl,
} from "~/shared/content/content_duplication_variable_schema.js";

/**
 * Route for duplicating a task with template variable replacement.
 * No loader - schema and title are encoded in the URL search params.
 * Opens as a peek when navigated to.
 */
export default function TaskDuplicateRoute() {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {timeZone} = useClientInfo();
    const {store} = useTaskStoreLoaderDataWithoutRetaining();

    const params = useParams();
    const [searchParams] = useSearchParams();

    const taskId = deserializeTaskIdForLoader(params.taskId);

    const title = searchParams.get("title") ?? "";

    const variableSchema = useMemo(
        () => decodeContentDuplicationVariableSchemaFromUrl(searchParams.get("schema")),
        [searchParams],
    );

    const handleDuplicate = useCallback(
        async (variableValues: ContentDuplicationVariableValues) => {
            const {taskId: newTaskId} = await store.duplicateTaskAndAllChildren(
                context,
                taskId,
                timeZone,
                {
                    undoManager: null,
                    variableValues,
                },
            );
            return `/s/${space.id}/tasks/${newTaskId}`;
        },
        [store, context, taskId, timeZone, space.id],
    );

    return (
        <ContentDuplicationView
            title={title}
            defaultPreviousRoute={`/s/${space.id}/tasks/${taskId}`}
            variableSchema={variableSchema}
            onDuplicate={handleDuplicate}
        />
    );
}
