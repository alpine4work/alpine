import classNames from "classnames";
import {Plus} from "phosphor-react";
import {
    KeyboardEvent,
    Memo,
    Ref,
    forwardRef,
    memo,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {createDisplayTaskCollectionsStore} from "~/client/tasks/internal/create_display_task_collections_store.js";
import {TaskCollectionChip} from "~/client/tasks/internal/task_collection_chip.js";
import {TaskRowCollectionsCellOverlay} from "~/client/tasks/internal/task_row_collections_cell_overlay.js";
import {TaskGridViewColumn} from "~/client/tasks/internal/task_row_view.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/task_client_store.js";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {inputPlaceholderStyles, sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";

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

const cellClassName = sprinkles({
    flexShrink: "0",
    width: taskRowViewCollectionsColumnWidth,
    paddingLeft: taskRowViewColumnPaddingX,
    paddingRight: taskRowViewLastColumnPaddingRight,
    // Important not to set `overflow="hidden"` here so that the editable
    // collections overlay can render outside the bounds of this cell.
    overflow: undefined,
    position: "relative",
    height: taskRowViewMinHeight,
    display: "flex",
    alignItems: "center",
    rowGap: "3",
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
});

const extraCollectionsClassName = sprinkles({
    color: "grey-70",
    pointerEvents: "none",
});

function TaskRowCollectionsCell(
    {
        isReadOnly,
        query,
        undoManager,
        affinityManager,
        task,
        onCellKeyDown,
        onCellKeyDownCapture,
        focusPreviousCell,
        setRowZIndex,
        commitActionTransactionEvenIfGhost,
    }: {
        isReadOnly: boolean;
        query: TaskClientQuery;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        task: TaskModel | null;
        onCellKeyDown: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        setRowZIndex: Memo<(zIndex: number) => () => void>;
        commitActionTransactionEvenIfGhost: Memo<
            (
                getActions: (taskId: TaskId) => Array<TaskAction>,
                options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
            ) => void
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

    const collections = task?.getCollections() ?? TaskCollectionSet.empty;

    const displayCollections = useStore(
        useMemo(
            () =>
                createDisplayTaskCollectionsStore({
                    currentAccount,
                    referencesSubscription: query,
                    collections,
                }),
            [collections, currentAccount, query],
        ),
    );

    const cellRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInputStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(cellRef.current),
                })?.focus();
            },
            isFocusWithinCell: () =>
                !!document.activeElement &&
                isElementOwnedBy(assertExists(cellRef.current), document.activeElement),
        }),
        [],
    );

    const shouldFocusTextInputNextRenderRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isFocusWithin) return;

        if (!shouldFocusTextInputNextRenderRef.current) return;
        shouldFocusTextInputNextRenderRef.current = false;

        if (isReadOnly) return;

        assertExists(cellRef.current?.querySelector("input")).focus();
    }, [isFocusWithin, isReadOnly]);

    // If collections are expanded then make sure our task row renders on top of
    // all other task rows.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isFocusWithin) return;

        return setRowZIndex(40);
    }, [isFocusWithin, setRowZIndex]);

    return (
        <div
            ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
            data-testid={
                process.env.NODE_ENV !== "production" ? "TaskRowCollectionsCell" : undefined
            }
            tabIndex={-1}
            className={classNames(
                !isReadOnly && tasksStyles.textCursorNotInheritedClassName,
                cellClassName,
            )}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
            onKeyDown={event => {
                switch (event.key) {
                    case "Backspace":
                    case "Delete": {
                        if (event.currentTarget === event.target) {
                            event.preventDefault();
                            event.stopPropagation();

                            if (!isReadOnly) {
                                commitActionTransactionEvenIfGhost(taskId => {
                                    const time = query.store.clock.now();

                                    return displayCollections.map(
                                        (collection): TaskAction => ({
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
                    shouldFocusTextInputNextRenderRef.current = true;
                    assertExists(cellRef.current).focus();
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
                        {displayCollections.slice(0, 2).map(collection => (
                            <div
                                key={collection.id}
                                className={collectionChipContainerClassName}
                                style={{
                                    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                    // have `min-width: auto` which extends with content.
                                    // https://stackoverflow.com/a/66689926/1568890
                                    minWidth: 0,
                                }}
                                onPointerDown={event => {
                                    event.preventDefault();
                                    assertExists(cellRef.current).focus();
                                }}
                            >
                                <TaskCollectionChip collection={collection} />
                            </div>
                        ))}
                        {displayCollections.length > 2 && (
                            <div
                                className={extraCollectionsClassName}
                                style={{fontFeatureSettings: '"calt"'}}
                            >
                                {`+${displayCollections.length - 2}`}
                            </div>
                        )}
                    </>
                )
            ) : (
                <TaskRowCollectionsCellOverlay
                    isReadOnly={isReadOnly}
                    query={query}
                    undoManager={undoManager}
                    affinityManager={affinityManager}
                    task={task}
                    focusPreviousCell={() => focusPreviousCell("Collections")}
                    cellRef={cellRef}
                    commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                />
            )}
        </div>
    );
}
