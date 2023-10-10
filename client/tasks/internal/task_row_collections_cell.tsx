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
import {Box} from "~/client/design/box.js";
import {useIsChildFocusRingVisible} from "~/client/design/focus_ring.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {TaskCollectionChip} from "~/client/tasks/internal/task_collection_chip.js";
import {TaskCollectionsInput} from "~/client/tasks/internal/task_collections_input.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {addRemLengths, spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {colorSchemeVars, inputPlaceholderStyles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";

export type TaskRowCollectionsCellRef = {
    focusCell(): void;
    focusCellInputStart(): void;
};

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
    const scrollbarRef = useScrollbar();
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);
    const [isChildFocusRingVisible, childFocusRingTargetRef] = useIsChildFocusRingVisible();

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
        <Box
            ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
            tabIndex={-1}
            flexShrink="0"
            width={taskRowViewCollectionsColumnWidth}
            paddingLeft={taskRowViewColumnPaddingX}
            paddingRight={taskRowViewLastColumnPaddingRight}
            // Important not to set `overflow="hidden"` here so that the editable
            // collections overlay can render outside the bounds of this cell.
            overflow={undefined}
            position="relative"
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
            onKeyDownCapture={onCellKeyDownCapture}
        >
            {!isFocusWithin ? (
                <Box
                    height={taskRowViewMinHeight}
                    display="flex"
                    alignItems="center"
                    rowGap="3"
                    columnGap="2.5"
                    className={tasksStyles.textCursorNotInheritedClassName}
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
                        <Box
                            style={inputPlaceholderStyles}
                            display="flex"
                            alignItems="center"
                            gap="1"
                            opacity={isHovered ? "100" : "0"}
                            pointerEvents="none"
                        >
                            <Lock size={spacing["4"]} />
                            <Box>Private</Box>
                        </Box>
                    ) : (
                        <>
                            {collectionsArray.slice(0, 2).map(({collectionId}) => (
                                <Box
                                    key={collectionId}
                                    marginY="-0.5"
                                    marginLeft="-0.5"
                                    style={{
                                        // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                        // have `min-width: auto` which extends with content.
                                        // https://stackoverflow.com/a/66689926/1568890
                                        minWidth: 0,
                                    }}
                                    cursor="default"
                                    onPointerDown={event => {
                                        if (event.target === event.currentTarget) {
                                            event.preventDefault();
                                            assertExists(cellRef.current).focus();
                                        }
                                    }}
                                >
                                    <Box pointerEvents="none">
                                        <TaskCollectionChip
                                            collectionEntryStore={query.getReferencedCollectionEntryStore(
                                                collectionId,
                                            )}
                                        />
                                    </Box>
                                </Box>
                            ))}
                            {collectionsArray.length > 2 && (
                                <Box
                                    color="grey-70"
                                    style={{fontFeatureSettings: '"calt"'}}
                                    pointerEvents="none"
                                >
                                    +{collectionsArray.length - 2}
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            ) : (
                <Box
                    ref={childFocusRingTargetRef}
                    position="absolute"
                    zIndex="30"
                    top="0"
                    right="0"
                    borderRadius="sm"
                    boxShadow="elevation-20"
                >
                    <Box
                        ref={scrollbarRef}
                        position="relative"
                        backgroundColor="grey-0"
                        overflowY="scroll"
                        borderRadius="sm"
                        style={{
                            width: addRemLengths(
                                spacing[taskRowViewCollectionsColumnWidth],
                                subtractRemLengths(
                                    spacing["2.5"],
                                    spacing[taskRowViewColumnPaddingX],
                                ),
                            ),
                            // We add an extra 1px of padding to the top to render on top of the row's
                            // `box-shadow` border.
                            minHeight: `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
                            maxHeight: spacing["48"],
                            // The focus ring is rendered on the inner `<div>` so it renders on top of the
                            // elevation shadow.
                            boxShadow: !isChildFocusRingVisible
                                ? `0 0 0 2px ${colorSchemeVars["theme-30-const"]}`
                                : undefined,
                        }}
                    >
                        <TaskCollectionsInput
                            aria-label="Collections"
                            referencesSubscription={query}
                            task={task}
                            areMarginsClickable={true}
                            paddingX="2.5"
                            paddingY="2.5"
                            // Keyboard navigation in grid view is not done with the tab key.
                            isTabbable={false}
                            onArrowLeftLeaveKeyDown={focusPreviousCell}
                            onReturnFocus={() => assertExists(cellRef.current).focus()}
                        />
                    </Box>
                </Box>
            )}
        </Box>
    );
}
