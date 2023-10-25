import {IconContext, Plus, Trash} from "phosphor-react";
import {ReactNode, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {Spacer} from "~/client/design/spacer.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskAccess,
    getTaskCollectionEntryAccess,
} from "~/client/tasks/internal/get_task_entry_access_store.js";
import {PencilSimpleSlash} from "~/client/tasks/internal/pencil_simple_slash.js";
import {useTaskGridViewVirtualizedList} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {getTaskQueryCollectionsFilterCollectionResultsStore} from "~/client/tasks/internal/task_query_collections_filter_operation_editor.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {useTaskQueryState} from "~/client/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    inputPlaceholderStyles,
    invertSelectionColorsClassName,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {hasTaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {normalizeTaskQuerySorts} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

/**
 * Determine whether our query is read-only. The query is read-only if one of
 * the filtered collections is read-only. The user may then remove the
 * collection causing the query to be read-only.
 */
export function getTaskQueryViewReadOnlyReasonStore({
    store,
    filters,
    filterReferences,
    currentAccount,
}: {
    store: TaskClientStore;
    filters: ReadonlyArray<TaskQueryFilter>;
    filterReferences: TaskQueryFilterReferences;
    currentAccount: AccountModel;
}): Store<{
    icon: ReactNode;
    message: string;
} | null> {
    const filterCollectionsLowestAccess = Store.many(
        filterMapArray(filters, filter => {
            if (filter.type !== "Collections") return null;

            return getTaskQueryCollectionsFilterCollectionResultsStore({
                store,
                filter,
                filterReferences,
            }).map(collectionResults =>
                collectionResults.map(collectionResult =>
                    getTaskCollectionEntryAccess(currentAccount.id, collectionResult.entry),
                ),
            );
        }),
    ).map(_accesses => {
        const accesses = _accesses.flat();

        let lowestAccess: TaskAccess = {type: "PermissionGranted", level: "Manage"};

        for (const access of accesses) {
            switch (access.type) {
                case "PermissionDenied": {
                    lowestAccess = access;
                    break;
                }
                case "Deleted": {
                    if (lowestAccess.type === "PermissionDenied") break;
                    lowestAccess = access;
                    break;
                }
                case "PermissionGranted": {
                    if (lowestAccess.type === "PermissionDenied") break;
                    if (lowestAccess.type === "Deleted") break;

                    if (!hasTaskCollectionAccessLevel(access.level, lowestAccess.level)) {
                        lowestAccess = access;
                    }
                    break;
                }
                default:
                    throw exhaustive(access);
            }
        }

        return lowestAccess;
    });

    return filterCollectionsLowestAccess.map(access => {
        switch (access.type) {
            case "Deleted": {
                return {
                    icon: <Trash />,
                    message: "A filtered collection was deleted. You can’t make changes",
                };
            }
            case "PermissionDenied": {
                // TODO(calebmer): If the user removed their own access by removing a
                // collection or changing the assignee, we should hint to them that they're
                // allowed to undo and give them an undo button.
                return {
                    icon: <PencilSimpleSlash />,
                    message: "You’ve lost access to a filtered collection. You can’t make changes",
                };
            }
            case "PermissionGranted": {
                if (hasTaskCollectionAccessLevel(access.level, "Edit")) return null;

                // TODO(calebmer): If the user removed their own access by removing a
                // collection or changing the assignee, we should hint to them that they're
                // allowed to undo and give them an undo button.
                return {
                    icon: <PencilSimpleSlash />,
                    message: "You’re aren’t allowed to make changes to a filtered collection",
                };
            }
            default:
                throw exhaustive(access);
        }
    });
}

export function TaskQueryView({
    store,
    initialQuery,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    store: TaskClientStore;
    initialQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
        initialBottomGhostTaskId: TaskId;
    } | null;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    const remPx = useRemPx();
    const currentDate = useCurrentDate();
    const {currentAccount} = useSpaceContext();

    const customizationBarRef = useRef<TaskQueryViewCustomizationBarRef>(null);

    const [
        {filters, filterReferences, shouldOpenFirstCollectionsFilterOperationValueRef},
        _setFiltersState,
    ] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
        shouldOpenFirstCollectionsFilterOperationValueRef: {current: false},
    });

    // After a render that asks for the first collection filter to be opened, go
    // ahead and attempt to open.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldOpenFirstCollectionsFilterOperationValueRef.current) return;
        shouldOpenFirstCollectionsFilterOperationValueRef.current = false;

        assertExists(customizationBarRef.current).openFirstCollectionsFilterOperationValue();
    }, [shouldOpenFirstCollectionsFilterOperationValueRef]);

    const [sorts, _setSorts] = useState(initialSorts);

    const {updateFilters, setSorts} = useEvents({
        updateFilters: (
            filters: ReadonlyArray<TaskQueryFilter>,
            {
                mergeFilterReferences,
                shouldOpenFirstCollectionsFilterOperationValue,
            }: {
                mergeFilterReferences?: TaskQueryFilterReferences;
                shouldOpenFirstCollectionsFilterOperationValue?: boolean;
            } = {},
        ) => {
            _setFiltersState(({filterReferences}) => {
                const newFilterReferences = mergeFilterReferences
                    ? mergeTaskQueryFilterReferences(filterReferences, mergeFilterReferences)
                    : filterReferences;

                return {
                    filters,
                    filterReferences: newFilterReferences,
                    shouldOpenFirstCollectionsFilterOperationValueRef:
                        shouldOpenFirstCollectionsFilterOperationValue
                            ? {current: true}
                            : {current: false},
                };
            });

            onFiltersChange(filters);
        },
        setSorts: (sorts: ReadonlyArray<TaskQuerySort>) => {
            _setSorts(sorts);
            onSortsChange(sorts);
        },
    });

    const normalizedFiltersResult = useMemo(
        () =>
            normalizeTaskQueryFilters(filters, {currentDate, currentAccountId: currentAccount.id}),
        [currentAccount.id, currentDate, filters],
    );

    const normalizedSorts = useMemo(() => normalizeTaskQuerySorts(sorts), [sorts]);

    const readOnlyReason = useStore(
        useMemo(
            () =>
                getTaskQueryViewReadOnlyReasonStore({
                    store,
                    filters,
                    filterReferences,
                    currentAccount,
                }),
            [currentAccount, filterReferences, filters, store],
        ),
    );

    const isReadOnly = readOnlyReason !== null;

    const queryState = useTaskQueryState({
        store,
        initialQuery,
        filters:
            normalizedFiltersResult.type === "Possible"
                ? normalizedFiltersResult.normalizedFilters
                : null,
        sorts: normalizedSorts,
    });

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {
        stateKey: gridViewStateKey,
        bufferedItemHeight: gridViewBufferedItemHeight,
        modals: gridViewModals,
        itemCount: gridViewItemCount,
        renderItem: renderGridViewItem,
        onRenderedRangeChange: onGridViewRenderedRangeChange,
        onRenderedRangeLayoutChange: onGridViewRenderedRangeLayoutChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderAdditionalGridViewItemIndexes,
        insetScrollbarItemIndex: insetScrollbarGridViewItemIndex,
        focusEnd: focusGridViewEnd,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(
            () => ({
                isReadOnly,
                hasParentTaskTitle: true,
                hasMultilineTitle: false,
                hasDenseFields: false,
                hasColumns: true,
            }),
            [isReadOnly],
        ),
        viewRef,
        query: queryState.activeQuery.query,
        // NOTE(calebmer): Currently, all updates which use this are disabled in
        // auto-sorted views:
        //
        // - Shift-tab to unnest task
        // - Enter to create task
        // - Drag/drop to move task
        // - Type in ghost row to create task
        //
        // Some of these make sense to disable in auto-sorted views like drag/drop to
        // move task. However, it would be nice to get some behaviors like "Enter to
        // create task" working. Right now, you can't create tasks inline in an
        // auto-sorted view which is unfortunate.
        //
        // At Airtable, when you had focus in a row that was either filtered out of the
        // view or moved we gave it a "pinned" row treatment. Rendered an orange box
        // around it and maintained the row in its old position. This behavior...wasn't
        // universally loved so there's probably room for improvement. But something
        // similar where you hit enter and it gives you a pinned row you can fill out
        // before unfocusing seems nice. Though maybe creating a task through a detail
        // view is actually a better experience?
        //
        // Another thought is when adding a task to a query we need to make sure it has
        // values that match our filters. For some filters like `priority = High`,
        // that's easy. For other filters like `priority = High || priority = Low` we
        // could initially set a reasonable value like `Low` even though it's ambiguous.
        //
        // I'm not implementing a solution here, for now, because pinned rows are
        // tricky (though not impossible) to implement. (You need to setup a separate
        // task subscription for the pinned row.) And because it's not clear to me what
        // the best UX here is. Disabling a bunch of behavior doesn't feel right though.
        getMoveTaskToQueryActions: () => [],
        // Can't remove task from custom view query. That would require updating
        // filtered fields in potentially unexpected ways. For instance if it's filter
        // to `priority = null` then what do we do? Assign the `Low` priority? This
        // would be surprising to users.
        //
        // Features which depend on this should be disabled by
        // `isTaskQueryManuallySorted()` checks. Namely drag-and-drop at the root query
        // level (subtasks are fine) and tab/shift-tab to indent.
        getMaybeRemoveTaskFromQueryActions: () => [],
        withColumnHeaderBorderTop: true,
        // TODO(calebmer): I'd like to kill extra scroll space. Feels wrong.
        withColumnHeaderExtraScrollSpace: "1.5",
        columnHeaderControls: useMemo(() => {
            return {
                minHeight: "2.75rem",
                node: (
                    <>
                        {readOnlyReason?.message && (
                            // TODO(calebmer): This should really be a sticky header. We should probably
                            // have a sticky header for the task title too.
                            <Box
                                className={invertSelectionColorsClassName}
                                height="8"
                                paddingX="2"
                                color="grey-0"
                                backgroundColor={{light: "grey-80", dark: "grey-90"}}
                                display="flex"
                                alignItems="center"
                                gap="1.5"
                            >
                                <IconContext.Provider
                                    value={{color: "currentColor", size: spacing["4"]}}
                                >
                                    {readOnlyReason.icon}
                                </IconContext.Provider>
                                <Box userSelect="text">{readOnlyReason.message}</Box>
                            </Box>
                        )}
                        <Box
                            paddingX={taskRowViewPaddingX}
                            paddingTop="2"
                            style={{paddingBottom: addRemLengths(spacing["3"], spacing["0.5"])}}
                        >
                            <TaskQueryViewCustomizationBar
                                ref={customizationBarRef}
                                store={store}
                                shouldCollapseWhenFiltersAreEmpty={false}
                                defaultOrderSentence="By default, tasks are ordered by created date."
                                filters={filters}
                                filterReferences={filterReferences}
                                onFiltersChange={updateFilters}
                                sorts={sorts}
                                onSortsChange={setSorts}
                            />
                        </Box>
                    </>
                ),
            };
        }, [filterReferences, filters, readOnlyReason, setSorts, sorts, store, updateFilters]),
    });

    return (
        <Box
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
            {gridViewModals}
            <VirtualizedScrollView
                ref={viewRef}
                stateKey={gridViewStateKey}
                bufferedItemHeight={gridViewBufferedItemHeight}
                itemCount={gridViewItemCount}
                alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalGridViewItemIndexes}
                insetScrollbarItemIndex={insetScrollbarGridViewItemIndex}
                renderItem={renderGridViewItem}
                onRenderedRangeChange={onGridViewRenderedRangeChange}
                onRenderedRangeLayoutChange={onGridViewRenderedRangeLayoutChange}
                extraChildren={
                    !queryState.activeQuery.isAvailable &&
                    queryState.activeQuery.isMissingRequiredFilters
                        ? ({contentHeight, viewHeight, shouldRenderWithRelativePositioning}) =>
                              !shouldRenderWithRelativePositioning && (
                                  <Box
                                      position="absolute"
                                      left="0"
                                      right="0"
                                      paddingX={taskRowViewPaddingX}
                                      pointerEvents="auto"
                                      style={{
                                          top: contentHeight,
                                          height: Math.min(
                                              convertRemLengthToPx(spacing["128"], remPx),
                                              viewHeight - contentHeight,
                                          ),
                                      }}
                                  >
                                      <Box
                                          height="full"
                                          display="flex"
                                          justifyContent="center"
                                          alignItems="center"
                                      >
                                          <TaskQueryViewInstructionalPlaceholder
                                              filters={filters}
                                              onFiltersChange={updateFilters}
                                          />
                                      </Box>
                                  </Box>
                              )
                        : undefined
                }
            />
        </Box>
    );
}

