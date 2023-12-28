import {KeyboardEvent, Ref, forwardRef, useRef} from "react";
import {mergeProps, useButton} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {
    TaskClientStore,
    TaskClientStoreSearchEntityAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/task_client_store.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

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

const TaskStatusButtonForwardRef = forwardRef(TaskStatusButton);
export {TaskStatusButtonForwardRef as TaskStatusButton};

const size4ClassName = sprinkles({
    display: "block",
    width: "4",
    height: "4",
    borderRadius: "full",
});

const size5ClassName = sprinkles({
    display: "block",
    width: "5",
    height: "5",
    borderRadius: "full",
});

function TaskStatusButton(
    {
        store,
        undoManager,
        affinityManager,
        task,
        size = "4",
        isDisabled = false,
        isFocusable = true,
        isTabbable = true,
        onKeyDown,
        onKeyDownCapture,
        shouldShowClosedStatusWhenPressed,
    }: {
        store: TaskClientStore;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchEntityAffinityManager;
        task: TaskModel;
        size?: "4" | "5";
        isDisabled?: boolean;
        isFocusable?: boolean;
        isTabbable?: boolean;
        onKeyDown?: (event: KeyboardEvent) => void;
        onKeyDownCapture?: (event: KeyboardEvent) => void;
        shouldShowClosedStatusWhenPressed?: boolean;
    },
    ref: Ref<HTMLElement>,
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

    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();
    const buttonRef = useRef<HTMLElement | null>(null);
    const mergedButtonRef = useMergedRefs(ref, buttonRef);

    const {isPressed, buttonProps} = useButton(
        {
            elementType: isFocusable ? "button" : "div",
            isDisabled,
            onPress: () => {
                const time = store.clock.now();
                const status = task.getStatus();

                if (status.type === "Closed") {
                    store.commitTaskActionTransaction(
                        context,
                        [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            },
                        ],
                        {undoManager, affinityManager},
                    );
                } else {
                    store.commitTaskActionTransaction(
                        context,
                        [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {
                                        type: "Closed",
                                        closerId: currentAccount.id,
                                        closedTime: new TaskFilterableTime({
                                            absoluteTime: time,
                                            setterTimeZone: timeZone,
                                        }),
                                    },
                                },
                            },
                        ],
                        {undoManager, affinityManager},
                    );
                }
            },
            onKeyDown,
        },
        buttonRef,
    );

    const className = size === "4" ? size4ClassName : size5ClassName;

    let displayStatus = task.getDisplayStatus();

    if (shouldShowClosedStatusWhenPressed && isPressed && displayStatus !== "Closed") {
        displayStatus = "Closed";
    }

    return (
        <FocusRing>
            {isFocusable ? (
                <button
                    {...mergeProps(buttonProps, {onKeyDownCapture})}
                    ref={mergedButtonRef as any}
                    data-testid="TaskStatusButton"
                    tabIndex={!isTabbable ? -1 : undefined}
                    className={className}
                >
                    <TaskDisplayStatusCircle
                        displayStatus={displayStatus}
                        size={size}
                        isPressed={isPressed}
                    />
                </button>
            ) : (
                <div
                    {...mergeProps(buttonProps, {onKeyDownCapture})}
                    ref={mergedButtonRef as any}
                    // TODO(calebmer, #swc-transform): Consider writing a plugin that removes
                    // `data-testid` attributes in production build modes.
                    data-testid="TaskStatusButton"
                    // Remove `tabIndex` from button props if this button is not focusable.
                    tabIndex={undefined}
                    className={className}
                >
                    <TaskDisplayStatusCircle
                        displayStatus={displayStatus}
                        size={size}
                        isPressed={isPressed}
                    />
                </div>
            )}
        </FocusRing>
    );
}
