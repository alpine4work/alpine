import {useDndContext} from "@dnd-kit/core";
import {Memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {MenuAction} from "~/client/design/menu.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/navigation_bar.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/design/scrollbar.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {
    TaskGridViewVirtualizedListViewRef,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {
    TaskNotepadViewActiveSection,
    taskNotepadViewActiveSectionMinHeight,
} from "~/client/tasks/internal/task_notepad_view_active_section.js";
import {
    TaskNotepadViewPaginator,
    taskNotepadViewPaginatorHeight,
} from "~/client/tasks/internal/task_notepad_view_paginator.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/tasks/task_client_store.js";
import {
    TaskGridViewDraggableData,
    TaskGridViewDroppableData,
} from "~/client/tasks/task_grid_view_dnd_context.js";
import {useTaskQueryState} from "~/client/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {tasksStyles} from "~/shared/styles/styles.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageId,
    TaskNotepadPageIdCompressedSet,
} from "~/shared/tasks/task_notepad_page_id.js";

export {taskNotepadAssigneeActiveLoadLimit} from "~/client/tasks/internal/task_notepad_view_active_section.js";

export function TaskNotepadView({
    withMobileLayout: withMobileLayoutProp,
    store,
    assigneeActiveQuery,
    affinityManager,
    initialQuery,
    initialNotepadPageId,
    allNotepadPageIds: allNotepadPageIdsWithoutNewNotepadPageIds,
    onActiveNotepadPageIdChange,
}: {
    withMobileLayout: boolean;
    store: TaskClientStore;
    assigneeActiveQuery: TaskClientQuery;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
        initialBottomGhostTaskId: TaskId;
    };
    initialNotepadPageId: TaskNotepadPageId;
    allNotepadPageIds: TaskNotepadPageIdCompressedSet;
    onActiveNotepadPageIdChange: (notepadPageId: TaskNotepadPageId) => void;
}) {
    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();
    const {isAppleDevice} = useClientInfo();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    // Retain `assigneeActiveQuery`. We can't retain it in
    // `<TaskNotepadViewActiveSection>` since that component may be scrolled
    // offscreen, unmounted, then back onscreen.
    useEffect(() => {
        assigneeActiveQuery.retain();

        return () => {
            // Release after a microtask in case the effect re-runs in which case we'll
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                assigneeActiveQuery.release();
            });
        };
    }, [assigneeActiveQuery]);

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const [notepadPageState, setNotepadPageState] = useState({
        notepadPageId: initialNotepadPageId,
        shouldImmediatelyInitializeEmptyQueryRef: {current: false},
        promiseResolver: cast<PromiseResolver<void> | null>(null),
    });

    const [newNotepadPageIds, setNewNotepadPageIds] =
        useState<ReadonlyArray<TaskNotepadPageId>>(emptyArray);

    const allNotepadPageIds = useMemo(
        () =>
            new Lazy(() =>
                concatIterables(allNotepadPageIdsWithoutNewNotepadPageIds.get(), newNotepadPageIds),
            ),
        [allNotepadPageIdsWithoutNewNotepadPageIds, newNotepadPageIds],
    );

    const queryState = useTaskQueryState({
        store,
        initialQuery,
        filters: useMemo(
            () => ({
                displayStatusFilter: {
                    ifOpenInactive: true,
                    ifOpenActive: true,
                    ifClosed: true,
                },
                notepadPageFilter: {
                    accountId: currentAccount.id,
                    notepadPageId: notepadPageState.notepadPageId,
                },
            }),
            [currentAccount.id, notepadPageState.notepadPageId],
        ),
        sorts: useMemo(
            () => [
                {
                    type: "NotepadPagePosition",
                    accountId: currentAccount.id,
                    notepadPageId: notepadPageState.notepadPageId,
                    direction: "Ascending",
                    missing: "Last",
                },
                {
                    type: "CreatedTime",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
            [currentAccount.id, notepadPageState.notepadPageId],
        ),
        onActiveQueryChange: query => {
            // Wait until the new query has loaded before changing the notepad page in the
            // URL. Since we push new notepad pages (via `history.pushState()` instead of
            // `history.replaceState()`) this has the side effect of clearing the peek
            // stack. We don't want to clear the peek stack until after the notepad data
            // has changed.
            const activeNotepadPageId = assertExists(
                query?.filters.notepadPageFilter?.notepadPageId,
            );
            onActiveNotepadPageIdChange(activeNotepadPageId);
        },
    });

    // When we create a new notepad page, immediately initialize the new query to
    // an empty query without waiting for the server. If we successfully created a
    // notepad page then it shouldn't have any tasks yet.
    useEffect(() => {
        if (
            queryState.pendingQuery?.filters.notepadPageFilter?.notepadPageId ===
                notepadPageState.notepadPageId &&
            notepadPageState.shouldImmediatelyInitializeEmptyQueryRef.current
        ) {
            notepadPageState.shouldImmediatelyInitializeEmptyQueryRef.current = false;

            store.loadTasksIntoQuery(queryState.pendingQuery, {
                limit: 0,
                loadedState: {type: "Full"},
                previouslyBackfilledTaskIds: [],
            });
        }
    }, [notepadPageState, queryState.pendingQuery, store]);

    // When the active query matches our `notepadPageId` in `notepadPageState`
    // resolve the optional promise we created for the `notepadPageState`.
    useEffect(() => {
        if (!notepadPageState.promiseResolver) return;

        if (
            queryState.activeQuery.query?.query.filters.notepadPageFilter?.notepadPageId ===
            notepadPageState.notepadPageId
        ) {
            notepadPageState.promiseResolver.resolve();
        }
    }, [notepadPageState, queryState]);

    // Call the `useDndContext()` hook here and pass in active/over data so child
    // components don't re-render whenever the drag context changes.
    const {active: dndContextActive, over: dndContextOver} = useDndContext();

    const activeDraggableData = dndContextActive?.data.current as
        | TaskGridViewDraggableData
        | undefined;

    const overDroppableData = dndContextOver?.data.current as TaskGridViewDroppableData | undefined;

    const shiftRenderedRangeForGridView = useCallback(
        (range: {startIndex: number; endIndex: number} | null) => {
            if (!range) {
                return null;
            } else {
                const startIndex = range.startIndex - 1;
                const endIndex = range.endIndex - 1;
                if (endIndex < 0) {
                    return null;
                } else {
                    return {
                        startIndex: Math.max(0, startIndex),
                        endIndex,
                    };
                }
            }
        },
        [],
    );

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of
    // items which precede our children grid view.
    useImperativeHandle(
        gridViewRef,
        () => ({
            getHeight: () => assertExists(viewRef.current).getHeight(),
            getContentHeight: () => assertExists(viewRef.current).getContentHeight(),
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: scrollOffset =>
                assertExists(viewRef.current).setScrollOffset(scrollOffset),
            scrollToIndex: (index, options) =>
                assertExists(viewRef.current).scrollToIndex(index + 1, options),
            getRenderedRange: () =>
                shiftRenderedRangeForGridView(assertExists(viewRef.current).getRenderedRange()),
            getKeyByIndexIfExists: index =>
                assertExists(viewRef.current).getKeyByIndexIfExists(index + 1),
            getIndexByKeyIfExists: key => {
                const index = assertExists(viewRef.current).getIndexByKeyIfExists(key);
                if (index === null) return index;
                return index - 1;
            },
            getPositionByIndex: index =>
                assertExists(viewRef.current).getPositionByIndex(index + 1),
            getPositionByKeyIfExists: key =>
                assertExists(viewRef.current).getPositionByKeyIfExists(key),
            peekRenderedRangeAfterSetScrollOffset: scrollOffset =>
                shiftRenderedRangeForGridView(
                    assertExists(viewRef.current).peekRenderedRangeAfterSetScrollOffset(
                        scrollOffset,
                    ),
                ),
            getElement: () => assertExists(viewRef.current).getElement(),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getElementByKeyIfExists: key =>
                assertExists(viewRef.current).getElementByKeyIfExists(key),
        }),
        [shiftRenderedRangeForGridView],
    );

    const gridViewCapabilities: Memo<TaskGridViewCapabilities> = useMemo(() => {
        if (!withMobileLayout) {
            return {
                isReadOnly: false,
                hasParentTaskTitle: false,
                hasMultilineTitle: false,
                hasColumns: true,
                hasDenseFields: false,
            };
        } else {
            return {
                isReadOnly: false,
                hasParentTaskTitle: false,
                hasMultilineTitle: true,
                hasColumns: false,
                hasDenseFields: true,
            };
        }
    }, [withMobileLayout]);

    const {
        stateKey: gridViewStateKey,
        bufferedItemHeight: gridViewBufferedItemHeight,
        modals: gridViewModals,
        itemCount: gridViewItemCount,
        renderItem: renderGridViewItem,
        onRenderedRangeChange: onGridViewRenderedRangeChange,
        onRenderedRangeLayoutChange: onGridViewRenderedRangeLayoutChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderAdditionalGridViewItemIndexes,
        scrollbarInsetTopItemIndex: scrollbarInsetTopGridViewItemIndex,
        onGlobalKeyDown: onGridViewGlobalKeyDown,
        focusEnd: focusGridViewEnd,
        undo,
        redo,
    } = useTaskGridViewVirtualizedList({
        capabilities: gridViewCapabilities,
        store,
        query: queryState.activeQuery.query,
        affinityManager,
        viewRef: gridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            const time = store.clock.now();

            assert(queryState.activeQuery.isAvailable);
            const query = queryState.activeQuery.query.query;

            return [
                {
                    type: "UpdateTask",
                    time,
                    taskId,
                    taskAction: {
                        type: "UpdateNotepadPagePosition",
                        accountId: currentAccount.id,
                        notepadPageId: notepadPageState.notepadPageId,
                        position: getNewTaskPositionForQuerySortedByPosition(time, query, position),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: currentAccount.id,
                    notepadPageId: notepadPageState.notepadPageId,
                    position: null,
                },
            },
        ],
        columnHeaderControls: useMemo(() => {
            // We don't have sticky column header controls when rendering on mobile
            // devices. Instead we render a navigation bar.
            if (isMobile) return;

            const height =
                spacing[isMobile ? navigationBarHeight.mobile : navigationBarHeight.desktop];

            return {
                minHeight: height,
                node: (
                    <Box
                        paddingX={screenPaddingX}
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        paddingTop="safe-area-inset"
                        style={{height: `calc(${height} + var(--safe-area-inset-top, 0px))`}}
                    >
                        <Box fontSize="200" fontStyle="semi-bold">
                            Notepad
                        </Box>
                        <TaskNotepadViewPaginator
                            store={store}
                            allNotepadPageIds={allNotepadPageIds}
                            notepadPageId={notepadPageState.notepadPageId}
                            onNotepadPageIdCreate={notepadPageId => {
                                const promiseResolver = createPromiseResolver();

                                setNewNotepadPageIds(newNotepadPageIds => [
                                    ...newNotepadPageIds,
                                    notepadPageId,
                                ]);

                                setNotepadPageState({
                                    notepadPageId,
                                    // After creating a new notepad page, immediately initialize our client query
                                    // to an empty query so we don't have to wait for it to load.
                                    shouldImmediatelyInitializeEmptyQueryRef: {current: true},
                                    promiseResolver,
                                });

                                return promiseResolver.promise;
                            }}
                            onNotepadPageIdSelect={notepadPageId => {
                                const promiseResolver = createPromiseResolver();

                                setNotepadPageState({
                                    notepadPageId,
                                    shouldImmediatelyInitializeEmptyQueryRef: {current: false},
                                    promiseResolver,
                                });

                                return promiseResolver.promise;
                            }}
                        />
                    </Box>
                ),
            };
        }, [allNotepadPageIds, isMobile, notepadPageState.notepadPageId, store]),
    });

    const {undoEvent, redoEvent} = useEvents({
        undoEvent: undo,
        redoEvent: redo,
    });

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: !isMobile,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: "Notepad",
        menuActions: useMemo(() => {
            const menuActions: Array<ReadonlyArray<MenuAction>> = [];

            menuActions.push([
                {
                    label: "Undo",
                    keyboardShortcutHint: isAppleDevice ? "⌘+Z" : "Ctrl+Z",
                    onPress: undoEvent,
                },
                {
                    label: "Redo",
                    keyboardShortcutHint: isAppleDevice ? "⌘+Y" : "Ctrl+Y",
                    onPress: redoEvent,
                },
            ]);

            return menuActions;
        }, [isAppleDevice, redoEvent, undoEvent]),
    });

    return (
        <Box
            data-testid="TaskNotepadView"
            position="relative"
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            className={
                queryState.activeQuery ? tasksStyles.textCursorNotInherited2ClassName : undefined
            }
            {...useOutOfBoundsClickSelection({
                isDisabled: !queryState.activeQuery,
                // Accept clicks on our `<VirtualizedScrollView>` child too.
                accept: event =>
                    event.target === event.currentTarget ||
                    (event.target instanceof Element &&
                        event.target.parentElement === event.currentTarget),
                onSelect: () => focusGridViewEnd(),
                onSelectAll: () => focusGridViewEnd(),
            })}
        >
            {!isMobile && (
                // Cover the top safe area. Except on mobile when our navigation bar will cover
                // the safe area. So when the active section scrolls into safe area (e.g. in a
                // peek on desktop) it's covered.
                <Box
                    position="absolute"
                    top="0"
                    zIndex="10"
                    width="full"
                    height="safe-area-inset-top"
                    backgroundColor="grey-0"
                />
            )}
            {gridViewModals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGridViewGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={scrollViewRef}
                    stateKey={gridViewStateKey}
                    bufferedItemHeight={gridViewBufferedItemHeight}
                    itemCount={1 + gridViewItemCount}
                    alwaysRenderAdditionalItemIndexes={useMemo(
                        () => alwaysRenderAdditionalGridViewItemIndexes.map(index => index + 1),
                        [alwaysRenderAdditionalGridViewItemIndexes],
                    )}
                    scrollbarInsetTop={
                        withMobileLayout
                            ? scrollbarInsetTop ?? safeAreaOnlyScrollbarInsetTop
                            : undefined
                    }
                    scrollbarInsetTopItemIndex={
                        !withMobileLayout && scrollbarInsetTopGridViewItemIndex !== undefined
                            ? scrollbarInsetTopGridViewItemIndex + 1
                            : undefined
                    }
                    renderItem={useCallback(
                        index => {
                            if (index === 0) {
                                return {
                                    key: "ActiveCards",
                                    minHeight: isMobile
                                        ? addRemLengths(
                                              taskNotepadViewActiveSectionMinHeight.mobile,
                                              spacing["2"],
                                              spacing[taskNotepadViewPaginatorHeight],
                                              spacing["2"],
                                          )
                                        : taskNotepadViewActiveSectionMinHeight.desktop,
                                    node: (
                                        <>
                                            <TaskNotepadViewActiveSection
                                                withMobileLayout={withMobileLayout}
                                                affinityManager={affinityManager}
                                                assigneeActiveQuery={assigneeActiveQuery}
                                                activeDraggableData={activeDraggableData}
                                                overDroppableData={overDroppableData}
                                            />
                                            {isMobile && (
                                                <Box paddingX="2" paddingY="2">
                                                    <TaskNotepadViewPaginator
                                                        store={store}
                                                        allNotepadPageIds={allNotepadPageIds}
                                                        notepadPageId={
                                                            notepadPageState.notepadPageId
                                                        }
                                                        onNotepadPageIdCreate={notepadPageId => {
                                                            const promiseResolver =
                                                                createPromiseResolver();

                                                            setNewNotepadPageIds(
                                                                newNotepadPageIds => [
                                                                    ...newNotepadPageIds,
                                                                    notepadPageId,
                                                                ],
                                                            );

                                                            setNotepadPageState({
                                                                notepadPageId,
                                                                // After creating a new notepad page, immediately initialize our client query
                                                                // to an empty query so we don't have to wait for it to load.
                                                                shouldImmediatelyInitializeEmptyQueryRef:
                                                                    {current: true},
                                                                promiseResolver,
                                                            });

                                                            return promiseResolver.promise;
                                                        }}
                                                        onNotepadPageIdSelect={notepadPageId => {
                                                            const promiseResolver =
                                                                createPromiseResolver();

                                                            setNotepadPageState({
                                                                notepadPageId,
                                                                shouldImmediatelyInitializeEmptyQueryRef:
                                                                    {current: false},
                                                                promiseResolver,
                                                            });

                                                            return promiseResolver.promise;
                                                        }}
                                                    />
                                                </Box>
                                            )}
                                        </>
                                    ),
                                };
                            }

                            return renderGridViewItem(index - 1);
                        },
                        [
                            activeDraggableData,
                            affinityManager,
                            allNotepadPageIds,
                            assigneeActiveQuery,
                            isMobile,
                            notepadPageState.notepadPageId,
                            overDroppableData,
                            renderGridViewItem,
                            store,
                            withMobileLayout,
                        ],
                    )}
                    onRenderedRangeChange={range => {
                        onGridViewRenderedRangeChange(shiftRenderedRangeForGridView(range));
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onGridViewRenderedRangeLayoutChange(shiftRenderedRangeForGridView(range));
                    }}
                    extraChildren={navigationBar}
                />
            </GlobalKeyDownEvent>
        </Box>
    );
}
