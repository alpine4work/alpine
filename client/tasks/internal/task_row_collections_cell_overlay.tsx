import {Memo, Ref, RefObject, forwardRef} from "react";
import {Box} from "~/client/design/box.js";
import {Overlay} from "~/client/design/overlay.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useIsChildFocusRingVisible} from "~/client/design/use_is_focus_ring_visible.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {
    taskRowViewCollectionsColumnCellOverlayWidth,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {TaskCollectionsInput} from "~/client/tasks/internal/task_collections_input.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

const TaskRowCollectionsCellOverlayForwardRef = forwardRef(TaskRowCollectionsCellOverlay);
export {TaskRowCollectionsCellOverlayForwardRef as TaskRowCollectionsCellOverlay};

function TaskRowCollectionsCellOverlay(
    {
        isReadOnly,
        query,
        undoManager,
        affinityManager,
        task,
        focusPreviousCell,
        cellRef,
        commitActionTransactionEvenIfGhost,
        onClose,
    }: {
        isReadOnly: boolean;
        query: TaskClientQuery;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        task: TaskModel | null;
        focusPreviousCell: () => void;
        cellRef: RefObject<HTMLDivElement>;
        commitActionTransactionEvenIfGhost: Memo<
            (
                getActions: (taskId: TaskId) => Array<TaskAction>,
                options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
            ) => void
        >;
        onClose: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const [isChildFocusRingVisible, childFocusRingTargetRef] = useIsChildFocusRingVisible();

    return (
        <Overlay
            isVisible={true}
            placement="bottom-start"
            fallbackPlacements={[]}
            offset={`-${taskRowViewMinHeight}`}
            offsetAlong="-3"
            overlay={
                <Box
                    ref={useMergedRefs<HTMLDivElement>(ref, childFocusRingTargetRef)}
                    data-testid={
                        process.env.NODE_ENV !== "production"
                            ? "TaskRowCollectionsCellOverlay"
                            : undefined
                    }
                    position="relative"
                    borderRadius="0.5"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                >
                    <Box
                        ref={useScrollbar()}
                        position="relative"
                        overflowY="scroll"
                        borderRadius="0.5"
                        style={{
                            width: taskRowViewCollectionsColumnCellOverlayWidth,
                            // We add an extra 1px of padding to the top to render on top of the row's
                            // `box-shadow` border.
                            minHeight: `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
                            maxHeight: spacing["48"],
                            // The focus ring is rendered on the inner `<div>` so it renders on top of the
                            // elevation shadow.
                            boxShadow: !isChildFocusRingVisible
                                ? `0 0 0 2px ${colorSchemeVars["theme-40-const"]}`
                                : undefined,
                        }}
                    >
                        <TaskCollectionsInput
                            isReadOnly={isReadOnly}
                            aria-label="Collections"
                            referencesSubscription={query}
                            undoManager={undoManager}
                            affinityManager={affinityManager}
                            task={task}
                            areMarginsClickable={true}
                            paddingX="3"
                            paddingY="3"
                            // Keyboard navigation in grid view is not done with the tab key.
                            isTabbable={false}
                            onArrowLeftLeaveKeyDown={() => {
                                onClose();
                                focusPreviousCell();
                            }}
                            onReturnFocus={() => {
                                assertExists(cellRef.current).focus();
                            }}
                            commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                        />
                    </Box>
                </Box>
            }
        >
            <Box width="full" height={taskRowViewMinHeight} />
        </Overlay>
    );
}
