import {Plus} from "phosphor-react";
import {
    Fragment,
    Ref,
    RefObject,
    forwardRef,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {OverlayTriggerButtonRef} from "~/client/web/design/overlay_trigger_button.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {
    taskQueryViewCustomizationMobileSectionGap,
    taskQueryViewCustomizationMobileSectionHeaderFontSize,
    taskQueryViewCustomizationMobileSectionHeaderHeight,
    taskQueryViewCustomizationMobileSectionHeaderMarginBottom,
    taskQueryViewCustomizationMobileSectionMarginBottom,
    taskQueryViewCustomizationMobileSectionOptionHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskQueryAddFilterMenuButton} from "~/client/web/tasks/internal/task_query_add_filter_menu_button.js";
import {TaskQueryAddSortMenuButton} from "~/client/web/tasks/internal/task_query_add_sort_menu_button.js";
import {TaskQueryFilterEditor} from "~/client/web/tasks/internal/task_query_filter_editor.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskQuerySortsEditor} from "~/client/web/tasks/internal/task_query_sorts_editor.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskQueryViewCustomizationMobileSectionRef = {
    openAddFilterMenu(): void;
    openAddSortMenu(): void;
    openFirstCollectionsFilterOperationValue(): void;
};

const TaskQueryViewCustomizationMobileSectionForwardRef = forwardRef(
    TaskQueryViewCustomizationMobileSection,
);
export {TaskQueryViewCustomizationMobileSectionForwardRef as TaskQueryViewCustomizationMobileSection};

function TaskQueryViewCustomizationMobileSection(
    {
        store,
        queryReferencesForUrlGrant,
        initialAreFiltersVisible = false,
        initialAreSortsVisible = false,
        initiallyFocus = null,
        defaultOrderSentence,
        filters,
        filterReferences,
        onFiltersChange,
        sorts,
        onSortsChange,
        excludeFilters,
    }: {
        store: TaskClientStore;
        queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
        initialAreFiltersVisible?: boolean;
        initialAreSortsVisible?: boolean;
        initiallyFocus?: "AddFilter" | "AddSort" | null;
        defaultOrderSentence: string;
        filters: ReadonlyArray<TaskQueryFilter>;
        filterReferences: TaskQueryFilterReferences;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
        excludeFilters?: ReadonlySet<TaskQueryFilter["type"]>;
    },
    ref: Ref<TaskQueryViewCustomizationMobileSectionRef>,
) {
    const addFilterMenuRef = useRef<OverlayTriggerButtonRef>(null);
    const addSortMenuRef = useRef<OverlayTriggerButtonRef>(null);

    const [areFiltersVisible, setAreFiltersVisible] = useState(
        initialAreFiltersVisible || initiallyFocus === "AddFilter" || filters.length > 0,
    );
    if (!areFiltersVisible && filters.length > 0) setAreFiltersVisible(true);

    const [areSortsVisible, setAreSortsVisible] = useState(
        initialAreSortsVisible || initiallyFocus === "AddSort" || sorts.length > 0,
    );
    if (!areSortsVisible && sorts.length > 0) setAreSortsVisible(true);

    const shouldFocusAddFilterMenuRef = useRef(initiallyFocus === "AddFilter");
    const shouldFocusAddSortMenuRef = useRef(initiallyFocus === "AddSort");

    useLayoutEffectWithoutServerSideWarning(() => {
        if (areFiltersVisible && shouldFocusAddFilterMenuRef.current) {
            shouldFocusAddFilterMenuRef.current = false;
            assertExists(addFilterMenuRef.current).open();
        }
    }, [areFiltersVisible]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (areSortsVisible && shouldFocusAddSortMenuRef.current) {
            shouldFocusAddSortMenuRef.current = false;
            assertExists(addSortMenuRef.current).open();
        }
    }, [areSortsVisible]);

    const firstCollectionsFilterOperationValueTriggerButtonRef =
        useRef<OverlayTriggerButtonRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            openAddFilterMenu: () => {
                if (areFiltersVisible) {
                    assertExists(addFilterMenuRef.current).open();
                } else {
                    shouldFocusAddFilterMenuRef.current = true;
                    setAreFiltersVisible(true);
                }
            },
            openAddSortMenu: () => {
                if (areSortsVisible) {
                    assertExists(addSortMenuRef.current).open();
                } else {
                    shouldFocusAddSortMenuRef.current = true;
                    setAreSortsVisible(true);
                }
            },
            openFirstCollectionsFilterOperationValue: () => {
                assertExists(firstCollectionsFilterOperationValueTriggerButtonRef.current).open();
            },
        }),
        [areFiltersVisible, areSortsVisible],
    );

    return (
        <Box
            paddingX={screenPaddingX}
            display="flex"
            flexDirection="column"
            gap={taskQueryViewCustomizationMobileSectionGap}
            paddingBottom={taskQueryViewCustomizationMobileSectionMarginBottom}
        >
            {areFiltersVisible && (
                <TaskQueryViewCustomizationMobileSectionFilters
                    store={store}
                    queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                    addFilterMenuRef={addFilterMenuRef}
                    filters={filters}
                    filterReferences={filterReferences}
                    onFiltersChange={onFiltersChange}
                    firstCollectionsFilterOperationValueTriggerButtonRef={
                        firstCollectionsFilterOperationValueTriggerButtonRef
                    }
                    excludeFilters={excludeFilters}
                />
            )}
            {areSortsVisible && (
                <TaskQueryViewCustomizationMobileSectionSorts
                    addSortMenuRef={addSortMenuRef}
                    defaultOrderSentence={defaultOrderSentence}
                    sorts={sorts}
                    onSortsChange={onSortsChange}
                />
            )}
        </Box>
    );
}