function TaskQueryViewInstructionalPlaceholder({
    filters,
    onFiltersChange,
}: {
    filters: ReadonlyArray<TaskQueryFilter>;
    onFiltersChange: (
        filters: ReadonlyArray<TaskQueryFilter>,
        options?: {shouldOpenFirstCollectionsFilterOperationValue?: boolean},
    ) => void;
}) {
    const {currentAccount} = useSpaceContext();

    return (
        <Box maxWidth="96">
            <Box
                // TODO(calebmer): Eventually I'd like a real graphic designer to take a look
                // at this state. We could use a nice illustration here.
                fontSize="300"
                fontStyle="bold"
                userSelect="text"
            >
                Start building a view
            </Box>
            <Spacer space="1" />
            <Box fontSize="100" color="grey-50" userSelect="text">
                Views must include one of the following filters so you don’t see other people’s
                private tasks.
            </Box>
            <Spacer space="10" />
            <Box
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: spacing["2"],
                    alignItems: "center",
                }}
            >
                <Box display="flex">
                    <Box
                        display="flex"
                        height="6"
                        alignItems="center"
                        paddingX="2"
                        gap="2"
                        border="grey-10"
                        borderRadius="base"
                    >
                        <Box>Creator</Box>
                        <Box color="grey-60">is</Box>
                        <Box display="flex" gap="1" alignItems="center">
                            <AccountAvatar size="3" account={currentAccount} />
                            <Box>me</Box>
                        </Box>
                    </Box>
                </Box>
                <Button
                    variant="neutral"
                    icon={<Plus />}
                    height="6"
                    isDisabled={filters.some(
                        filter =>
                            filter.type === "Creator" &&
                            filter.operation.type === "OneOf" &&
                            filter.operation.accounts.length === 1 &&
                            filter.operation.accounts[0]!.type === "CurrentAccount",
                    )}
                    onPress={() => {
                        onFiltersChange([
                            ...filters,
                            {
                                type: "Creator",
                                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                            },
                        ]);
                    }}
                >
                    Add
                </Button>
                <Box style={{gridColumn: "1 / span 2"}} borderTop="grey-5" />
                <Box display="flex">
                    <Box
                        display="flex"
                        height="6"
                        alignItems="center"
                        paddingX="2"
                        gap="2"
                        border="grey-10"
                        borderRadius="base"
                    >
                        <Box>Assignee</Box>
                        <Box color="grey-60">is</Box>
                        <Box display="flex" gap="1" alignItems="center">
                            <AccountAvatar size="3" account={currentAccount} />
                            <Box>me</Box>
                        </Box>
                    </Box>
                </Box>
                <Button
                    variant="neutral"
                    icon={<Plus />}
                    height="6"
                    isDisabled={filters.some(
                        filter =>
                            filter.type === "Assignee" &&
                            filter.operation.type === "OneOf" &&
                            filter.operation.accounts.length === 1 &&
                            filter.operation.accounts[0]!.type === "CurrentAccount",
                    )}
                    onPress={() => {
                        onFiltersChange([
                            ...filters,
                            {
                                type: "Assignee",
                                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                            },
                        ]);
                    }}
                >
                    Add
                </Button>
                <Box style={{gridColumn: "1 / span 2"}} borderTop="grey-5" />
                <Box display="flex">
                    <Box
                        display="flex"
                        height="6"
                        alignItems="center"
                        paddingX="2"
                        gap="2"
                        border="grey-10"
                        borderRadius="base"
                    >
                        <Box>Collections</Box>
                        <Box color="grey-60">has</Box>
                        <Box style={inputPlaceholderStyles}>any collection</Box>
                    </Box>
                </Box>
                <Button
                    variant="neutral"
                    icon={<Plus />}
                    height="6"
                    // The collection add button doesn't immediately give the user access to the
                    // view. So disable if we have an empty collection filter the user needs to
                    // configure.
                    isDisabled={filters.some(
                        filter =>
                            filter.type === "Collections" &&
                            (filter.operation.type === "IncludesOneOf" ||
                                filter.operation.type === "IncludesAllOf"),
                    )}
                    onPress={() => {
                        onFiltersChange(
                            [
                                ...filters,
                                {
                                    type: "Collections",
                                    operation: {type: "IncludesOneOf", collectionIds: new Set()},
                                },
                            ],
                            {
                                // Open the collection combobox to let the user know they still need to pick
                                // a collection.
                                shouldOpenFirstCollectionsFilterOperationValue: true,
                            },
                        );
                    }}
                >
                    Add
                </Button>
            </Box>
        </Box>
    );
}
