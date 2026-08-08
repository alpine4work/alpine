import {CaretLeft, CaretRight} from "phosphor-react";
import {ReactElement, useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {shouldRenderSiteBreadcrumb} from "~/client/web/sites/breadcrumb/should_render_site_breadcumb.js";
import {useOpenSiteBreadcrumb} from "~/client/web/sites/breadcrumb/use_open_site_breadcrumb.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/web/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {isTaskClientStoreTaskEntryDeleted} from "~/client/web/tasks/internal/is_task_client_store_task_entry_deleted.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
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
    const routeLayout = useRouteLayout();
    const siteContext = useSiteContextIfExists();
    const openSite = useOpenSiteBreadcrumb();
    const peekContext = usePeekContext();

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
                                height="5"
                                paddingX="1.5"
                                flexShrink="0"
                                display="flex"
                                alignItems="center"
                                gap="1"
                            >
                                <LockBoldFillIcon size={spacing["2.5"]} />
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
                            variant="quietest"
                            height="5"
                            paddingX="1.5"
                            pressErrorTitle="Couldn&#x2019;t open task"
                            onPress={() =>
                                navigate(`/task/${parentTaskEntry.task.id}`, {
                                    // Don't let the route open in `<PeekStack>`.
                                    stopPropagation: true,
                                })
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

            // We insert parent nodes at the end of the list but we want the top level parent
            // to appear first.
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

            const taskAccessPolicy = task?.getAccessPolicy();
            // In a narrow layout, prepend the site as the top breadcrumb when the task is in a
            // site. This merges what used to be a separate `<SiteBreadcrumbChip>` stacked
            // above the parent-task breadcrumb into a single chain — the site reads as just
            // another ancestor of the current task, no extra row.
            if (
                shouldRenderSiteBreadcrumb({
                    routeLayout,
                    peekContext,
                    siteContext,
                    accessPolicy: taskAccessPolicy ?? null,
                })
            ) {
                assert(siteContext);
                const site = siteContext.tree.site;

                // IMPORTANT: This design also exists in `navigation_bar_content.tsx` under
                // `NavigationBarTitleBreadcrumbButton` and `SiteBreadcrumbChip`. When updating
                // this component, also update those components.
                parentNodes.unshift(
                    <Box key={`site:${site.id}`} flexShrink="1" minWidth="flex-fit" maxWidth="full">
                        <Button
                            variant="quietest"
                            height="5"
                            paddingX="1.5"
                            pressErrorTitle="Couldn&#x2019;t open site"
                            onPress={openSite}
                        >
                            {site.name}
                        </Button>
                    </Box>,
                );
            }

            // If the task has no parents AND we didn't add a site at the top, don't render any
            // breadcrumbs UI.
            if (parentNodes.length === 0) return null;

            return (
                <Box
                    width="full"
                    overflow="hidden"
                    marginX="-1.5"
                    paddingBottom="0.5"
                    color="grey-50"
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
    }, [
        initialFields?.parentTaskSubscription,
        navigate,
        openSite,
        routeLayout,
        siteContext,
        peekContext,
        task,
        taskSubscription,
    ]);

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
                                height="5"
                                paddingX="1.5"
                                flexShrink="0"
                                display="flex"
                                alignItems="center"
                                gap="1"
                            >
                                <LockBoldFillIcon size={spacing["2.5"]} />
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
                            variant="quietest"
                            height="5"
                            maxWidth="full"
                            paddingX="1.5"
                            pressErrorTitle="Couldn&#x2019;t open task"
                            onPress={() =>
                                navigate(`/task/${parentTaskEntry.task.id}`, {
                                    // Don't let the route open in `<PeekStack>`.
                                    stopPropagation: true,
                                })
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
                    color="grey-50"
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
