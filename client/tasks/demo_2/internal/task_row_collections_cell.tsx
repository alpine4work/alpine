import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {getLastFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {TaskCollectionChip} from "~/client/tasks/demo_2/internal/task_collection_chip";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {tasksStyles} from "~/shared/styles/styles";

export function TaskRowCollectionsCell({
    collections,
}: {
    collections: ReadonlyArray<LocalTaskCollection>;
}) {
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    return (
        <Box
            ref={hoverRef}
            flexShrink="0"
            width={taskRowViewCollectionsColumnWidth}
            overflow="hidden"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => {
                    getLastFocusableElementIfExists({
                        withinElement: assertExists(inputContainerRef.current),
                    })?.focus({preventScroll: true});
                },
                onSelectAll: () => {
                    getLastFocusableElementIfExists({
                        withinElement: assertExists(inputContainerRef.current),
                    })?.focus({preventScroll: true});
                },
            })}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
        >
            <Box
                ref={inputContainerRef}
                height={taskRowViewMinHeight}
                display="flex"
                alignItems="center"
                gap="2"
                opacity={collections.length > 0 || isHovered || isFocusWithin ? "100" : "0"}
            >
                {collections.slice(0, 2).map(collection => (
                    <TaskCollectionChip key={collection.id} collection={collection} />
                ))}
                {collections.length > 2 && (
                    <Box color="grey-70" style={{fontFeatureSettings: '"calt"'}}>
                        +{collections.length - 2}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
