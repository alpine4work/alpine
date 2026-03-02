import {CaretDown, SpinnerGap} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {
    Key,
    Memo,
    MutableRefObject,
    ReactNode,
    Ref,
    RefObject,
    forwardRef,
    memo,
    useCallback,
    useMemo,
    useRef,
    useState,
} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {maintainTextInputVisibility} from "~/client/web/design/use_text_input_visibility_maintainer.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {TaskRowShimmer} from "~/client/web/shimmer/task_row_shimmer.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    pulseAnimationClassName,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {
    taskGridViewExplicitLoadMoreButtonHeight,
    taskGridViewMoreUnloadedTasksHeight,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/web/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientReadonlyStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {TaskGridViewCapabilities} from "~/client/web/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewColumnHeader as TaskGridViewActualColumnHeader} from "~/client/web/tasks/internal/task_grid_view_column_header.js";
import {TaskGridViewTaskKey} from "~/client/web/tasks/internal/task_grid_view_task_key.js";
import {
    TaskGridViewVirtualizedListEvents,
    TaskGridViewVirtualizedListViewRef,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {TaskRowView, TaskRowViewRef} from "~/client/web/tasks/internal/task_row_view.js";
import {TaskRowViewPaddingBottom} from "~/client/web/tasks/internal/task_row_view_padding_bottom.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {undefinedStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

export const TaskGridViewColumnHeaderMemo = memo(forwardRef(TaskGridViewColumnHeader));

function TaskGridViewColumnHeader(
    {
        hasColumns,
        withoutAssigneeField,
        titleFieldLabel,
        columnHeaderControls,
        minHeight,
        offset,
        shouldRenderWithRelativePositioning,
    }: {
        hasColumns: boolean;
        withoutAssigneeField: boolean;
        titleFieldLabel: string | undefined;
        columnHeaderControls: Memo<{minHeight: number; node: ReactNode}> | null;
        minHeight: number;
        offset: number;
        shouldRenderWithRelativePositioning: boolean;
    },
    virtualizedItemRef: Ref<HTMLDivElement>,
) {
    const columnHeaderContainerRef = useRef<HTMLDivElement>(null);

    // Collection cell overlay renders above this `z-index` whereas `<TaskRowView>`
    // with `z-index` updated via `<TaskRowViewDroppable>` renders below this
    // `z-index`.
    const zIndex = 45;

    return (
        <Box
            ref={columnHeaderContainerRef}
            style={
                shouldRenderWithRelativePositioning
                    ? {
                          position: "relative",
                          zIndex,
                      }
                    : {
                          position: "absolute",
                          top: offset,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          zIndex,
                      }
            }
            pointerEvents="none"
        >
            <Box
                ref={virtualizedItemRef}
                // Our header is not sticky when rendered with relative positioning.
                position={!shouldRenderWithRelativePositioning ? "sticky" : "relative"}
                left="0"
                right="0"
                pointerEvents="auto"
                style={{
                    top: !shouldRenderWithRelativePositioning ? 0 : undefined,
                    minHeight,
                }}
            >
                <Box zIndex="-10" position="absolute" inset="0" backgroundColor="grey-0">
                    <Box
                        position="absolute"
                        left={screenPaddingX}
                        right={screenPaddingX}
                        height="border"
                        backgroundColor="grey-5-translucent"
                        style={{bottom: -1}}
                    />
                </Box>
                <OverlayScopeContextProvider
                // Provide an overlay scope within our sticky element which has a `zIndex` that
                // renders over overlays.
                >
                    {columnHeaderControls && (
                        <Box style={{minHeight: columnHeaderControls.minHeight}}>
                            {columnHeaderControls.node}
                        </Box>
                    )}
                    {hasColumns && (
                        <TaskGridViewActualColumnHeader
                            withoutAssigneeField={withoutAssigneeField}
                            titleFieldLabel={titleFieldLabel}
                        />
                    )}
                </OverlayScopeContextProvider>
            </Box>
        </Box>
    );
}

export const TaskGridViewMoreUnloadedTasksMemo = memo(function TaskGridViewMoreUnloadedTasksMemo({
    capabilities,
    rowMaxWidth,
    withoutBorderTop,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    rowMaxWidth: Spacing | null;
    withoutBorderTop: boolean;
    focusPreviousTaskTitleEnd: Memo<(key: string) => void>;
    focusPreviousTaskTitleAll: Memo<(key: string) => void>;
}) {
    return (
        <Box style={{height: taskGridViewMoreUnloadedTasksHeight}}>
            <TaskGridViewRowShimmer
                capabilities={capabilities}
                rowMaxWidth={rowMaxWidth}
                randomSeed="MoreUnloadedTasks"
                index={0}
                indentation={0}
                withoutBorderTop={withoutBorderTop}
                focusPreviousTaskTitleEnd={() => focusPreviousTaskTitleEnd("MoreUnloadedTasks")}
                focusPreviousTaskTitleAll={() => focusPreviousTaskTitleAll("MoreUnloadedTasks")}
            />
            <TaskGridViewRowShimmer
                capabilities={capabilities}
                rowMaxWidth={rowMaxWidth}
                randomSeed="MoreUnloadedTasks"
                index={1}
                indentation={0}
                withoutBorderTop={false}
                focusPreviousTaskTitleEnd={() => focusPreviousTaskTitleEnd("MoreUnloadedTasks")}
                focusPreviousTaskTitleAll={() => focusPreviousTaskTitleAll("MoreUnloadedTasks")}
            />
            <TaskGridViewRowShimmer
                capabilities={capabilities}
                rowMaxWidth={rowMaxWidth}
                randomSeed="MoreUnloadedTasks"
                index={2}
                indentation={0}
                withoutBorderTop={false}
                focusPreviousTaskTitleEnd={() => focusPreviousTaskTitleEnd("MoreUnloadedTasks")}
                focusPreviousTaskTitleAll={() => focusPreviousTaskTitleAll("MoreUnloadedTasks")}
            />
            <Box
                display="flex"
                justifyContent="center"
                color="grey-60"
                paddingY="4"
                cursor={!capabilities.isReadOnly ? "text" : undefined}
                {...useOutOfBoundsClickSelection({
                    isDisabled: capabilities.isReadOnly,
                    accept: () => true,
                    onSelect: () => focusPreviousTaskTitleEnd("MoreUnloadedTasks"),
                    onSelectAll: () => focusPreviousTaskTitleAll("MoreUnloadedTasks"),
                })}
            >
                <SpinnerGap className={spinAnimationClassName} size={spacing["6"]} weight="light" />
            </Box>
        </Box>
    );
});

export const TaskGridViewExplicitLoadMoreButtonMemo = memo(
    function TaskGridViewExplicitLoadMoreButtonMemo({
        rowMaxWidth,
        withoutBorderTop,
        loadedTaskCount,
        totalTaskCount,
        loadMoreTasksLimit,
        query,
    }: {
        rowMaxWidth: Spacing | null;
        withoutBorderTop: boolean;
        loadedTaskCount: number;
        totalTaskCount: number;
        loadMoreTasksLimit: number;
        query: TaskClientQuery | null;
    }) {
        const [isPending, setIsPending] = useState(false);
        const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

        const {isPressed, pressProps} = usePress({
            onPress: () => {
                if (!query) return;
                if (isPending) return;

                setIsPending(true);

                query.loadMoreTasks(loadMoreTasksLimit);

                // We assume errors are handled elsewhere.
                void query.waitForLoadMoreTasks().finally(() => {
                    setIsPending(false);
                });
            },
        });

        return (
            <Box
                position="relative"
                zIndex="0"
                style={{height: taskGridViewExplicitLoadMoreButtonHeight}}
            >
                <Box
                    position="absolute"
                    inset="0"
                    zIndex="10"
                    style={{
                        bottom: -1,
                        background: `linear-gradient(to bottom, rgb(from ${backgroundColorVar} r g b / 0%), ${backgroundColorVar} ${spacing["20"]})`,
                    }}
                />
                <Box position="absolute" zIndex="20" top="0" left="0" right="0">
                    <Box
                        {...pressProps}
                        maxWidth={rowMaxWidth ?? undefined}
                        marginX="auto"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{height: addRemLengths(taskRowViewMinHeight, taskRowViewMinHeight)}}
                    >
                        <FocusRing>
                            <Box
                                tabIndex={0}
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                gap="1.5"
                                cursor="pointer"
                                opacity={isPressed ? "60" : undefined}
                            >
                                <Spacer space="3" />
                                <CaretDown size={spacing["3"]} weight="bold" />
                                <Box fontStyle="semi-bold" color="grey-90">
                                    See more ({totalTaskCount - loadedTaskCount} remaining)
                                </Box>
                                {shouldShowPendingSpinner ? (
                                    <SpinnerGap
                                        className={spinAnimationClassName}
                                        size={spacing["3"]}
                                        color={colorSchemeVars["grey-60"]}
                                    />
                                ) : (
                                    <Spacer space="3" />
                                )}
                            </Box>
                        </FocusRing>
                    </Box>
                </Box>
                <Box maxWidth={rowMaxWidth ?? undefined} marginX="center" opacity="60">
                    <TaskRowShimmer
                        width="64"
                        indentation={0}
                        withoutBorderTop={withoutBorderTop}
                        // We're not actively loading these tasks so a shimmer doesn't make sense.
                        withoutPulseAnimation={true}
                    />
                    <TaskRowShimmer
                        width="64"
                        indentation={0}
                        // We're not actively loading these tasks so a shimmer doesn't make sense.
                        withoutPulseAnimation={true}
                    />
                </Box>
            </Box>
        );
    },
);

export const TaskGridViewDecorativeGhostTaskMemo = memo(
    function TaskGridViewDecorativeGhostTaskMemo({
        rowMaxWidth,
        isInert,
        structuralItemKeyPrefix,
        relativeItemIndex,
        isFirstRow,
        withoutBorderTopIfFirstRow,
        paddingTop,
        withPaddingBottom,
        hasNextGridView,
        hasDecorativeGhostRowBackground,
        focusPreviousTaskTitleEnd,
        focusPreviousTaskTitleAll,
    }: {
        rowMaxWidth: Spacing | null;
        isInert: boolean;
        structuralItemKeyPrefix: string;
        relativeItemIndex: number;
        isFirstRow: boolean;
        withoutBorderTopIfFirstRow: boolean;
        paddingTop?: RemLength;
        withPaddingBottom: boolean;
        hasNextGridView: boolean;
        hasDecorativeGhostRowBackground: boolean;
        focusPreviousTaskTitleEnd: Memo<(key: string) => void> | undefined;
        focusPreviousTaskTitleAll: Memo<(key: string) => void> | undefined;
    }) {
        const focusTitleEnd = () => {
            focusPreviousTaskTitleEnd?.(
                `${structuralItemKeyPrefix}DecorativeGhostTask:${relativeItemIndex}`,
            );
        };

        const focusTitleAll = () => {
            focusPreviousTaskTitleAll?.(
                `${structuralItemKeyPrefix}DecorativeGhostTask:${relativeItemIndex}`,
            );
        };

        return (
            <>
                <Box
                    paddingX={screenPaddingX}
                    maxWidth={rowMaxWidth ?? undefined}
                    marginX="center"
                    style={{paddingTop}}
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    cursor={!isInert ? "text" : undefined}
                    {...useOutOfBoundsClickSelection({
                        isDisabled: isInert,
                        onSelect: focusTitleEnd,
                        onSelectAll: focusTitleAll,
                    })}
                >
                    <Box
                        width="full"
                        height={taskRowViewMinHeight}
                        pointerEvents="none"
                        style={{
                            // Draw the top and bottom border with a shadow so it:
                            //
                            // 1. Doesn't add 2px to layout
                            // 2. Adjacent borders share the same space so we don't get 2px dividers
                            boxShadow:
                                // The column header in a grid view renders a semi-translucent grey border. To
                                // avoid drawing a border darker than `grey-5` at the top of the screen if this
                                // is the first row in a grid with columns then only render a bottom border.
                                isFirstRow && withoutBorderTopIfFirstRow
                                    ? `0 1px 0 0 ${colorSchemeVars["grey-5"]}`
                                    : `0 1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                        }}
                    />
                </Box>
                {withPaddingBottom && (
                    <TaskRowViewPaddingBottom
                        rowMaxWidth={rowMaxWidth}
                        isInert={isInert}
                        hasNextGridView={hasNextGridView}
                        hasDecorativeGhostRowBackground={hasDecorativeGhostRowBackground}
                        focusTitleEnd={focusTitleEnd}
                        focusTitleAll={focusTitleAll}
                    />
                )}
            </>
        );
    },
);

export const TaskGridViewUnloadedChildTaskMemo = memo(function TaskGridViewUnloadedChildTaskMemo({
    capabilities,
    rowMaxWidth,
    parentGridKey,
    unloadedChildTaskIndex,
    indentation,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    rowMaxWidth: Spacing | null;
    parentGridKey: TaskGridViewTaskKey;
    unloadedChildTaskIndex: number;
    indentation: number;
    focusPreviousTaskTitleEnd: Memo<(key: string) => void>;
    focusPreviousTaskTitleAll: Memo<(key: string) => void>;
}) {
    return (
        <TaskGridViewRowShimmer
            capabilities={capabilities}
            rowMaxWidth={rowMaxWidth}
            randomSeed={parentGridKey}
            index={unloadedChildTaskIndex}
            indentation={indentation}
            withoutBorderTop={false}
            focusPreviousTaskTitleEnd={() =>
                focusPreviousTaskTitleEnd(
                    `UnloadedChildTask:${parentGridKey}-${unloadedChildTaskIndex}`,
                )
            }
            focusPreviousTaskTitleAll={() =>
                focusPreviousTaskTitleAll(
                    `UnloadedChildTask:${parentGridKey}-${unloadedChildTaskIndex}`,
                )
            }
        />
    );
});

const taskRowShimmerWidths: Array<Spacing> = [
    // 2x frequency
    "32",
    "32",
    // 3x frequency
    "48",
    "48",
    "48",
    // 4x frequency
    "64",
    "64",
    "64",
    "64",
    // 6x frequency
    "96",
    "96",
    "96",
    "96",
    "96",
    "96",
    // 2x frequency
    "128",
    "128",
    // 1x frequency
    "160",
];

const taskRowShimmerRagRights: Array<Spacing> = [
    // 6x frequency
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    // 4x frequency
    "2",
    "2",
    "2",
    "2",
    // 2x frequency
    "4",
    "4",
    // 1x frequency
    "6",
    // 1x frequency
    "10",
];

function TaskGridViewRowShimmer({
    capabilities,
    rowMaxWidth,
    randomSeed,
    index,
    indentation,
    withoutBorderTop,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
    withoutPulseAnimation,
}: {
    capabilities: TaskGridViewCapabilities;
    rowMaxWidth: Spacing | null;
    randomSeed: string;
    index: number;
    indentation: number;
    withoutBorderTop: boolean;
    focusPreviousTaskTitleEnd: () => void;
    focusPreviousTaskTitleAll: () => void;
    withoutPulseAnimation?: boolean;
}) {
    const shimmerRef = useRef<HTMLDivElement>(null);
    const stableRandom = new StableRandom(`TaskRowShimmer:${randomSeed}`);

    const width =
        taskRowShimmerWidths[
            stableRandom.randomInteger("size", index, 0, taskRowShimmerWidths.length)
        ]!;

    const ragRight =
        taskRowShimmerRagRights[
            stableRandom.randomInteger("ragRight", index, 0, taskRowShimmerRagRights.length)
        ]!;

    // Set shimmer start times to the same value. That way shimmers rendered at
    // different times (because they entered the virtualization window) will have
    // the same animation timeline.
    useLayoutEffectWithoutServerSideWarning(() => {
        const shimmerElement = assertExists(shimmerRef.current);
        for (const element of shimmerElement.getElementsByClassName(pulseAnimationClassName)) {
            for (const animation of element.getAnimations()) {
                animation.startTime = 0;
            }
        }
    }, []);

    return (
        <Box
            ref={shimmerRef}
            maxWidth={rowMaxWidth ?? undefined}
            marginX="center"
            cursor={!capabilities.isReadOnly ? "text" : undefined}
            {...useOutOfBoundsClickSelection({
                isDisabled: capabilities.isReadOnly,
                accept: () => true,
                onSelect: focusPreviousTaskTitleEnd,
                onSelectAll: focusPreviousTaskTitleAll,
            })}
        >
            <TaskRowShimmer
                width={width}
                ragRight={ragRight}
                indentation={indentation}
                withoutBorderTop={withoutBorderTop}
                withoutPulseAnimation={withoutPulseAnimation}
            />
        </Box>
    );
}

export const TaskRowViewMemo = memo(function TaskRowViewMemo({
    capabilities,
    maxGridExpandableTaskDepth,
    stateKey,
    store,
    rootQuery,
    isRootQueryManuallySorted,
    affinityManager,
    query,
    gridKey,
    cursor,
    ghostTaskId,
    parents,
    rowMaxWidth,
    disableExpensiveFeaturesDuringScroll,
    isFirstRow,
    withoutBorderTopIfFirstRow,
    isFirstTaskInQuery,
    nextIndentation,
    titlePlaceholder,
    viewRef,
    events,
    taskRowByGridKeyRef,
    onLayoutEffectCallbacksRef,
    getAreChildTasksExpandedStore,
    toggleAreChildTasksExpanded,
    duplicateTaskAndAllChildren,
    withoutPaddingLeft,
    withPaddingBottom,
    hasNextGridView,
    hasDecorativeGhostRowBackground,
    mobileKeyboardToolbarPortalRef,
}: {
    capabilities: Memo<TaskGridViewCapabilities>;
    maxGridExpandableTaskDepth: number;
    stateKey: Key | undefined;
    // Takes a readonly store so TypeScript errors when you try to call
    // `store.commitTaskActionTransaction()`. You should call
    // `events.commitActionTransaction()` instead.
    store: TaskClientReadonlyStore;
    rootQuery: TaskClientQuery | null;
    isRootQueryManuallySorted: boolean;
    affinityManager: TaskClientStoreSearchAffinityManager;
    query: TaskClientQuery | null;
    gridKey: TaskGridViewTaskKey;
    cursor: TaskQuerySortCursor | null;
    ghostTaskId?: TaskId | null;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    rowMaxWidth: Spacing | null;
    disableExpensiveFeaturesDuringScroll: boolean;
    isFirstRow: boolean;
    withoutBorderTopIfFirstRow: boolean;
    isFirstTaskInQuery: boolean;
    nextIndentation: number;
    titlePlaceholder?: string;
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
    events: TaskGridViewVirtualizedListEvents;
    taskRowByGridKeyRef: MutableRefObject<Map<TaskGridViewTaskKey, TaskRowViewRef>>;
    onLayoutEffectCallbacksRef: MutableRefObject<Array<() => void>>;
    getAreChildTasksExpandedStore: Memo<
        (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>
    >;
    toggleAreChildTasksExpanded: Memo<
        (taskPath: ReadonlyArray<TaskId>, options?: {onFinish?: () => void}) => void
    >;
    duplicateTaskAndAllChildren: (
        taskId: TaskId,
        {undoManager}: {undoManager: TaskClientStoreUndoManager},
    ) => Promise<{taskId: TaskId}>;
    withoutPaddingLeft?: boolean;
    withPaddingBottom?: boolean;
    hasNextGridView: boolean;
    hasDecorativeGhostRowBackground: boolean;
    mobileKeyboardToolbarPortalRef: RefObject<HTMLDivElement | null>;
}) {
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const taskPath = cursor
        ? [
              ...parents.map(({cursor}) => getTaskQuerySortCursorTaskId(cursor)),
              getTaskQuerySortCursorTaskId(cursor),
          ]
        : null;

    const taskId = taskPath ? taskPath[taskPath.length - 1]! : null;
    const rootParentTaskId = taskPath ? taskPath[0]! : null;

    const isQueryManuallySorted = query !== rootQuery || isRootQueryManuallySorted;

    const areChildTasksExpandedStore = taskPath
        ? getAreChildTasksExpandedStore(taskPath)
        : undefinedStore;

    const undoManager: TaskClientStoreUndoManager = useMemo(
        () => ({
            pushUndoStackEntry: ({undoActions, removedFromQueries, leaseId, release}) => {
                events.pushUndoStackEntry({
                    type: "Actions",
                    rootParentTaskId: rootParentTaskId ?? assertExists(ghostTaskId),
                    extra: null,
                    undoActions,
                    removedFromQueries,
                    leaseId,
                    release,
                });
            },
        }),
        [events, ghostTaskId, rootParentTaskId],
    );

    // If this is the root query then the new task needs to be added to that query.
    // Otherwise we want to add the new task at the same indentation level that our
    // task is currently at.
    const getMoveTaskToQueryActions: (
        taskId: TaskId,
        position:
            | {type: "Start"}
            | {type: "End"}
            | {type: "Above"; taskId: TaskId}
            | {type: "Below"; taskId: TaskId}
            | {type: "Position"; position: TaskPosition},
    ) => {
        actions: Array<TaskActionModel>;
        position: TaskPosition;
    } | null =
        query === rootQuery
            ? events.getMoveTaskToRootQueryActions
            : (newTaskId, position) => {
                  const time1 = store.clock.now();
                  const time2 = store.clock.now();

                  // `query` can only be null if `rootQuery` is null.
                  assert(query !== null);

                  const actualPosition =
                      position.type !== "Position"
                          ? getNewTaskPositionForQuerySortedByPosition(time2, query, position)
                          : position.position;

                  const actions: Array<TaskActionModel> = [
                      {
                          type: "UpdateTask",
                          time: time1,
                          taskId: newTaskId,
                          taskAction: {
                              type: "UpdateParentTaskId",
                              parentTaskId: getTaskQuerySortCursorTaskId(
                                  assertExists(parents[parents.length - 1]).cursor,
                              ),
                          },
                      },
                      {
                          type: "UpdateTask",
                          time: time2,
                          taskId: newTaskId,
                          taskAction: {
                              type: "UpdateParentPosition",
                              parentPosition: actualPosition,
                          },
                      },
                  ];

                  return {
                      actions,
                      position: actualPosition,
                  };
              };

    const getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskActionModel> =
        query === rootQuery
            ? events.getMaybeRemoveTaskFromRootQueryActions
            : taskId => [
                  {
                      type: "UpdateTask",
                      time: store.clock.now(),
                      taskId,
                      taskAction: {
                          type: "UpdateParentTaskId",
                          parentTaskId: null,
                      },
                  },
              ];

    const createTaskAbove = () => {
        // Hitting enter to create a task near the current row only makes sense in a
        // manually sorted query. We don't have control of task order in an
        // auto-sorted query.
        if (!isQueryManuallySorted) return;

        // Currently, accounts without space access can't edit tasks. The max
        // permission level of `urlGrant` is `View`.
        assert(currentAccount);

        const newTaskId = generateId<TaskId>();

        disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(newTaskId);

        events.commitActionTransaction(
            () => [
                {
                    type: "UpdateTask",
                    time: store.clock.now(),
                    taskId: newTaskId,
                    taskAction: {
                        type: "Create",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                    },
                },
                ...(getMoveTaskToQueryActions(
                    newTaskId,
                    taskId ? {type: "Above", taskId} : {type: "End"},
                )?.actions ?? []),
            ],
            {undoManager},
        );
    };

    const createTaskBelowAndFocus = () => {
        // Hitting enter to create a task near the current row only makes sense in a
        // manually sorted query. We don't have control of task order in an
        // auto-sorted query.
        if (!isQueryManuallySorted) return;

        // Currently, accounts without space access can't edit tasks. The max
        // permission level of `urlGrant` is `View`.
        assert(currentAccount);

        if (!taskId) {
            const newTaskId = generateId<TaskId>();

            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(newTaskId);

            events.commitActionTransaction(
                () => [
                    {
                        type: "UpdateTask",
                        time: store.clock.now(),
                        taskId: newTaskId,
                        taskAction: {
                            type: "Create",
                            creatorId: currentAccount.id,
                            creatorTimeZone: timeZone,
                        },
                    },
                    ...(getMoveTaskToQueryActions(newTaskId, {type: "Start"})?.actions ?? []),
                ],
                {undoManager},
            );

            onLayoutEffectCallbacksRef.current.push(() => {
                // This may call `flushSync()` which can't be called during React lifecycle
                // methods. So we wrap in a microtask.
                scheduleMicrotask(() => {
                    events.focusTaskTitleStart(newTaskId);

                    // Make sure the new task is visible...
                    if (
                        document.activeElement instanceof HTMLElement &&
                        isTextInputElement(document.activeElement)
                    ) {
                        maintainTextInputVisibility(document.activeElement);
                    }
                });
            });
            return;
        }

        // If `query` is null then we only render a ghost task (null `taskId`).
        assert(query !== null);

        const task = query.getLoadedTaskSnapshot(taskId);

        const newTaskId = generateId<TaskId>();

        // If we have a task with children, the children are expanded, and the children
        // are loaded then to create a task below this task we need to create it as the
        // first child of this task.
        //
        // Otherwise we fall down to the branch below and create a task below ours in
        // our query.
        if (
            task.getChildTaskCount() > 0 &&
            parents.length < maxGridExpandableTaskDepth &&
            areChildTasksExpandedStore.getSnapshot()
        ) {
            const childrenQuery = query.store.getTaskChildrenQueryStore(task.id).getSnapshot();
            if (childrenQuery && childrenQuery.loadedStateStore.getSnapshot() !== "Unloaded") {
                const time1 = query.store.clock.now();
                const time2 = query.store.clock.now();
                const time3 = query.store.clock.now();

                let position: TaskPosition = {
                    orderTime: time3,
                    orderKey: initialOrderKey,
                };

                const firstChildCursor = childrenQuery.taskOrderStore.getSnapshot().begin.key;

                const firstChildPosition = firstChildCursor
                    ? childrenQuery
                          .getLoadedTaskSnapshot(getTaskQuerySortCursorTaskId(firstChildCursor))
                          .getParent()?.position
                    : null;

                if (firstChildPosition) {
                    position = {
                        orderTime: firstChildPosition.orderTime,
                        orderKey: generateOrderKeyBetween(null, firstChildPosition.orderKey),
                    };
                }

                disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(newTaskId);

                events.commitActionTransaction(
                    () => [
                        {
                            type: "UpdateTask",
                            time: time1,
                            taskId: newTaskId,
                            taskAction: {
                                type: "Create",
                                creatorId: currentAccount.id,
                                creatorTimeZone: timeZone,
                            },
                        },
                        {
                            type: "UpdateTask",
                            time: time2,
                            taskId: newTaskId,
                            taskAction: {
                                type: "UpdateParentTaskId",
                                parentTaskId: taskId,
                            },
                        },
                        {
                            type: "UpdateTask",
                            time: time3,
                            taskId: newTaskId,
                            taskAction: {
                                type: "UpdateParentPosition",
                                parentPosition: position,
                            },
                        },
                    ],
                    {undoManager},
                );

                onLayoutEffectCallbacksRef.current.push(() => {
                    // This may call `flushSync()` which can't be called during React lifecycle
                    // methods. So we wrap in a microtask.
                    scheduleMicrotask(() => {
                        if (parents.length === 0) {
                            events.focusTaskTitleStart(`${task.id}-${newTaskId}`);
                        } else {
                            events.focusTaskTitleStart(
                                `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${newTaskId}`,
                            );
                        }

                        // Make sure the new task is visible...
                        if (
                            document.activeElement instanceof HTMLElement &&
                            isTextInputElement(document.activeElement)
                        ) {
                            maintainTextInputVisibility(document.activeElement);
                        }
                    });
                });
                return;
            }
        }

        disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(newTaskId);

        events.commitActionTransaction(
            () => [
                {
                    type: "UpdateTask",
                    time: query.store.clock.now(),
                    taskId: newTaskId,
                    taskAction: {
                        type: "Create",
                        creatorId: currentAccount.id,
                        creatorTimeZone: timeZone,
                    },
                },
                ...(getMoveTaskToQueryActions(newTaskId, {type: "Below", taskId})?.actions ?? []),
            ],
            {undoManager},
        );

        onLayoutEffectCallbacksRef.current.push(() => {
            // This may call `flushSync()` which can't be called during React lifecycle
            // methods. So we wrap in a microtask.
            scheduleMicrotask(() => {
                if (parents.length === 0) {
                    events.focusTaskTitleStart(newTaskId);
                } else {
                    events.focusTaskTitleStart(
                        `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${newTaskId}`,
                    );
                }

                // Make sure the new task is visible...
                if (
                    document.activeElement instanceof HTMLElement &&
                    isTextInputElement(document.activeElement)
                ) {
                    maintainTextInputVisibility(document.activeElement);
                }
            });
        });
    };

    const nestWithPreviousTaskRowIfExistsAndExpand = (titleSelection: Selection) => {
        // Hitting tab to indent only makes sense if the query is manually sorted.
        if (!isQueryManuallySorted) return;

        if (!cursor) return;

        // Don't nest tasks if it would exceed the maximum task depth. While we allow
        // infinite nesting, the UI can only support showing nesting to a certain
        // level.
        if (parents.length >= maxGridExpandableTaskDepth) return;

        const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(`Task:${gridKey}`));

        const state = events.getState();
        const itemCountBeforeState = events.getItemCountBeforeState();

        for (let previousItemIndex = itemIndex - 1; previousItemIndex >= 0; previousItemIndex--) {
            const indentation = parents.length;

            // Can't tab into the top ghost task.
            const stateItemIndex = previousItemIndex - itemCountBeforeState;
            if (stateItemIndex < 0) break;

            const previousItem = state.getItem(stateItemIndex);
            const previousIndentation = previousItem.parents.length;

            if (previousIndentation > indentation) continue;
            if (previousIndentation < indentation) break;

            if (previousItem.type !== "Task") break;

            const taskId = getTaskQuerySortCursorTaskId(cursor);
            const previousTaskId = getTaskQuerySortCursorTaskId(previousItem.cursor);

            const nest = () => {
                disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

                const maybeRemoveActions =
                    query === rootQuery
                        ? events.getMaybeRemoveTaskFromRootQueryActions(taskId)
                        : [];

                events.commitActionTransaction(
                    () => [
                        {
                            type: "UpdateTask",
                            time: store.clock.now(),
                            taskId,
                            taskAction: {
                                type: "UpdateParentTaskId",
                                parentTaskId: previousTaskId,
                            },
                        },

                        // If we are indenting at the root of our query then we want to remove the task
                        // from the query root since it lives in its parent task now.
                        //
                        // Must come first since if we're removing a task from its parent then our
                        // following action needs to set the parent again.
                        //
                        // Order is important! We create these actions before `UpdateParentTaskId` so
                        // they have earlier timestamps but put them later in the array so our serial
                        // action authorization check doesn't remove our access to the task before
                        // `UpdateParentTaskId` which grants it back.
                        ...maybeRemoveActions,
                    ],
                    {undoManager},
                );

                onLayoutEffectCallbacksRef.current.push(() => {
                    // This may call `flushSync()` which can't be called during React lifecycle
                    // methods. So we wrap in a microtask.
                    scheduleMicrotask(() => {
                        if (previousItem.parents.length === 0) {
                            events.focusTaskTitleSelection(
                                `${previousTaskId}-${taskId}`,
                                titleSelection,
                            );
                        } else {
                            events.focusTaskTitleSelection(
                                `${getTaskQuerySortCursorTaskId(
                                    previousItem.parents[0]!.cursor,
                                )}-${taskId}`,
                                titleSelection,
                            );
                        }
                    });
                });
            };

            const previousTaskPath = [
                ...previousItem.parents.map(({cursor}) => getTaskQuerySortCursorTaskId(cursor)),
                getTaskQuerySortCursorTaskId(previousItem.cursor),
            ];

            // Expand our new parent task if it's not already expanded.
            if (getAreChildTasksExpandedStore(previousTaskPath).getSnapshot()) {
                nest();
            } else {
                toggleAreChildTasksExpanded(previousTaskPath, {
                    onFinish: nest,
                });
            }
            break;
        }
    };

    const unnestTaskIfNestedRow = (titleSelection: Selection) => {
        if (!cursor || parents.length === 0) return;

        // If `query` is null then we only render a ghost task (null `cursor`).
        assert(query !== null);

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        const oldParentTaskId = query.getLoadedTaskSnapshot(taskId).getParent()?.taskId ?? null;
        if (!oldParentTaskId) return;

        const newParentTaskId =
            parents.length > 1
                ? getTaskQuerySortCursorTaskId(parents[parents.length - 2]!.cursor)
                : null;

        // If our task no longer has any parent then move it into our root query.
        if (!newParentTaskId) {
            // Hitting shift-tab to dedent only makes sense if the query is manually sorted.
            if (!isRootQueryManuallySorted) return;

            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

            const removeAction: TaskActionModel = {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: null,
                },
            };

            events.commitActionTransaction(
                () => [
                    ...(events.getMoveTaskToRootQueryActions(taskId, {
                        type: "Below",
                        taskId: oldParentTaskId,
                    })?.actions ?? []),

                    // Order is important! Removing the task from its parent may remove our access
                    // to the task resulting in an authorization error. Perform our update that puts
                    // us in the right spot first to make sure we maintain permission to access
                    // this task. But the timestamp on our remove action needs to be earlier in
                    // case of conflict.
                    removeAction,
                ],
                {undoManager},
            );
        }
        // Move the task to our parent's parent. If we have access to the new parent's
        // children query then we can pick a position below our old parent.
        else {
            const time1 = store.clock.now();
            const time2 = store.clock.now();

            const newChildrenQuery = store.getTaskChildrenQueryStore(newParentTaskId).getSnapshot();

            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

            events.commitActionTransaction(
                () => [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: newParentTaskId,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateParentPosition",
                            parentPosition: newChildrenQuery
                                ? getNewTaskPositionForQuerySortedByPosition(
                                      time2,
                                      newChildrenQuery,
                                      {
                                          type: "Below",
                                          taskId: oldParentTaskId,
                                      },
                                  )
                                : {
                                      orderTime: time2,
                                      orderKey: initialOrderKey,
                                  },
                        },
                    },
                ],
                {undoManager},
            );
        }

        // Store updates are rendered by React immediately. So focus our task before
        // the next paint.
        onLayoutEffectCallbacksRef.current.push(() => {
            // This may call `flushSync()` which can't be called during React lifecycle
            // methods. So we wrap in a microtask.
            scheduleMicrotask(() => {
                if (parents.length <= 1) {
                    events.focusTaskTitleSelection(taskId, titleSelection);
                } else {
                    events.focusTaskTitleSelection(
                        `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${taskId}`,
                        titleSelection,
                    );
                }
            });
        });
    };

    const duplicateTaskAndAllChildrenAndFocusNewTask = async () => {
        if (!cursor) return;

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        const {taskId: newTaskId} = await duplicateTaskAndAllChildren(taskId, {undoManager});

        onLayoutEffectCallbacksRef.current.push(() => {
            // This may call `flushSync()` which can't be called during React lifecycle
            // methods. So we wrap in a microtask.
            scheduleMicrotask(() => {
                events.focusTaskTitleStart(newTaskId);

                // Make sure the new task is visible...
                if (
                    document.activeElement instanceof HTMLElement &&
                    isTextInputElement(document.activeElement)
                ) {
                    maintainTextInputVisibility(document.activeElement);
                }
            });
        });
    };

    const deleteTaskAndAllChildren = () => {
        if (!cursor) return;

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        events.showTaskDeleteConfirmationModalDialog({taskId, undoManager});
    };

    const deleteTaskAndAllChildrenAndFocusPreviousRow = () => {
        // If this is a ghost task then hitting delete should focus the task above it.
        if (!cursor) {
            events.focusPreviousTaskTitleEnd(`Task:${gridKey}`);
            return;
        }

        const taskId = getTaskQuerySortCursorTaskId(cursor);

        const itemIndex = assertExists(viewRef.current?.getIndexByKeyIfExists(`Task:${gridKey}`));

        const state = events.getState();
        const itemCount = events.getItemCount();
        const itemCountBeforeState = events.getItemCountBeforeState();
        const stateItemIndex = itemIndex - itemCountBeforeState;

        // Item is not in state, we can't delete it.
        if (!(0 <= stateItemIndex && stateItemIndex < itemCount - itemCountBeforeState)) return;

        const item = state.getItem(stateItemIndex);
        if (item.type !== "Task") return;

        const focusPreviousRow = (itemIndex: number) => {
            let hasFoundPreviousRow = false;

            for (let index = itemIndex - 1; index >= 0; index--) {
                const taskRow = events.getTaskRowByIndexIfExists(index);
                if (!taskRow) continue;

                taskRow.focusTitleEnd();
                hasFoundPreviousRow = true;
                break;
            }

            // If there is no previous row (we're the first row) then we want to focus the
            // start of the next row instead.
            if (!hasFoundPreviousRow) {
                for (let index = itemIndex + 1; index < events.getItemCount(); index++) {
                    const taskRow = events.getTaskRowByIndexIfExists(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleStart();
                    break;
                }
            }
        };

        // If a task has zero children then we delete it immediately without asking for
        // confirmation. We use `commitTaskActionTransaction()` since that
        // optimistically applies the delete action.
        //
        // There may be a race condition where the task has a child our client doesn't
        // know about yet. This child won't be deleted. This race condition is
        // acceptable.
        if (item.query.getLoadedTaskSnapshot(taskId).getChildTaskCount() === 0) {
            disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

            events.commitActionTransaction(
                () => [
                    {
                        type: "UpdateTask",
                        time: store.clock.now(),
                        taskId,
                        taskAction: {type: "Delete"},
                    },
                ],
                {undoManager},
            );

            focusPreviousRow(itemIndex);
        } else {
            let hasDeleted = false;

            events.showTaskDeleteConfirmationModalDialog({
                undoManager,
                taskId,
                onAfterDelete: () => {
                    hasDeleted = true;
                },
                // Once React has closed the modal dialog, focus the previous task. Until the
                // modal dialog is closed, focus is trapped inside it.
                onAfterClose: () => {
                    if (!hasDeleted) return;

                    const view = viewRef.current;
                    if (!view) return;

                    focusPreviousRow(itemIndex);
                },
            });
        }
    };

    return (
        <TaskRowView
            ref={useCallback(
                (taskRow: TaskRowViewRef) => {
                    if (!taskRow) {
                        taskRowByGridKeyRef.current.delete(gridKey);
                    } else {
                        taskRowByGridKeyRef.current.set(gridKey, taskRow);
                    }
                },
                [gridKey, taskRowByGridKeyRef],
            )}
            capabilities={capabilities}
            maxGridExpandableTaskDepth={maxGridExpandableTaskDepth}
            stateKey={stateKey}
            store={store}
            // It's important we use the `query` property from `item` since child tasks
            // come from a different query than our root query.
            query={query}
            isQueryManuallySorted={isQueryManuallySorted}
            undoManager={undoManager}
            affinityManager={affinityManager}
            cursor={cursor}
            ghostTaskId={ghostTaskId}
            onGhostTaskCreated={events.onBottomGhostTaskCreated}
            parents={parents}
            rowMaxWidth={rowMaxWidth}
            disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
            titlePlaceholder={titlePlaceholder}
            isFirstRow={isFirstRow}
            withoutBorderTopIfFirstRow={withoutBorderTopIfFirstRow}
            isFirstTaskInQuery={isFirstTaskInQuery}
            nextIndentation={nextIndentation}
            areChildTasksExpandedStore={areChildTasksExpandedStore}
            onAreChildTasksExpandedToggle={() => {
                if (!taskPath) return;
                toggleAreChildTasksExpanded(taskPath);
            }}
            withoutPaddingLeft={withoutPaddingLeft}
            withPaddingBottom={withPaddingBottom}
            hasNextGridView={hasNextGridView}
            hasDecorativeGhostRowBackground={hasDecorativeGhostRowBackground}
            getMoveTaskToRootQueryActions={events.getMoveTaskToRootQueryActions}
            getMoveTaskToQueryActions={getMoveTaskToQueryActions}
            getMaybeRemoveTaskFromQueryActions={getMaybeRemoveTaskFromQueryActions}
            createTaskAbove={createTaskAbove}
            createTaskBelowAndFocus={createTaskBelowAndFocus}
            nestWithPreviousTaskRowIfExistsAndExpand={nestWithPreviousTaskRowIfExistsAndExpand}
            unnestTaskIfNestedRow={unnestTaskIfNestedRow}
            duplicateTaskAndAllChildrenAndFocusNewTask={duplicateTaskAndAllChildrenAndFocusNewTask}
            deleteTaskAndAllChildren={deleteTaskAndAllChildren}
            deleteTaskAndAllChildrenAndFocusPreviousRow={
                deleteTaskAndAllChildrenAndFocusPreviousRow
            }
            focusNextTaskTitleCoord={coord => events.focusNextTaskTitleCoord(gridKey, coord)}
            focusPreviousTaskTitleCoord={coord =>
                events.focusPreviousTaskTitleCoord(gridKey, coord)
            }
            focusNextTaskCell={column => events.focusNextTaskCell(gridKey, column)}
            focusPreviousTaskCell={column => events.focusPreviousTaskCell(gridKey, column)}
            preserveLastTaskTitleArrowNavigationCoord={
                events.preserveLastTaskTitleArrowNavigationCoord
            }
            focusFirstVisibleTaskTitleStart={events.focusFirstVisibleTaskTitleStart}
            focusFirstVisibleTaskCell={events.focusFirstVisibleTaskCell}
            focusLastVisibleTaskTitleEnd={events.focusLastVisibleTaskTitleEnd}
            focusLastVisibleTaskCell={events.focusLastVisibleTaskCell}
            focusTaskTitleSelection={events.focusTaskTitleSelection}
            setRowZIndex={useCallback(
                zIndex => events.setTaskRowZIndex(gridKey, zIndex),
                [events, gridKey],
            )}
            mobileKeyboardToolbarPortalRef={mobileKeyboardToolbarPortalRef}
            scrollToAnchorPosition={events.scrollToAnchorPosition}
            commitActionTransaction={events.commitActionTransaction}
        />
    );
});
