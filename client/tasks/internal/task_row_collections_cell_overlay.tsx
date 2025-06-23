import {Memo, Ref, RefObject, forwardRef, useRef} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {useOverlayPortalElement} from "~/client/design/overlay_helpers.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useIsChildFocusRingVisible} from "~/client/design/use_is_focus_ring_visible.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/use_store.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {
    taskRowViewCollectionsColumnCellOverlayExtraWidth,
    taskRowViewCollectionsColumnCellOverlayWidth,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {TaskClientReadonlyStore} from "~/client/tasks/core/task_client_store.js";
import {TaskCollectionsInput} from "~/client/tasks/internal/task_collections_input.js";
import {addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";

const TaskRowCollectionsCellOverlayForwardRef = forwardRef(TaskRowCollectionsCellOverlay);
export {TaskRowCollectionsCellOverlayForwardRef as TaskRowCollectionsCellOverlay};

function TaskRowCollectionsCellOverlay(
    {
        cellId,
        isReadOnly,
        store,
        query,
        task,
        focusPreviousCell,
        cellRef,
        onClose,
        commitActionTransaction,
    }: {
        cellId: string;
        isReadOnly: boolean;
        store: TaskClientReadonlyStore;
        query: TaskClientQuery | null;
        task: TaskModel | null;
        focusPreviousCell: () => void;
        cellRef: RefObject<HTMLDivElement>;
        onClose: () => void;
        commitActionTransaction: Memo<
            (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void
        >;
    },
    outerRef: Ref<HTMLDivElement>,
) {
    const portalElement = assertExists(
        useOverlayPortalElement(),
        "Can’t server render `<TaskRowCollectionsCellOverlay>`",
    );

    const innerRef = useRef<HTMLDivElement>(null);

    const [isChildFocusRingVisible, childFocusRingTargetRef] = useIsChildFocusRingVisible();

    const taskOrder = useStore(query?.taskOrderStore ?? null);

    useLayoutEffectWithoutServerSideWarning(() => {
        // We want this effect to re-execute when `query.taskOrderStore` updates. Since
        // if our row moves to a different position then we need to update our `top`
        // CSS position.
        //
        // It would be very inefficient if every `<TaskRowView>` re-rendered when
        // `query.taskOrderStore` updates. It's fine to do it here since only one task
        // row at a time will have its collection cell overlay visible.
        //
        // TODO(calebmer): The task move animation isn't applied to the collections
        // cell overlay. Ideally this overlay would animate as well.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        taskOrder;

        const cellElement = assertExists(cellRef.current);
        const cellOverlayElement = assertExists(innerRef.current);

        const portalTop = portalElement.getBoundingClientRect().top;
        const cellTop = cellElement.getBoundingClientRect().top;

        cellOverlayElement.style.top = `${cellTop - portalTop}px`;
    }, [cellRef, portalElement, taskOrder]);

    return createPortal(
        <Box
            ref={useMergedRefs<HTMLDivElement>(innerRef, outerRef, childFocusRingTargetRef)}
            data-testid={
                process.env.NODE_ENV !== "production" ? "TaskRowCollectionsCellOverlay" : undefined
            }
            data-ownedby={cellId}
            position="absolute"
            borderRadius="0.5"
            backgroundColor="grey-0"
            boxShadow="elevation-20"
            style={{
                right: addRemLengths(
                    "5",
                    `${parseRemLength(taskRowViewCollectionsColumnCellOverlayExtraWidth) / 2}rem`,
                ),
            }}
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
                    store={store}
                    referencesSubscription={query}
                    collections={task?.getCollections() ?? TaskCollectionSet.empty}
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
                    commitActionTransaction={commitActionTransaction}
                />
            </Box>
        </Box>,
        portalElement,
    );
}
