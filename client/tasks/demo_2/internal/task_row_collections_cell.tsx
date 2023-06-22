import {Lock} from "phosphor-react";
import {Ref, RefCallback, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box";
import {useIsChildFocusRingVisible} from "~/client/design/focus_ring";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {TaskCollectionChip} from "~/client/tasks/demo_2/internal/task_collection_chip";
import {TaskCollectionsInput} from "~/client/tasks/demo_2/internal/task_collections_input";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {addRemLengths, spacing, subtractRemLengths} from "~/shared/design/spacing";
import {ThemeColor} from "~/shared/design/theme_colors";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {colorSchemeVars, inputPlaceholderStyles} from "~/shared/styles/styles";

export type TaskRowCollectionsCellRef = {
    focusStart(): void;
};

const TaskRowCollectionsCellForwardRef = forwardRef(TaskRowCollectionsCell);
export {TaskRowCollectionsCellForwardRef as TaskRowCollectionsCell};

function TaskRowCollectionsCell(
    {
        allCollections,
        collections,
        createCollectionAndAddToTask,
        addCollectionToTask,
        removeCollectionFromTask,
        isEditing,
        onEditingChange,
        editingContainerRef,
        focusTaskPreviousCell,
    }: {
        allCollections: ReadonlyArray<LocalTaskCollection>;
        collections: ReadonlyArray<LocalTaskCollection>;
        createCollectionAndAddToTask: (collection: {
            id: LocalTaskCollectionId;
            name: string;
            color: ThemeColor;
        }) => void;
        addCollectionToTask: (collectionId: LocalTaskCollectionId) => void;
        removeCollectionFromTask: (collectionId: LocalTaskCollectionId) => void;
        isEditing: boolean;
        onEditingChange: (isEditing: boolean) => void;
        editingContainerRef: RefCallback<HTMLElement> | null;
        focusTaskPreviousCell: () => void;
    },
    ref: Ref<TaskRowCollectionsCellRef>,
) {
    const cellRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isChildFocusRingVisible, childFocusRingTargetRef] = useIsChildFocusRingVisible();

    useImperativeHandle(
        ref,
        () => ({
            focusStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(cellRef.current),
                })?.focus();
            },
        }),
        [],
    );

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
            flexShrink="0"
            width={taskRowViewCollectionsColumnWidth}
            paddingLeft={taskRowViewColumnPaddingX}
            paddingRight={taskRowViewLastColumnPaddingRight}
            // Important not to set `overflow="hidden"` here so that the editable
            // collections overlay can render outside the bounds of this cell.
            overflow={undefined}
            position="relative"
        >
            {!isEditing && (
                <Box cursor="pointer" onClick={() => onEditingChange(true)}>
                    <Box
                        height={taskRowViewMinHeight}
                        display="flex"
                        alignItems="center"
                        rowGap="3"
                        columnGap="2.5"
                        pointerEvents="none"
                    >
                        {collections.length === 0 ? (
                            <Box
                                style={inputPlaceholderStyles}
                                display="flex"
                                alignItems="center"
                                gap="1"
                                opacity={isHovered ? "100" : "0"}
                            >
                                <Lock size={spacing["4"]} />
                                <Box>Private</Box>
                            </Box>
                        ) : (
                            <>
                                {collections.slice(0, 2).map(collection => (
                                    <Box
                                        key={collection.id}
                                        marginY="-0.5"
                                        marginLeft="-0.5"
                                        style={{
                                            // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                            // have `min-width: auto` which extends with content.
                                            // https://stackoverflow.com/a/66689926/1568890
                                            minWidth: 0,
                                        }}
                                    >
                                        <TaskCollectionChip collection={collection} />
                                    </Box>
                                ))}
                                {collections.length > 2 && (
                                    <Box color="grey-70" style={{fontFeatureSettings: '"calt"'}}>
                                        +{collections.length - 2}
                                    </Box>
                                )}
                            </>
                        )}
                    </Box>
                </Box>
            )}
            <Box
                ref={useMergedRefs<HTMLDivElement>(editingContainerRef, childFocusRingTargetRef)}
                position="absolute"
                zIndex="30"
                style={{top: -1}}
                right="0"
                opacity={!isEditing ? "0" : "100"}
                pointerEvents={!isEditing ? "none" : undefined}
                borderRadius="sm"
                boxShadow="elevation-20"
                onFocus={() => onEditingChange(true)}
            >
                <Box
                    backgroundColor="grey-0"
                    overflowY="scroll"
                    borderRadius="sm"
                    style={{
                        width: addRemLengths(
                            spacing[taskRowViewCollectionsColumnWidth],
                            subtractRemLengths(spacing["2.5"], spacing[taskRowViewColumnPaddingX]),
                        ),
                        // We add an extra 1px of padding to the top to render on top of the row's
                        // `box-shadow` border.
                        minHeight: `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
                        maxHeight: isEditing
                            ? spacing["48"]
                            : `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
                        paddingTop: 1,
                        // The focus ring is rendered on the inner `<div>` so it renders on top of the
                        // elevation shadow.
                        boxShadow: !isChildFocusRingVisible
                            ? `0 0 0 2px ${colorSchemeVars["theme-30-const"]}`
                            : undefined,
                    }}
                >
                    <TaskCollectionsInput
                        aria-label="Collections"
                        isReadOnly={!isEditing}
                        areMarginsClickable={true}
                        paddingX="2.5"
                        paddingY="2.5"
                        allCollections={allCollections}
                        collections={collections}
                        createCollectionAndAddToTask={createCollectionAndAddToTask}
                        addCollectionToTask={addCollectionToTask}
                        removeCollectionFromTask={removeCollectionFromTask}
                        onArrowLeftLeaveKeyDown={focusTaskPreviousCell}
                    />
                </Box>
            </Box>
        </Box>
    );
}
