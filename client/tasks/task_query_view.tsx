import {Plus} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {useTaskClientStore} from "~/client/tasks/task_realtime_client_context_provider.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {inputPlaceholderStyles} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function TaskQueryView({
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    // NOCOMMIT: Get store from query?
    const store = useTaskClientStore();
    const currentDate = useCurrentDate();
    const {currentAccount} = useSpaceContext();

    const customizationBarRef = useRef<TaskQueryViewCustomizationBarRef>(null);

    const [
        {filters, filterReferences, shouldOpenFirstCollectionsFilterOperationValueRef},
        setFiltersState,
    ] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
        shouldOpenFirstCollectionsFilterOperationValueRef: {current: false},
    });

    const lastFiltersRef = useRef(filters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    // After a render that asks for the first collection filter to be opened, go
    // ahead and attempt to open.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldOpenFirstCollectionsFilterOperationValueRef.current) return;
        shouldOpenFirstCollectionsFilterOperationValueRef.current = false;

        assertExists(customizationBarRef.current).openFirstCollectionsFilterOperationValue();
    }, [shouldOpenFirstCollectionsFilterOperationValueRef]);

    const [sorts, setSorts] = useState(initialSorts);

    const lastSortsRef = useRef(sorts);
    useEffect(() => {
        if (lastSortsRef.current !== sorts) {
            onSortsChange(sorts);
            lastSortsRef.current = sorts;
        }
    }, [onSortsChange, sorts]);

    const normalizedFiltersResult = useMemo(
        () =>
            normalizeTaskQueryFilters(filters, {currentDate, currentAccountId: currentAccount.id}),
        [currentAccount.id, currentDate, filters],
    );

    // Custom views must start with a filter we know the user has access to. We
    // don't yet support querying any set of tasks and dynamically filtering out
    // ones the user doesn't have access to.
    const hasAccess = useMemo(() => {
        if (normalizedFiltersResult.type !== "Possible") return false;
        const {normalizedFilters} = normalizedFiltersResult;

        if (
            normalizedFilters.creatorFilter?.type === "OneOf" &&
            normalizedFilters.creatorFilter.accountIds.size === 1 &&
            normalizedFilters.creatorFilter.accountIds.has(currentAccount.id)
        ) {
            return true;
        }

        if (
            normalizedFilters.assigneeFilter?.type === "OneOf" &&
            normalizedFilters.assigneeFilter.accountIds.size === 1 &&
            normalizedFilters.assigneeFilter.accountIds.has(currentAccount.id)
        ) {
            return true;
        }

        // Assume that if the user filtered on a collection that they have access to
        // the collection.
        if (
            normalizedFilters.collectionsFilter?.some(clause =>
                iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not),
            )
        ) {
            return true;
        }

        return false;
    }, [currentAccount.id, normalizedFiltersResult]);

    const updateFilters = (
        filters: ReadonlyArray<TaskQueryFilter>,
        {
            mergeFilterReferences,
            shouldOpenFirstCollectionsFilterOperationValue,
        }: {
            mergeFilterReferences?: TaskQueryFilterReferences;
            shouldOpenFirstCollectionsFilterOperationValue?: boolean;
        } = {},
    ) => {
        setFiltersState(({filterReferences}) => {
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
    };

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            // NOCOMMIT
            // className={tasksStyles.textCursorNotInherited2ClassName}
            // {...useOutOfBoundsClickSelection({
            //     // Accept clicks on our `<VirtualizedScrollView>` child too.
            //     accept: event =>
            //         event.target === event.currentTarget ||
            //         (event.target instanceof Element &&
            //             event.target.parentElement === event.currentTarget),
            //     onSelect: () => focusGridViewEnd(),
            //     onSelectAll: () => focusGridViewEnd(),
            // })}
        >
            <Box paddingY="5" paddingX={taskRowViewPaddingX}>
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
            {!hasAccess && (
                <Box paddingX={taskRowViewPaddingX} height="128">
                    <Box
                        height="full"
                        borderTop="grey-5"
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
            )}
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
