import classNames from "classnames";
import {Plus} from "phosphor-react";
import {
    FocusEvent,
    KeyboardEvent,
    Memo,
    Ref,
    forwardRef,
    memo,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/web/helpers/use_hover_with_overlay_support.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {inputPlaceholderStyles, sprinkles, tasksStyles} from "~/client/web/styles/styles.js";
import {
    maxTaskRowViewCollectionsColumnWidth,
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {createDisplayTaskCollectionsStore} from "~/client/web/tasks/internal/create_display_task_collections_store.js";
import {TaskCollectionChip} from "~/client/web/tasks/internal/task_collection_chip.js";
import {TaskRowCollectionsCellOverlay} from "~/client/web/tasks/internal/task_row_collections_cell_overlay.js";
import {TaskGridViewColumn} from "~/client/web/tasks/internal/task_row_view.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {emptyArrayStore} from "~/shared/store/const_store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskQueryCollectionsNormalizedFilter} from "~/shared/tasks/task_query_normalized_filters.js";

export type TaskRowCollectionsCellRef = {
    focusCell(): void;
    focusCellInputStart(): void;
    isFocusWithinCell(): boolean;
};

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const TaskRowCollectionsCellForwardRefMemo = memo(forwardRef(TaskRowCollectionsCell));
export {TaskRowCollectionsCellForwardRefMemo as TaskRowCollectionsCell};

function TaskCollectionChipWithNavigation({
    collection,
    nameMaxWidth,
}: {
    collection: TaskCollectionModel;
    nameMaxWidth?: Spacing;
}) {
    const {space} = useSpaceContext();
    const navigate = useNavigate();
    const [isPendingNavigation, setIsPendingNavigation] = useState(false);

    return (
        <TaskCollectionChip
            collection={collection}
            nameMaxWidth={nameMaxWidth}
            onPress={() => {
                if (isPendingNavigation) return;

                setIsPendingNavigation(true);

                navigate(`/s/${space.id}/tasks/collections/${collection.id}`).finally(() => {
                    setIsPendingNavigation(false);
                });
            }}
        />
    );
}

const cellRowGap = "3";

const cellClassName = sprinkles({
    flexShrink: "0",
    paddingLeft: taskRowViewColumnPaddingX,
    paddingRight: taskRowViewLastColumnPaddingRight,
    // Important not to set `overflow="hidden"` here so that the editable collections
    // overlay can render outside the bounds of this cell.
    overflow: undefined,
    position: "relative",
    height: taskRowViewMinHeight,
    display: "flex",
    alignItems: "center",
    rowGap: cellRowGap,
    columnGap: "2.5",
});

const emptyCollectionsClassName = sprinkles({
    display: "flex",
    alignItems: "center",
    gap: "0.5",
    pointerEvents: "none",
});

const collectionChipContainerClassName = sprinkles({
    marginY: "-0.5",
    marginLeft: "-0.5",
    cursor: "default",
    minWidth: "flex-fit",
});

const extraCollectionsWidth = "4";

const extraCollectionsClassName = sprinkles({
    color: "grey-70",
    pointerEvents: "none",
    width: extraCollectionsWidth,
    flexShrink: "0",
});

function TaskRowCollectionsCell(
    {
        isReadOnly,
        store,
        query,
        task,
        onCellKeyDown,
        onCellKeyDownCapture,
        focusPreviousCell,
        commitActionTransaction,
    }: {
        isReadOnly: boolean;
        store: TaskClientReadonlyStore;
        query: TaskClientQuery | null;
        task: TaskModel | null;
        onCellKeyDown: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        commitActionTransaction: Memo<
            (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void
        >;
    },
    ref: Ref<TaskRowCollectionsCellRef>,
) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const {currentAccount} = useSpaceContext();
    const cellId = useId();

    const collections = task?.getCollections() ?? TaskCollectionSet.empty;

    const displayCollections = useStore(
        useMemo(
            () =>
                query !== null
                    ? createDisplayTaskCollectionsStore({
                          currentAccount,
                          referencesSubscription: query,
                          collections,
                      })
                    : emptyArrayStore,
            [collections, currentAccount, query],
        ),
    );

    const queryFiltersRequiredCollectionIds =
        query !== null && query.filters.collectionsFilter
            ? taskQueryCollectionsNormalizedFilterRequiredIdsCache.getOrSetDefault(
                  query.filters.collectionsFilter,
              )
            : emptySet;

    // We want to show collections that are not required by the query first, then if we
    // still have room show collections required by the query.
    const {previewDisplayCollections, doesPreviewDisplayCollectionsHaveRequiredCollection} =
        useMemo(() => {
            const maxPreviewDisplayCollectionCount = 2;
            const previewDisplayCollections: Array<TaskCollectionModel> = [];
            let doesPreviewDisplayCollectionsHaveRequiredCollection = false;

            for (const collection of displayCollections) {
                if (queryFiltersRequiredCollectionIds.has(collection.id)) continue;

                previewDisplayCollections.push(collection);
                if (previewDisplayCollections.length >= maxPreviewDisplayCollectionCount)
                    return {
                        previewDisplayCollections,
                        doesPreviewDisplayCollectionsHaveRequiredCollection,
                    };
            }

            for (const collection of displayCollections) {
                if (!queryFiltersRequiredCollectionIds.has(collection.id)) continue;

                doesPreviewDisplayCollectionsHaveRequiredCollection = true;
                previewDisplayCollections.push(collection);
                if (previewDisplayCollections.length >= maxPreviewDisplayCollectionCount)
                    return {
                        previewDisplayCollections,
                        doesPreviewDisplayCollectionsHaveRequiredCollection,
                    };
            }

            return {previewDisplayCollections, doesPreviewDisplayCollectionsHaveRequiredCollection};
        }, [displayCollections, queryFiltersRequiredCollectionIds]);

    const cellRef = useRef<HTMLDivElement>(null);
    const cellOverlayRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    const getIsFocusWithin = (activeElement: Element | null) =>
        !!activeElement && isElementOwnedBy(assertExists(cellRef.current), activeElement);

    const handleFocusChange = (event: FocusEvent) => {
        const activeElement =
            event.type === "blur"
                ? (event.relatedTarget ?? document.activeElement)
                : document.activeElement;

        setIsFocusWithin(getIsFocusWithin(activeElement));
    };

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInputStart: () => {
                if (!getIsFocusWithin(document.activeElement)) {
                    shouldFocusStartNextRenderRef.current = true;
                    assertExists(cellRef.current).focus();
                } else {
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(cellOverlayRef.current),
                    })?.focus();
                }
            },
            isFocusWithinCell: () =>
                !!document.activeElement &&
                isElementOwnedBy(assertExists(cellRef.current), document.activeElement),
        }),
        [],
    );

    const shouldFocusTextInputNextRenderRef = useRef(false);
    const shouldFocusStartNextRenderRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isFocusWithin) return;

        if (!shouldFocusTextInputNextRenderRef.current) return;
        shouldFocusTextInputNextRenderRef.current = false;

        if (isReadOnly) return;

        assertExists(cellOverlayRef.current?.querySelector("input")).focus();
    }, [isFocusWithin, isReadOnly]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isFocusWithin) return;

        if (!shouldFocusStartNextRenderRef.current) return;
        shouldFocusStartNextRenderRef.current = false;

        if (isReadOnly) return;

        getNextFocusableElementIfExists(null, {
            withinElement: assertExists(cellOverlayRef.current),
        })?.focus();
    }, [isFocusWithin, isReadOnly]);

    return (
        <div
            ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
            data-testid={
                process.env.NODE_ENV !== "production" ? "TaskRowCollectionsCell" : undefined
            }
            id={cellId}
            tabIndex={-1}
            className={classNames(
                !isReadOnly && tasksStyles.textCursorNotInheritedClassName,
                cellClassName,
            )}
            style={{width: taskRowViewCollectionsColumnWidth}}
            onFocus={handleFocusChange}
            onBlur={handleFocusChange}
            onKeyDown={event => {
                switch (event.key) {
                    case "Backspace":
                    case "Delete": {
                        if (event.currentTarget === event.target) {
                            event.preventDefault();
                            event.stopPropagation();

                            if (!isReadOnly) {
                                commitActionTransaction(taskId => {
                                    const time = store.clock.now();

                                    return displayCollections.map(
                                        (collection): TaskActionModel => ({
                                            type: "UpdateTask",
                                            time,
                                            taskId,
                                            taskAction: {
                                                type: "RemoveCollection",
                                                collectionId: collection.id,
                                            },
                                        }),
                                    );
                                });
                            }
                        }
                        break;
                    }
                    default: {
                        onCellKeyDown("Collections", event);
                        break;
                    }
                }
            }}
            onKeyDownCapture={event => onCellKeyDownCapture("Collections", event)}
            onPointerDown={event => {
                if (event.target === event.currentTarget) {
                    event.preventDefault();

                    if (!isFocusWithin) {
                        shouldFocusTextInputNextRenderRef.current = displayCollections.length === 0;
                        assertExists(cellRef.current).focus();
                    }
                }
            }}
        >
            {!isFocusWithin ? (
                displayCollections.length === 0 ? (
                    !isReadOnly && (
                        <div
                            className={emptyCollectionsClassName}
                            style={{
                                ...inputPlaceholderStyles,
                                opacity: isHovered ? 1 : 0,
                            }}
                        >
                            <Plus size={spacing["3"]} />
                            <div>Add</div>
                        </div>
                    )
                ) : (
                    <>
                        {previewDisplayCollections.map(collection => (
                            <div
                                key={collection.id}
                                className={collectionChipContainerClassName}
                                style={{
                                    // We want short collection names like "Bugs" to be visible even if the other
                                    // preview collection name is very long. Constrain collection chip width and set a
                                    // relative shrink that shrinks longer collection names more than shorter
                                    // collection names.
                                    //
                                    // Also shrink collection chips required by the query more than collection chips
                                    // which aren't required.
                                    //
                                    // These constants were picked so that if you have two very long task collection
                                    // names (with colors) and the second is a required task collection, then we'll
                                    // show at least two characters from the shrunk required task collection. e.g. In
                                    // one test two collections named "Test Very Very Very Very Very Very Long"
                                    // truncated like this (remember the second needs to be a required collection):
                                    //
                                    // ```
                                    // ┌──────────────────────┐ ┌─────────┐
                                    // │ • Test Very Very ... │ │ • Te... │
                                    // └──────────────────────┘ └─────────┘
                                    // ```
                                    flexShrink: Math.max(
                                        0,
                                        Math.min(
                                            (collection.getColor() !== null ? 1 : 0) +
                                                Math.round(collection.getName().length) -
                                                7,
                                            15,
                                        ) -
                                            (doesPreviewDisplayCollectionsHaveRequiredCollection &&
                                            !queryFiltersRequiredCollectionIds.has(collection.id)
                                                ? 7
                                                : 0),
                                    ),
                                }}
                            >
                                <TaskCollectionChipWithNavigation
                                    collection={collection}
                                    // We need to set a max width for the name or else really really long names will
                                    // cause flex items with a ridiculously large `flex-basis` (given `flex-basis` is
                                    // the default, `auto`).
                                    nameMaxWidth={maxTaskRowViewCollectionsColumnWidth}
                                />
                            </div>
                        ))}
                        {displayCollections.length > previewDisplayCollections.length && (
                            <div
                                className={extraCollectionsClassName}
                                // eslint-disable-next-line cyberworlds/string-quotes
                                style={{fontFeatureSettings: '"calt"'}}
                            >
                                {`+${displayCollections.length - 2}`}
                            </div>
                        )}
                    </>
                )
            ) : (
                <TaskRowCollectionsCellOverlay
                    ref={cellOverlayRef}
                    cellId={cellId}
                    isReadOnly={isReadOnly}
                    store={store}
                    query={query}
                    task={task}
                    focusPreviousCell={() => focusPreviousCell("Collections")}
                    cellRef={cellRef}
                    onClose={() => {
                        assertExists(cellRef.current).blur();

                        // Make sure we immediately un-render so `onReturnFocus` in
                        // `<TaskCollectionsInput>` won't put focus back on our cell.
                        flushSync(() => setIsFocusWithin(false));
                    }}
                    commitActionTransaction={commitActionTransaction}
                />
            )}
        </div>
    );
}

const taskQueryCollectionsNormalizedFilterRequiredIdsCache = new DefaultWeakMap(
    (filters: TaskQueryCollectionsNormalizedFilter) => {
        const collectionIds = new Set<TaskCollectionId>();

        for (const filter of filters) {
            if (filter.size !== 1) continue;

            for (const [term, not] of filter) {
                if (term === "IsEmpty") continue;
                if (not) continue;

                collectionIds.add(term);
            }
        }

        return collectionIds;
    },
);
