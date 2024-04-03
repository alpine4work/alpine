import {Plus} from "phosphor-react";
import {Ref, RefObject, forwardRef, useImperativeHandle, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {OverlayTriggerButtonRef} from "~/client/design/overlay_trigger_button.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {TaskQueryAddFilterMenuButton} from "~/client/tasks/internal/task_query_add_filter_menu_button.js";
import {TaskQueryAddSortMenuButton} from "~/client/tasks/internal/task_query_add_sort_menu_button.js";
import {TaskQuerySortsEditor} from "~/client/tasks/internal/task_query_sorts_editor.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskQueryViewCustomizationMobileSectionRef = {
    openAddFilterMenu(): void;
    openAddSortsMenu(): void;
};

const TaskQueryViewCustomizationMobileSectionForwardRef = forwardRef(
    TaskQueryViewCustomizationMobileSection,
);
export {TaskQueryViewCustomizationMobileSectionForwardRef as TaskQueryViewCustomizationMobileSection};

function TaskQueryViewCustomizationMobileSection(
    {
        initiallyFocus,
        defaultOrderSentence,
        filters,
        onFiltersChange,
        sorts,
        onSortsChange,
    }: {
        initiallyFocus: "AddFilter" | "AddSort" | null;
        defaultOrderSentence: string;
        filters: ReadonlyArray<TaskQueryFilter>;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    },
    ref: Ref<TaskQueryViewCustomizationMobileSectionRef>,
) {
    const addFilterMenuRef = useRef<OverlayTriggerButtonRef>(null);
    const addSortMenuRef = useRef<OverlayTriggerButtonRef>(null);

    const [areFiltersVisible, setAreFiltersVisible] = useState(
        initiallyFocus === "AddFilter" || filters.length > 0,
    );
    if (!areFiltersVisible && filters.length > 0) setAreFiltersVisible(true);

    const [areSortsVisible, setAreSortsVisible] = useState(
        initiallyFocus === "AddSort" || sorts.length > 0,
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
            openAddSortsMenu: () => {
                if (areSortsVisible) {
                    assertExists(addSortMenuRef.current).open();
                } else {
                    shouldFocusAddSortMenuRef.current = true;
                    setAreSortsVisible(true);
                }
            },
        }),
        [areFiltersVisible, areSortsVisible],
    );

    return (
        <Box
            paddingX={taskRowViewPaddingX}
            display="flex"
            flexDirection="column"
            gap="4"
            paddingTop="1"
            paddingBottom="6"
        >
            {areFiltersVisible && (
                <Box>
                    <Box
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        paddingY="1"
                    >
                        <Box fontSize="100" color="grey-80" fontStyle="semi-bold">
                            Filters
                        </Box>
                        <TaskQueryAddFilterMenuButton
                            ref={addFilterMenuRef}
                            onAddFilter={filter => {
                                onFiltersChange([filter, ...filters]);
                            }}
                        >
                            <Button icon={<Plus />} paddingX="2" height="6">
                                Add
                            </Button>
                        </TaskQueryAddFilterMenuButton>
                    </Box>
                    <Box
                        height="9"
                        paddingX="3"
                        display="flex"
                        alignItems="center"
                        borderRadius="base"
                        color="grey-40"
                        fontSize="50"
                        style={{boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-5"]}`}}
                    >
                        No filters. Tasks are hidden when closed.
                    </Box>
                </Box>
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

let nextSortId = 1;

function TaskQueryViewCustomizationMobileSectionSorts({
    addSortMenuRef,
    sorts,
    onSortsChange,
    defaultOrderSentence,
}: {
    addSortMenuRef: RefObject<OverlayTriggerButtonRef>;
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
        <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" paddingY="1">
                <Box fontSize="100" color="grey-80" fontStyle="semi-bold">
                    Sorts
                </Box>
                <TaskQueryAddSortMenuButton ref={addSortMenuRef} onAddSort={addSort}>
                    <Button
                        icon={<Plus />}
                        paddingX="2"
                        height="6"
                        isDisabled={sortsWithId.length >= 5}
                    >
                        Add
                    </Button>
                </TaskQueryAddSortMenuButton>
            </Box>
            <TaskQuerySortsEditor
                withMobileLayout={true}
                sortsWithId={sortsWithId}
                onSortsWithIdChange={setSortsWithId}
                defaultOrderSentence={defaultOrderSentence}
            />
        </Box>
    );
}
