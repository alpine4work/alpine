import {useParams, useSearchParams} from "@remix-run/react";
import {useCallback, useMemo} from "react";
import {deserializeTaskIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ContentDuplicationView} from "~/client/web/content/with_navigation/content_duplication_view.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {
    ContentDuplicationVariableValues,
    decodeContentDuplicationVariableSchemaFromUrl,
} from "~/shared/content/content_duplication_variable_schema.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const LoaderSchema = Schema.object({
    spaceId: Schema.id<SpaceId>(),
});

/**
 * Route for duplicating a task with template variable replacement. Schema and
 * title are encoded in the URL search params. Opens as a peek when navigated to.
 */
export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const taskId = deserializeTaskIdForLoader(params.taskId);
    const {spaceId} = await authorizeTaskAccess(context, taskId, "View");
    return jsonWithSchema(LoaderSchema, {spaceId});
}

export default function TaskDuplicateRoute() {
    const context = useAppContext();
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
            return `/task/${newTaskId}`;
        },
        [store, context, taskId, timeZone],
    );

    return (
        <ContentDuplicationView
            title={title}
            defaultPreviousRoute={`/task/${taskId}`}
            variableSchema={variableSchema}
            onDuplicate={handleDuplicate}
        />
    );
}
