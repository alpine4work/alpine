import {useParams, useSearchParams} from "@remix-run/react";
import {useCallback, useEffect} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {useInboxBannerOutletContainer} from "~/client/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {NavigationBarContent} from "~/client/navigation/navigation_bar_content.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitleSeparator} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {TaskCommentsView} from "~/client/tasks/task_comments_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskCommentsFromEnd} from "~/server/tasks/data/task_table.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/title/task_title.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    taskTitle: Schema.string,
    commentCount: Schema.integer,
    lastCommentChangeTime: Schema.date.nullable(),
    comments: Schema.array(TaskCommentModel.schema()),
    otherReferencedComments: Schema.array(TaskCommentModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export async function loader({context: unauthenticatedContext, params, request}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const taskId = Schema.id<TaskId>().deserialize(params.taskId ?? null);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const url = new URL(request.url);

    const [
        task,
        {commentCount, comments, otherReferencedComments, lastCommentChangeTime},
        inboxEntry,
    ] = await runAllPromises([
        context.tasks.getTaskWithoutDependencies(spaceId, taskId),
        getTaskCommentsFromEnd(context, {
            taskId,
            limit: getInitialLoadMessageCount(context.loader.getClientInfo()),
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
        url.searchParams.get("inbox") === "show"
            ? getInboxEntry(context, {
                  spaceId,
                  key: {type: "Task", taskId},
              })
            : null,
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
            inboxEntry,
        },
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {taskTitle}}) => [
    {title: `Comments ${metaTitleSeparator} ${taskTitle}`},
]);

export default function TaskCommentsRoute() {
    const [searchParams] = useSearchParams();
    const {
        taskTitle,
        commentCount,
        lastCommentChangeTime,
        comments,
        otherReferencedComments,
        inboxEntry,
    } = useLoaderDataWithSchema(LoaderSchema);

    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();

    const params = useParams();
    const spaceId = params.spaceId as SpaceId;
    const taskId = params.taskId as TaskId;

    const commentIndexString = searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    const isFromTaskDetailView = searchParams.get("from") === "task";

    useEffect(() => {
        if (routeLayout === "narrow") return;

        const newSearchParams = new URLSearchParams();
        newSearchParams.set("comments", "show");

        if (commentIndex !== null) {
            newSearchParams.set("comment", String(commentIndex));
        }

        if (searchParams.get("inbox") === "show") {
            newSearchParams.set("inbox", "show");
        }

        const newSearchParamsString =
            newSearchParams.size > 0 ? `?${newSearchParams.toString()}` : "";

        void navigate(`/s/${spaceId}/tasks/${taskId}${newSearchParamsString}`, {
            replace: true,
            stopPropagation: true,
        });
    }, [spaceId, taskId, navigate, searchParams, commentIndex, routeLayout]);

    useSearchAffinityViewEntityInteraction(`Task:${taskId}`);

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

    const node = (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box
                position="relative"
                flexShrink="0"
                width="full"
                paddingTop="safe-area-inset"
                display="flex"
            >
                <NavigationBarContent
                    title={
                        <TaskCommentsViewNavigationBarTitle
                            spaceId={spaceId}
                            taskId={taskId}
                            title={taskTitle}
                            isFromTaskDetailView={isFromTaskDetailView}
                        />
                    }
                    subtitle="Comments"
                    menuActions={[
                        {
                            label: "Open task",
                            pressErrorTitle: "Couldn’t open task",
                            onPress: () => {
                                if (isFromTaskDetailView) {
                                    navigate(-1);
                                } else {
                                    navigate(`/s/${spaceId}/tasks/${taskId}`, {
                                        stopPropagation: true,
                                    });
                                }
                            },
                        },
                    ]}
                    titleJustifyContent={platform !== "mobile" ? "flex-start" : "center"}
                    desktopMaxWidth={contentStyles.contentMaxWidth}
                />
                <Box
                    pointerEvents="none"
                    position="absolute"
                    left="0"
                    right="0"
                    height="border"
                    // It's subtle, but `grey-5-translucent` ends up looking a lot nicer
                    // than if we used `grey-5` directly. This is because the border operates more
                    // like a shadow. When rendered over some other content (e.g. an image) the
                    // image's colors show through the border but a little darker.
                    backgroundColor="grey-5-translucent"
                    style={{bottom: -1}}
                />
            </Box>
            <TaskCommentsView
                key={taskId}
                taskId={taskId}
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
                isConnected={isConnected}
                procedures={procedures}
                subscribeToEvents={subscribeToCommentsEvents}
            />
        </Box>
    );

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
        },
        node,
    );
}

function TaskCommentsViewNavigationBarTitle({
    title,
    spaceId,
    taskId,
    isFromTaskDetailView,
}: {
    title: string;
    spaceId: SpaceId;
    taskId: TaskId;
    isFromTaskDetailView: boolean;
}) {
    const navigate = useNavigate();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isFromTaskDetailView) {
                navigate(-1);
            } else {
                navigate(`/s/${spaceId}/tasks/${taskId}`, {
                    stopPropagation: true,
                });
            }
        },
    });

    return (
        <a
            {...pressProps}
            className={sprinkles({
                cursor: "pointer",
                opacity: isPressed ? "60" : undefined,
            })}
            href={`/s/${spaceId}/tasks/${taskId}`}
            onClick={event => {
                event.preventDefault();
                pressProps.onClick?.(event);
            }}
        >
            {title}
        </a>
    );
}
