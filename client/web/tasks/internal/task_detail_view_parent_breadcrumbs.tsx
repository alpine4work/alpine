import {CaretLeft, CaretRight, Lock} from "phosphor-react";
import {ReactElement, useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/web/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {isTaskClientStoreTaskEntryDeleted} from "~/client/web/tasks/internal/is_task_client_store_task_entry_deleted.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export function TaskDetailViewParentBreadcrumbs({
    task,
    taskSubscription,
    initialFields,
}: {
    task: TaskModel | null;
    taskSubscription: TaskClientTaskSubscription | null;
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel | null;
}) {
    const navigate = useNavigate();

    const nodeStore = useMemo(() => {
        return computeStore(get => {
            const parentNodes: Array<ReactElement> = [];

            let loopParentTaskId = task?.getParent()?.taskId;
            let referencesSubscription = taskSubscription;

            if (!taskSubscription && initialFields?.parentTaskSubscription) {
                loopParentTaskId = initialFields.parentTaskSubscription.taskId;
                referencesSubscription = initialFields.parentTaskSubscription;
            }

            while (loopParentTaskId !== undefined) {
                if (referencesSubscription === null) {
                    loopParentTaskId = undefined;
                    continue;
                }

                const parentTaskEntry = get(
                    referencesSubscription.taskId === loopParentTaskId
                        ? referencesSubscription.taskEntryStore
                        : referencesSubscription.getReferencedTaskEntryStore(loopParentTaskId),
                );

                // Treat deleted parents as if they don't exist.
                if (isTaskClientStoreTaskEntryDeleted(parentTaskEntry)) {
                    loopParentTaskId = undefined;
                    continue;
                }

                // Null tasks are treated as if they're permission denied errors.
                if (parentTaskEntry.task === null) {
                    parentNodes.push(
                        <Tooltip
                            key="Private"
                            content="You don&#x2019;t have access to the task this is a subtask of"
                        >
                            <Box
                                color="grey-60"
                                height="5"
                                paddingX="1.5"
                                flexShrink="0"
                                display="flex"
                                alignItems="center"
                                gap="1"
                            >
                                <Lock size={spacing["3"]} />
                                <Box>Private</Box>
                            </Box>
                        </Tooltip>,
                    );

                    loopParentTaskId = undefined;
                    continue;
                }

                parentNodes.push(
                    <Box key={parentTaskEntry.task.id} flexShrink="1" minWidth="flex-fit">
                        <Button
                            variant="quieter"
                            height="5"
                            paddingX="1.5"
                            pressErrorTitle="Couldn&#x2019;t open task"
                            onPress={() =>
                                navigate(
                                    `/s/${parentTaskEntry.task.getSpaceId()}/tasks/${
                                        parentTaskEntry.task.id
                                    }`,
                                    {
                                        // Don't let the route open in `<PeekStack>`.
                                        stopPropagation: true,
                                    },
                                )
                            }
                        >
                            <span
                                dangerouslySetInnerHTML={{
                                    __html: serializeProsemirrorFragmentToHtml(
                                        parentTaskEntry.task.getTitle().getProsemirrorNode()
                                            .content,
                                    ),
                                }}
                            />
                        </Button>
                    </Box>,
                );

                loopParentTaskId = parentTaskEntry.task.getParent()?.taskId;
                continue;
            }

            // If the task has no parents then don't render breadcrumbs UI.
            if (parentNodes.length === 0) return null;

            // We insert parent nodes at the end of the list but we want the top level
            // parent to appear first.
            parentNodes.reverse();

            if (parentNodes.length > 4) {
                parentNodes.splice(
                    2,
                    parentNodes.length - 4,
                    <Box key="ellipsis" flexShrink="0" paddingX="1.5">
                        …
                    </Box>,
                );
            }

            return (
                <Box
                    width="full"
                    overflow="hidden"
                    marginX="-1.5"
                    paddingBottom="0.5"
                    color="grey-60"
                    display="flex"
                    alignItems="center"
                >
                    {interleaveArray(parentNodes, index => (
                        <CaretRight
                            key={index}
                            size={spacing["3"]}
                            className={sprinkles({flexShrink: "0"})}
                        />
                    ))}
                    <CaretRight size={spacing["3"]} className={sprinkles({flexShrink: "0"})} />
                </Box>
            );
        });
    }, [initialFields?.parentTaskSubscription, navigate, task, taskSubscription]);

    return useStore(nodeStore);
}

