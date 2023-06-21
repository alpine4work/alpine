import {Lock} from "phosphor-react";
import {RefCallback} from "react";
import {Box} from "~/client/design/box";
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
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {colorSchemeVars, inputPlaceholderStyles} from "~/shared/styles/styles";

export function TaskRowCollectionsCell({
    collections,
    isEditing,
    onEditingChange,
    editingContainerRef,
}: {
    collections: ReadonlyArray<LocalTaskCollection>;
    isEditing: boolean;
    onEditingChange: (isEditing: boolean) => void;
    editingContainerRef: RefCallback<HTMLElement> | null;
}) {
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();

    return (
        <Box
            ref={hoverRef}
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
                ref={editingContainerRef}
                position="absolute"
                zIndex="30"
                top="0"
                right="0"
                backgroundColor="grey-0"
                minHeight={taskRowViewMinHeight}
                // NOCOMMIT: Max height and scroll
                opacity={!isEditing ? "0" : "100"}
                pointerEvents={!isEditing ? "none" : undefined}
                borderRadius="sm"
                style={{
                    width: addRemLengths(
                        spacing[taskRowViewCollectionsColumnWidth],
                        subtractRemLengths(spacing["2.5"], spacing[taskRowViewColumnPaddingX]),
                    ),
                    // Draw the top and bottom border with a shadow so it lines up with rows.
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-0"]}, 0 0 0 2px ${colorSchemeVars["theme-30-const"]}, 0 -1px 0 2px ${colorSchemeVars["theme-30-const"]}`,
                }}
                onFocus={() => onEditingChange(true)}
            >
                <TaskCollectionsInput
                    aria-label="Collections"
                    isReadOnly={!isEditing}
                    areMarginsClickable={true}
                    paddingX="2.5"
                    paddingY="2.5"
                    allCollections={emptyArray}
                    collections={collections}
                    createCollectionAndAddToTask={() => {
                        // NOCOMMIT
                    }}
                    addCollectionToTask={() => {
                        // NOCOMMIT
                    }}
                    removeCollectionFromTask={() => {
                        // NOCOMMIT
                    }}
                />
            </Box>
        </Box>
    );
}
