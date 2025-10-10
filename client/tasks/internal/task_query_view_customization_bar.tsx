import {Plus, SortAscending} from "phosphor-react";
import {
    MutableRefObject,
    Ref,
    forwardRef,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/design/overlay_trigger_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {taskQueryFilterEditorDesktopHeight} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientStore} from "~/client/tasks/core/task_client_store.js";
import {TaskQueryAddFilterMenuButton} from "~/client/tasks/internal/task_query_add_filter_menu_button.js";
import {TaskQueryAddSortMenuButton} from "~/client/tasks/internal/task_query_add_sort_menu_button.js";
import {TaskQueryFilterEditor} from "~/client/tasks/internal/task_query_filter_editor.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskQuerySortsEditor} from "~/client/tasks/internal/task_query_sorts_editor.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskQueryViewCustomizationBarRef = {
    openAddFilterMenu(): void;
    openAddSortMenu(): void;
    // Throws if no collection filter editor component is mounted. So be careful
    // when calling this function.
    openFirstCollectionsFilterOperationValue(): void;
};

const TaskQueryViewCustomizationBarForwardRef = forwardRef(TaskQueryViewCustomizationBar);
export {TaskQueryViewCustomizationBarForwardRef as TaskQueryViewCustomizationBar};

function TaskQueryViewCustomizationBar(
    {
        store,
        queryReferencesForUrlGrant,
        filters,
        filterReferences,
        onFiltersChange,
        shouldCollapseWhenFiltersAreEmpty,
        sorts,
        onSortsChange,
        defaultOrderSentence,
        initiallyFocus = null,
    }: {
        store: TaskClientStore;
        queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
        filters: ReadonlyArray<TaskQueryFilter>;
        filterReferences: TaskQueryFilterReferences;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        shouldCollapseWhenFiltersAreEmpty: boolean;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
        defaultOrderSentence: string;
        initiallyFocus?: "AddFilter" | "AddSort" | null;
    },
    ref: Ref<TaskQueryViewCustomizationBarRef>,
) {
    const routeLayout = useRouteLayout();

    const addFilterMenuRef = useRef<OverlayTriggerButtonRef>(null);
    const sortsOverlayRef = useRef<OverlayTriggerButtonRef>(null);

    const shouldCollapse = shouldCollapseWhenFiltersAreEmpty && filters.length === 0;

    const firstCollectionsFilterOperationValueTriggerButtonRef =
        useRef<OverlayTriggerButtonRef>(null);
    let hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = false;

    const shouldOpenAddFilterMenuRef = useRef(initiallyFocus === "AddFilter");
    const shouldOpenAddSortMenu1Ref = useRef(initiallyFocus === "AddSort");
    const shouldOpenAddSortMenu2Ref = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldOpenAddFilterMenuRef.current) {
            shouldOpenAddFilterMenuRef.current = false;
            assertExists(addFilterMenuRef.current).open();
        }
    }, []);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldOpenAddSortMenu1Ref.current) {
            shouldOpenAddSortMenu1Ref.current = false;
            shouldOpenAddSortMenu2Ref.current = true;
            assertExists(sortsOverlayRef.current).open();
        }
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            openAddFilterMenu: () => {
                assertExists(addFilterMenuRef.current).open();
            },
            openAddSortMenu: () => {
                shouldOpenAddSortMenu2Ref.current = true;
                assertExists(sortsOverlayRef.current).open();
            },
            openFirstCollectionsFilterOperationValue: () => {
                assertExists(firstCollectionsFilterOperationValueTriggerButtonRef.current).open();
            },
        }),
        [],
    );

    return (
        <Box
            display="flex"
            alignItems="flex-start"
            style={{minHeight: taskQueryFilterEditorDesktopHeight}}
        >
            {filters.length > 0 && (
                <Box height="6" display="flex" alignItems="center" paddingRight="2">
                    Filter:
                </Box>
            )}
            <Box
                flexGrow={!shouldCollapse ? "1" : undefined}
                display="flex"
                flexWrap="wrap"
                alignItems="center"
                gap="2"
                marginLeft={shouldCollapse ? "-2" : undefined}
                style={{
                    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                    // have `min-width: auto` which extends with content.
                    // https://stackoverflow.com/a/66689926/1568890
                    minWidth: 0,
                }}
            >
                {filters.map((filter, index) => {
                    // The first collections filter should get our ref.
                    let collectionsOperationValueTriggerButtonRef = null;
                    if (
                        filter.type === "Collections" &&
                        !hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef
                    ) {
                        // eslint-disable-next-line react-compiler/react-compiler
                        hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = true;
                        collectionsOperationValueTriggerButtonRef =
                            firstCollectionsFilterOperationValueTriggerButtonRef;
                    }

                    return (
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
                    );
                })}
                <Box height={taskQueryFilterEditorDesktopHeight} display="flex" alignItems="center">
                    <TaskQueryAddFilterMenuButton
                        ref={addFilterMenuRef}
                        onAddFilter={filter => {
                            onFiltersChange([...filters, filter]);
                        }}
                    >
                        {filters.length > 0 ? (
                            <IconButton size="sm" description="Add filter" withoutTooltip>
                                <Plus size={spacing["3"]} />
                            </IconButton>
                        ) : (
                            <Button
                                variant={shouldCollapse ? "quiet" : "neutral"}
                                icon={<Plus />}
                                height={taskQueryFilterEditorDesktopHeight}
                                paddingX="2"
                            >
                                Add filter
                            </Button>
                        )}
                    </TaskQueryAddFilterMenuButton>
                </Box>
            </Box>
            <Box paddingLeft={!shouldCollapse ? "5" : "2"}>
                <OverlayTriggerButton
                    ref={sortsOverlayRef}
                    aria-haspopup={true}
                    placement={routeLayout === "narrow" ? "bottom-end" : "bottom-start"}
                    overlay={
                        <Box
                            className={greyElevated2ClassName}
                            overflow="hidden"
                            borderRadius="1.5"
                            backgroundColor="grey-0"
                            boxShadow="elevation-20"
                        >
                            <TaskQueryViewCustomizationBarSortsOverlay
                                sorts={sorts}
                                onSortsChange={onSortsChange}
                                defaultOrderSentence={defaultOrderSentence}
                                shouldOpenAddSortMenu2Ref={shouldOpenAddSortMenu2Ref}
                            />
                        </Box>
                    }
                >
                    <Button
                        icon={<SortAscending />}
                        height={taskQueryFilterEditorDesktopHeight}
                        paddingX="2"
                        // Don't focus the button on press since pressing will open the overlay and
                        // should focus the overlay.
                        //
                        // TODO(calebmer): Find a way to automate this instead of setting this prop
                        // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
                        withoutFocusOnPress={true}
                    >
                        {sorts.length === 0
                            ? "Sort"
                            : sorts.length === 1
                            ? "Sort: 1"
                            : `Sorts: ${sorts.length}`}
                    </Button>
                </OverlayTriggerButton>
            </Box>
        </Box>
    );
}

