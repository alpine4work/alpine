import {Plus, SortAscending} from "phosphor-react";
import {Ref, forwardRef, useImperativeHandle, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {desktopNavigationBarHeightRem} from "~/client/design/navigation_bar.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/design/overlay_trigger_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {TaskQueryAddFilterMenuButton} from "~/client/tasks/internal/task_query_add_filter_menu_button.js";
import {TaskQueryAddSortMenuButton} from "~/client/tasks/internal/task_query_add_sort_menu_button.js";
import {
    TaskQueryFilterEditor,
    desktopTaskQueryFilterEditorHeight,
} from "~/client/tasks/internal/task_query_filter_editor.js";
import {TaskQuerySortsEditor} from "~/client/tasks/internal/task_query_sorts_editor.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {greyElevated2ClassName} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

const desktopTaskQueryViewCustomizationBarMarginYRem =
    (desktopNavigationBarHeightRem -
        parseRemLengthNumber(spacing[desktopTaskQueryFilterEditorHeight])) /
    2;

export const desktopTaskQueryViewCustomizationBarMarginY = `${desktopTaskQueryViewCustomizationBarMarginYRem}rem`;

export type TaskQueryViewCustomizationBarRef = {
    // Throws if no collection filter editor component is mounted. So be careful
    // when calling this function.
    openFirstCollectionsFilterOperationValue(): void;
};

const TaskQueryViewCustomizationBarForwardRef = forwardRef(TaskQueryViewCustomizationBar);
export {TaskQueryViewCustomizationBarForwardRef as TaskQueryViewCustomizationBar};

function TaskQueryViewCustomizationBar(
    {
        store,
        filters,
        filterReferences,
        onFiltersChange,
        shouldCollapseWhenFiltersAreEmpty,
        sorts,
        onSortsChange,
        defaultOrderSentence,
    }: {
        store: TaskClientStore;
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
    },
    ref: Ref<TaskQueryViewCustomizationBarRef>,
) {
    const shouldCollapse = shouldCollapseWhenFiltersAreEmpty && filters.length === 0;

    const firstCollectionsFilterOperationValueTriggerButtonRef =
        useRef<OverlayTriggerButtonRef>(null);
    let hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = false;

    useImperativeHandle(
        ref,
        () => ({
            openFirstCollectionsFilterOperationValue: () =>
                assertExists(firstCollectionsFilterOperationValueTriggerButtonRef.current).open(),
        }),
        [],
    );

    return (
        <Box
            display="flex"
            alignItems="flex-start"
            style={{minHeight: desktopTaskQueryFilterEditorHeight}}
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
            >
                {filters.map((filter, index) => {
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
                        <TaskQueryFilterEditor
                            key={index}
                            withMobileLayout={false}
                            store={store}
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
                <Box height={desktopTaskQueryFilterEditorHeight} display="flex" alignItems="center">
                    <TaskQueryAddFilterMenuButton
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
                                height={desktopTaskQueryFilterEditorHeight}
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
                    aria-haspopup={true}
                    overlay={
                        <Box
                            className={greyElevated2ClassName}
                            overflow="hidden"
                            borderRadius="md"
                            backgroundColor="grey-0"
                            boxShadow="elevation-20"
                        >
                            <TaskQueryViewCustomizationBarSortsOverlay
                                sorts={sorts}
                                onSortsChange={onSortsChange}
                                defaultOrderSentence={defaultOrderSentence}
                            />
                        </Box>
                    }
                >
                    <Button
                        icon={<SortAscending />}
                        height={desktopTaskQueryFilterEditorHeight}
                        paddingX="2"
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
}: {
    sorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    defaultOrderSentence: string;
}) {
    const [sortsWithId, _setSortsWithId] = useState<Array<{id: number; sort: TaskQuerySort}>>(() =>
        sorts.map(sort => ({id: nextSortId++, sort})),
    );

    const setSortsWithId = (sortsWithId: Array<{id: number; sort: TaskQuerySort}>) => {
        _setSortsWithId(sortsWithId);
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

    return (
        <Box width="96" padding="4" overflow="hidden">
            <TaskQuerySortsEditor
                withMobileLayout={false}
                sortsWithId={sortsWithId}
                onSortsWithIdChange={setSortsWithId}
                defaultOrderSentence={defaultOrderSentence}
            />
            <Spacer space="4" />
            <TaskQueryAddSortMenuButton onAddSort={addSort}>
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
