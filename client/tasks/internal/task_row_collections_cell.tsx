import classNames from "classnames";
import {Lock} from "phosphor-react";
import {
    KeyboardEvent,
    Ref,
    forwardRef,
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
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {inputPlaceholderStyles, sprinkles, tasksStyles} from "~/shared/styles/styles.js";
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

const TaskRowCollectionsCellForwardRef = forwardRef(TaskRowCollectionsCell);
export {TaskRowCollectionsCellForwardRef as TaskRowCollectionsCell};

function TaskRowCollectionsCell(
    {
        query,
        task,
        onCellKeyDownCapture,
        focusPreviousCell,
    }: {
        query: TaskClientQuery;
        task: TaskModel | null;
        onCellKeyDownCapture: (event: KeyboardEvent) => void;
        focusPreviousCell: () => void;
    },
    ref: Ref<TaskRowCollectionsCellRef>,
) {
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

    return (
        <div
            ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
            tabIndex={-1}
            className={sprinkles({
                flexShrink: "0",
                width: taskRowViewCollectionsColumnWidth,
                paddingLeft: taskRowViewColumnPaddingX,
                paddingRight: taskRowViewLastColumnPaddingRight,
                // Important not to set `overflow="hidden"` here so that the editable
                // collections overlay can render outside the bounds of this cell.
                overflow: undefined,
                position: "relative",
            })}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
            onKeyDownCapture={onCellKeyDownCapture}
        >
            {!isFocusWithin ? (
                <div
                    className={classNames(
                        tasksStyles.textCursorNotInheritedClassName,
                        sprinkles({
                            height: taskRowViewMinHeight,
                            display: "flex",
                            alignItems: "center",
                            rowGap: "3",
                            columnGap: "2.5",
                        }),
                    )}
                    onPointerDown={event => {
                        if (event.target === event.currentTarget) {
                            event.preventDefault();
                            shouldFocusTextInputNextRenderRef.current = true;
                            assertExists(cellRef.current).focus();
                        }
                    }}
                >
                    {collectionsArray.length === 0 ? (
                        // NOCOMMIT: Private is a misnomer when you have access to the parent
                        <div
                            style={inputPlaceholderStyles}
                            className={sprinkles({
                                display: "flex",
                                alignItems: "center",
                                gap: "1",
                                opacity: isHovered ? "100" : "0",
                                pointerEvents: "none",
                            })}
                        >
                            <Lock size={spacing["4"]} />
                            <div>Private</div>
                        </div>
                    ) : (
                        <>
                            {collectionsArray.slice(0, 2).map(({collectionId}) => (
                                <div
                                    key={collectionId}
                                    className={sprinkles({
                                        marginY: "-0.5",
                                        marginLeft: "-0.5",
                                        cursor: "default",
                                    })}
                                    style={{
                                        // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                        // have `min-width: auto` which extends with content.
                                        // https://stackoverflow.com/a/66689926/1568890
                                        minWidth: 0,
                                    }}
                                    onPointerDown={event => {
                                        if (event.target === event.currentTarget) {
                                            event.preventDefault();
                                            assertExists(cellRef.current).focus();
                                        }
                                    }}
                                >
                                    <div className={sprinkles({pointerEvents: "none"})}>
                                        <TaskCollectionChip
                                            collectionEntryStore={query.getReferencedCollectionEntryStore(
                                                collectionId,
                                            )}
                                        />
                                    </div>
                                </div>
                            ))}
                            {collectionsArray.length > 2 && (
                                <div
                                    className={sprinkles({
                                        color: "grey-70",
                                        pointerEvents: "none",
                                    })}
                                    style={{fontFeatureSettings: '"calt"'}}
                                >
                                    +{collectionsArray.length - 2}
                                </div>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <TaskRowCollectionsCellOverlay
                    query={query}
                    task={task}
                    focusPreviousCell={focusPreviousCell}
                    cellRef={cellRef}
                />
            )}
        </div>
    );
}