let nextSortId = 1;

function TaskQueryViewCustomizationBarSortsOverlay({
    sorts,
    onSortsChange,
    defaultOrderSentence,
    shouldOpenAddSortMenu2Ref,
}: {
    sorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    defaultOrderSentence: string;
    shouldOpenAddSortMenu2Ref: MutableRefObject<boolean>;
}) {
    const addSortMenuRef = useRef<OverlayTriggerButtonRef>(null);

    const [sortsWithId, actuallySetSortsWithId] = useState<
        ReadonlyArray<{id: number; sort: TaskQuerySort}>
    >(() => sorts.map(sort => ({id: nextSortId++, sort})));

    const setSortsWithId = (sortsWithId: ReadonlyArray<{id: number; sort: TaskQuerySort}>) => {
        actuallySetSortsWithId(sortsWithId);
        onSortsChange(sortsWithId.map(({sort}) => sort));
    };

    // We assign IDs to sort objects within this function. If we receive new sorts
    // from props that don't match our state then reset our state and
    // regenerate IDs.
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

    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldOpenAddSortMenu2Ref.current) {
            shouldOpenAddSortMenu2Ref.current = false;
            assertExists(addSortMenuRef.current).open();
        }
    }, [shouldOpenAddSortMenu2Ref]);

    return (
        <Box width="96" padding="4" overflow="hidden">
            <TaskQuerySortsEditor
                sortsWithId={sortsWithId}
                onSortsWithIdChange={setSortsWithId}
                defaultOrderSentence={defaultOrderSentence}
            />
            <Spacer space="4" />
            <TaskQueryAddSortMenuButton ref={addSortMenuRef} onAddSort={addSort}>
                <Button
                    variant="outline"
                    icon={<Plus />}
                    height="6"
                    paddingX="2"
                    isDisabled={sortsWithId.length >= 5}
                >
                    Add sort
                </Button>
            </TaskQueryAddSortMenuButton>
        </Box>
    );
}