function TaskQueryViewCustomizationMobileSectionFilters({
    store,
    queryReferencesForUrlGrant,
    addFilterMenuRef,
    filters,
    filterReferences,
    onFiltersChange,
    firstCollectionsFilterOperationValueTriggerButtonRef,
    excludeFilters,
}: {
    store: TaskClientStore;
    queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
    addFilterMenuRef: RefObject<OverlayTriggerButtonRef | null>;
    filters: ReadonlyArray<TaskQueryFilter>;
    filterReferences: TaskQueryFilterReferences;
    onFiltersChange: (
        filters: ReadonlyArray<TaskQueryFilter>,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
    firstCollectionsFilterOperationValueTriggerButtonRef: RefObject<OverlayTriggerButtonRef | null>;
    excludeFilters?: ReadonlySet<TaskQueryFilter["type"]>;
}) {
    let hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = false;

    return (
        <Box>
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                height={taskQueryViewCustomizationMobileSectionHeaderHeight}
                marginBottom={taskQueryViewCustomizationMobileSectionHeaderMarginBottom}
            >
                <Box
                    fontSize={taskQueryViewCustomizationMobileSectionHeaderFontSize}
                    color="grey-80"
                    fontStyle="semi-bold"
                >
                    Filter
                </Box>
                <TaskQueryAddFilterMenuButton
                    ref={addFilterMenuRef}
                    placement="bottom-end"
                    offsetAlong="1"
                    onAddFilter={filter => {
                        onFiltersChange([filter, ...filters]);
                    }}
                    excludeFilters={excludeFilters}
                >
                    <Button
                        icon={<Plus />}
                        // Icon placed at the end since otherwise we'd have the text "Add" and it wouldn't
                        // be flush with the right border of our filters.
                        iconPlacement="end"
                        paddingX="1.5"
                        height={taskQueryViewCustomizationMobileSectionHeaderHeight}
                    >
                        Add
                    </Button>
                </TaskQueryAddFilterMenuButton>
            </Box>
            {filters.length === 0 ? (
                <Box
                    height={taskQueryViewCustomizationMobileSectionOptionHeight}
                    paddingX="3"
                    display="flex"
                    alignItems="center"
                    borderRadius="1"
                    color="grey-40"
                    fontSize="50"
                    style={{boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-5"]}`}}
                >
                    No filters. Tasks are hidden when closed.
                </Box>
            ) : (
                filters.map((filter, index) => {
                    // The first collections filter should get our ref.
                    let collectionsOperationValueTriggerButtonRef = null;
                    if (
                        filter.type === "Collections" &&
                        !hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef
                    ) {
                        hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = true;
                        collectionsOperationValueTriggerButtonRef =
                            firstCollectionsFilterOperationValueTriggerButtonRef;
                    }

                    return (
                        <Fragment key={index}>
                            {index !== 0 && <Box height="2" />}
                            <TaskQueryFilterEditor
                                key={index}
                                store={store}
                                queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                                filter={filter}
                                filterReferences={filterReferences}
                                onFilterChange={(filter, options) => {
                                    const newFilters = [...filters];
                                    newFilters[index] = filter;

                                    onFiltersChange(newFilters, options);
                                }}
                                onFilterRemove={() => {
                                    const newFilters = [...filters];
                                    newFilters.splice(index, 1);

                                    onFiltersChange(newFilters);
                                }}
                                collectionsOperationValueTriggerButtonRef={
                                    collectionsOperationValueTriggerButtonRef
                                }
                            />
                        </Fragment>
                    );
                })
            )}
        </Box>
    );
}

let nextSortId = 1;

function TaskQueryViewCustomizationMobileSectionSorts({
    addSortMenuRef,
    sorts,
    onSortsChange,
    defaultOrderSentence,
}: {
    addSortMenuRef: RefObject<OverlayTriggerButtonRef | null>;
    sorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    defaultOrderSentence: string;
}) {
    const [sortsWithId, actuallySetSortsWithId] = useState<
        ReadonlyArray<{id: number; sort: TaskQuerySort}>
    >(() => sorts.map(sort => ({id: nextSortId++, sort})));

    const setSortsWithId = (sortsWithId: ReadonlyArray<{id: number; sort: TaskQuerySort}>) => {
        actuallySetSortsWithId(sortsWithId);
        onSortsChange(sortsWithId.map(({sort}) => sort));
    };

    // We assign IDs to sort objects within this function. If we receive new sorts from
    // props that don't match our state then reset our state and regenerate IDs.
    if (
        !useMemo(
            () =>
                isDeepEqual(
                    sortsWithId.map(({sort}) => sort),
                    sorts,
                ),
            [sorts, sortsWithId],
        )
    ) {
        setSortsWithId(sorts.map(sort => ({id: nextSortId++, sort})));
    }

    const addSort = (sort: TaskQuerySort) => {
        const newSortsWithId = [...sortsWithId, {id: nextSortId++, sort}];
        setSortsWithId(newSortsWithId);
    };

    return (
        <Box>
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                height={taskQueryViewCustomizationMobileSectionHeaderHeight}
                marginBottom={taskQueryViewCustomizationMobileSectionHeaderMarginBottom}
            >
                <Box
                    fontSize={taskQueryViewCustomizationMobileSectionHeaderFontSize}
                    color="grey-80"
                    fontStyle="semi-bold"
                >
                    Sort
                </Box>
                <TaskQueryAddSortMenuButton
                    ref={addSortMenuRef}
                    placement="bottom-end"
                    offsetAlong="1"
                    onAddSort={addSort}
                >
                    <Button
                        icon={<Plus />}
                        // Icon placed at the end since otherwise we'd have the text "Add" and it wouldn't
                        // be flush with the right border of our filters.
                        iconPlacement="end"
                        paddingX="1.5"
                        height={taskQueryViewCustomizationMobileSectionHeaderHeight}
                        isDisabled={sortsWithId.length >= 5}
                    >
                        Add
                    </Button>
                </TaskQueryAddSortMenuButton>
            </Box>
            <TaskQuerySortsEditor
                sortsWithId={sortsWithId}
                onSortsWithIdChange={setSortsWithId}
                defaultOrderSentence={defaultOrderSentence}
            />
        </Box>
    );
}
