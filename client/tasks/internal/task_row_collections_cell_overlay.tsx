import {Memo, RefObject} from "react";
import {Box} from "~/client/design/box.js";
import {useIsChildFocusRingVisible} from "~/client/design/focus_ring.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {TaskCollectionsInput} from "~/client/tasks/internal/task_collections_input.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {addRemLengths, spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export function TaskRowCollectionsCellOverlay({
    isReadOnly,
    query,
    task,
    focusPreviousCell,
    cellRef,
    commitActionTransaction,
}: {
    isReadOnly: boolean;
    query: TaskClientQuery;
    task: TaskModel | null;
    focusPreviousCell: () => void;
    cellRef: RefObject<HTMLDivElement>;
    commitActionTransaction: Memo<
        (
            getActions: (taskId: TaskId) => Array<TaskAction>,
            options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
        ) => void
    >;
}) {
    const [isChildFocusRingVisible, childFocusRingTargetRef] = useIsChildFocusRingVisible();

    return (
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
                ref={useScrollbar()}
                position="relative"
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
                    maxHeight: spacing["48"],
                    // The focus ring is rendered on the inner `<div>` so it renders on top of the
                    // elevation shadow.
                    boxShadow: !isChildFocusRingVisible
                        ? `0 0 0 2px ${colorSchemeVars["theme-30-const"]}`
                        : undefined,
                }}
            >
                <TaskCollectionsInput
                    isReadOnly={isReadOnly}
                    shouldNotRenderInput={isReadOnly}
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
                    commitActionTransaction={commitActionTransaction}
                />
            </Box>
        </Box>
    );
}
