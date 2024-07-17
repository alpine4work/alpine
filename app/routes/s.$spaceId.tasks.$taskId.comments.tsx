import {useParams, useSearchParams} from "@remix-run/react";
import {redirect} from "@remix-run/router";
import {useCallback, useEffect} from "react";
import {usePress} from "react-aria";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderIsMobile, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {TaskCommentsView} from "~/client/tasks/task_comments_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskCommentsFromEnd} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Schema} from "~/shared/schema/schema.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    taskTitle: Schema.string,
    commentCount: Schema.integer,
    lastCommentChangeTime: Schema.date.nullable(),
    comments: Schema.array(TaskCommentModel.schema()),
    otherReferencedComments: Schema.array(TaskCommentModel.schema()),
});

export async function loader({
    context: unauthenticatedContext,
    params,
    request,
    isPeek = false,
}: LoaderArgs & {isPeek?: boolean}) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const taskId = Schema.id<TaskId>().deserialize(params.taskId ?? null);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const url = new URL(request.url);

    const commentIndexString = url.searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    const clientInfo = context.loader.getClientInfo();
    const isMobile = getInitialAppRenderIsMobile(clientInfo);

    if (!isMobile && !isPeek) {
        if (commentIndex === null) {
            return redirect(`/s/${spaceId}/tasks/${taskId}`);
        }
        return redirect(`/s/${spaceId}/tasks/${taskId}?comment=${commentIndex}`);
    }

    const [{task}, {commentCount, comments, otherReferencedComments, lastCommentChangeTime}] =
        await runAllPromises([
            context.tasks.getTaskWithoutDependencies(spaceId, taskId),
            getTaskCommentsFromEnd(context, {
                taskId,
                limit: getInitialLoadMessageCount(context.loader.getClientInfo()),
                afterCommentIndex: null,
                beforeCommentIndex: null,
            }),
        ]);

    const propagateEventData: TracerEventData = {
        context: {
            taskId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            taskTitle: addFallbackToTaskTitle(task.getTitle().getText()),
            commentCount,
            lastCommentChangeTime,
            comments,
            otherReferencedComments,
        },
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {taskTitle}}) => [{title: taskTitle}]);

export default function TaskCommentsRoute({
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const [searchParams] = useSearchParams();
    const {taskTitle, commentCount, lastCommentChangeTime, comments, otherReferencedComments} =
        useLoaderDataWithSchema(LoaderSchema);

    const isMobile = useIsMobile();
    const navigate = useNavigate();

    const params = useParams();
    const spaceId = params.spaceId as SpaceId;
    const taskId = params.taskId as TaskId;

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const commentIndexString = searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout,
        title: <TaskCommentsViewHeaderTitle spaceId={spaceId} taskId={taskId} title={taskTitle} />,
        subtitle: "Comments",
        withoutDisappearingTitle: true,
        isDisabled: !withMobileLayout,
        replaceActions: null,
        menuActions: [
            {
                label: "Open task",
                pressErrorTitle: "Couldn't open task",
                onPress: () => navigate(`/s/${spaceId}/tasks/${taskId}/`),
            },
        ],
        titleJustifyContent: !isMobile ? "flex-start" : "center",
        isAlwaysOpaque: true,
    });

    useEffect(() => {
        if (withMobileLayout) return;

        if (commentIndex === null) {
            void navigate(`/s/${spaceId}/tasks/${taskId}`, {stopPropagation: true});
        } else {
            void navigate(`/s/${spaceId}/tasks/${taskId}?comment=${commentIndex}`, {
                stopPropagation: true,
            });
        }
    }, [withMobileLayout, spaceId, taskId, navigate, commentIndex]);

    useSearchAffinityViewInteraction(`Task:${taskId}`);

    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        "TaskNotesCollaborationService",
        TaskNotesCollaborationProtocol,
        `/api/durable-objects/task-notes/${taskId}`,
    );

    const subscribeToCommentsEvents = useCallback(
        (subscriber: (event: MessagingRealtimeEvent<TaskCommentModel>) => void) => {
            return subscribeToEvents(event => {
                if (event.type === "Comments") {
                    subscriber(event.event);
                }
            });
        },
        [subscribeToEvents],
    );

    return (
        <TaskCommentsView
            key={taskId}
            taskId={taskId}
            withMobileLayout={withMobileLayout}
            initialComments={{
                commentCount,
                lastCommentChangeTime,
                comments,
                otherReferencedComments,
            }}
            initialScrollToCommentIndex={commentIndex}
            getCommentUrl={useCallback(
                commentIndex =>
                    new URL(
                        `/s/${spaceId}/tasks/${taskId}/comments?comment=${commentIndex}`,
                        window.location.href,
                    ),
                [taskId, spaceId],
            )}
            scrollViewRef={scrollViewRef}
            extraChildren={navigationBar}
            scrollbarInsetTop={scrollbarInsetTop}
            isConnected={isConnected}
            procedures={procedures}
            subscribeToEvents={subscribeToCommentsEvents}
        />
    );
}

function TaskCommentsViewHeaderTitle({
    title,
    spaceId,
    taskId,
}: {
    title: string;
    spaceId: SpaceId;
    taskId: TaskId;
}) {
    const navigate = useNavigate();
    const {isPressed, pressProps} = usePress({
        onPress: () => {
            navigate(`/s/${spaceId}/tasks/${taskId}`, {
                stopPropagation: true,
            });
        },
    });

    return (
        <a
            {...pressProps}
            className={sprinkles({
                // This design has a weak link affordance so use a pointer cursor to make it
                // clear this text is clickable.
                cursor: "pointer",
                opacity: isPressed ? "60" : undefined,
            })}
            href={`/s/${spaceId}/tasks/${taskId}`}
            onClick={event => {
                // Custom link navigation handling...
                event.preventDefault();

                pressProps.onClick?.(event);
            }}
        >
            {title}
        </a>
    );
}