export function TaskProjectDetailViewParentBreadcrumbs({
    task,
    taskSubscription,
}: {
    task: TaskModel | null;
    taskSubscription: TaskClientTaskSubscription | null;
}) {
    const navigate = useNavigate();

    const nodeStore = useMemo(() => {
        return computeStore(get => {
            const parentNodes: Array<ReactElement> = [];

            let loopTask = task;
            while (loopTask !== null) {
                const parent = loopTask.getParent();
                if (taskSubscription === null || parent === null) {
                    loopTask = null;
                    continue;
                }

                const parentTaskEntry = get(
                    taskSubscription.getReferencedTaskEntryStore(parent.taskId),
                );

                // Treat deleted parents as if they don't exist.
                if (isTaskClientStoreTaskEntryDeleted(parentTaskEntry)) {
                    loopTask = null;
                    continue;
                }

                // Null tasks are treated as if they're permission denied errors.
                if (parentTaskEntry.task === null) {
                    parentNodes.push(
                        <Tooltip
                            key="Private"
                            content="You don&#x2019;t have access to the task this is a subtask of"
                        >
                            <Box
                                color="grey-60"
                                height="5"
                                paddingX="1.5"
                                flexShrink="0"
                                display="flex"
                                alignItems="center"
                                gap="1"
                            >
                                <Lock size={spacing["3"]} />
                                <Box>Private</Box>
                            </Box>
                        </Tooltip>,
                    );

                    loopTask = null;
                    continue;
                }

                parentNodes.push(
                    <Box
                        key={parentTaskEntry.task.id}
                        flexShrink="1"
                        minWidth="flex-fit"
                        maxWidth="64"
                    >
                        <Button
                            variant="quieter"
                            height="5"
                            maxWidth="full"
                            paddingX="1.5"
                            pressErrorTitle="Couldn&#x2019;t open task"
                            onPress={() =>
                                navigate(
                                    `/s/${parentTaskEntry.task.getSpaceId()}/tasks/${
                                        parentTaskEntry.task.id
                                    }`,
                                    {
                                        // Don't let the route open in `<PeekStack>`.
                                        stopPropagation: true,
                                    },
                                )
                            }
                        >
                            <span
                                dangerouslySetInnerHTML={{
                                    __html: serializeProsemirrorFragmentToHtml(
                                        parentTaskEntry.task.getTitle().getProsemirrorNode()
                                            .content,
                                    ),
                                }}
                            />
                        </Button>
                    </Box>,
                );

                loopTask = parentTaskEntry.task;
                continue;
            }

            // If the task has no parents then don't render breadcrumbs UI.
            if (parentNodes.length === 0) return null;

            if (parentNodes.length > 1) {
                parentNodes.splice(
                    0,
                    parentNodes.length - 1,
                    <Box
                        key="ellipsis"
                        flexShrink="0"
                        paddingX="1.5"
                        fontStyle="normal"
                        fontSize="75"
                        userSelect="none"
                    >
                        …
                    </Box>,
                );
            }

            return (
                <Box
                    flexShrink="0"
                    overflow="hidden"
                    paddingLeft="1"
                    color="grey-60"
                    display="flex"
                    alignItems="center"
                >
                    <CaretLeft size={spacing["3"]} className={sprinkles({flexShrink: "0"})} />
                    {interleaveArray(parentNodes, index => (
                        <CaretLeft
                            key={index}
                            size={spacing["3"]}
                            className={sprinkles({flexShrink: "0"})}
                        />
                    ))}
                </Box>
            );
        });
    }, [navigate, task, taskSubscription]);

    return useStore(nodeStore);
}
