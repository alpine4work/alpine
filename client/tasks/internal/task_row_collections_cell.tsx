import classNames from "classnames";
import {Lock} from "phosphor-react";
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
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {TaskCollectionChip} from "~/client/tasks/internal/task_collection_chip.js";
import {TaskRowCollectionsCellOverlay} from "~/client/tasks/internal/task_row_collections_cell_overlay.js";
import {TaskGridViewColumn} from "~/client/tasks/internal/task_row_view.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
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
    gap: "1",
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
        query,
        task,
        onCellKeyDown,
        onCellKeyDownCapture,
        focusPreviousCell,
        setRowZIndex,
        commitActionTransaction,
    }: {
        query: TaskClientQuery;
        task: TaskModel | null;
        onCellKeyDown: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        setRowZIndex: Memo<(zIndex: number) => () => void>;
        commitActionTransaction: Memo<
            (
                getActions: (taskId: TaskId) => Array<TaskAction>,
                options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
            ) => void
        >;
    },
    ref: Ref<TaskRowCollectionsCellRef>,
) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this file. It is critical for scroll performance that this component renders
    // fast. Use the `sprinkles()` function in the module body instead. We've
    // observed while profiling the sprinkles function takes a meaningful amount of
    // time during render.
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

    const collections = task?.getCollections() ?? TaskCollectionSet.empty;

    const collectionsArray = useStore(
        useMemo(() => {
            return computeStore(get => {
                return collections.getArray().filter(({collectionId}) => {
                    const {collection} = get(query.getReferencedCollectionEntryStore(collectionId));
                    return collection && !collection.isDeleted();
                });
            });
        }, [collections, query]),
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
        }),
        [],
    );

    const shouldFocusTextInputNextRenderRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isFocusWithin) return;

        if (!shouldFocusTextInputNextRenderRef.current) return;
        shouldFocusTextInputNextRenderRef.current = false;

        assertExists(cellRef.current?.querySelector("input")).focus();
    }, [isFocusWithin]);

    // If collections are expanded then make sure our task row renders on top of
    // all other task rows.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isFocusWithin) return;

        return setRowZIndex(10);
    }, [isFocusWithin, setRowZIndex]);

    return (
        <div
            ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
            tabIndex={-1}
            className={classNames(tasksStyles.textCursorNotInheritedClassName, cellClassName)}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
            onKeyDown={event => onCellKeyDown("Collections", event)}
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
                collectionsArray.length === 0 ? (
                    // NOCOMMIT: Private is a misnomer when you have access to the parent
                    <div
                        className={emptyCollectionsClassName}
                        style={{
                            ...inputPlaceholderStyles,
                            opacity: isHovered ? 1 : 0,
                        }}
                    >
                        <Lock size={spacing["4"]} />
                        <div>Private</div>
                    </div>
                ) : (
                    <>
                        {collectionsArray.slice(0, 2).map(({collectionId}) => (
                            <div
                                key={collectionId}
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
                                <TaskCollectionChip
                                    collectionEntryStore={query.getReferencedCollectionEntryStore(
                                        collectionId,
                                    )}
                                />
                            </div>
                        ))}
                        {collectionsArray.length > 2 && (
                            <div
                                className={extraCollectionsClassName}
                                style={{fontFeatureSettings: '"calt"'}}
                            >
                                {`+${collectionsArray.length - 2}`}
                            </div>
                        )}
                    </>
                )
            ) : (
                <TaskRowCollectionsCellOverlay
                    query={query}
                    task={task}
                    focusPreviousCell={() => focusPreviousCell("Collections")}
                    cellRef={cellRef}
                    commitActionTransaction={commitActionTransaction}
                />
            )}
        </div>
    );
}
