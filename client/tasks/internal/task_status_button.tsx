import {KeyboardEvent, Ref, forwardRef, useRef} from "react";
import {mergeProps, useButton} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {TaskDisplayStatusCircle} from "~/client/design/task_display_status_circle.js";
import {touchSlopBySpacing} from "~/client/design/use_touch_slop.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {sprinkles} from "~/client/styles/styles.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
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

const classNameBySize = mapObjectValues(touchSlopBySpacing, touchSlopBySpacing =>
    createObjectFromKeys(["4", "5", "6", "7"], size =>
        sprinkles({
            // In case the circle is in a flexbox container, don't let it shrink.
            flexShrink: "0",
            display: "flex",
            width: touchSlopBySpacing[size].sizeWithSlop,
            height: touchSlopBySpacing[size].sizeWithSlop,
            padding: touchSlopBySpacing[size].slop,
            margin: `-${touchSlopBySpacing[size].slop}`,
            borderRadius: "full",
        }),
    ),
);

function TaskStatusButton(
    {
        store,
        undoManager,
        affinityManager,
        task,
        size = "4",
        isDisabled = false,
        isDisabledButStillFocusable = false,
        isFocusable = true,
        isTabbable = true,
        onKeyDown,
        onKeyDownCapture,
        shouldShowClosedStatusWhenPressed,
        onCloseConfirmationDialogueOpen,
    }: {
        store: TaskClientStore;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        task: TaskModel;
        size?: "4" | "5" | "6" | "7";
        isDisabled?: boolean;
        isDisabledButStillFocusable?: boolean;
        isFocusable?: boolean;
        isTabbable?: boolean;
        onKeyDown?: (event: KeyboardEvent) => void;
        onKeyDownCapture?: (event: KeyboardEvent) => void;
        shouldShowClosedStatusWhenPressed?: boolean;
        onCloseConfirmationDialogueOpen: (options: {onConfirm: () => void}) => void;
    },
    ref: Ref<HTMLElement>,
) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
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
    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();
    const buttonRef = useRef<HTMLElement | null>(null);
    const mergedButtonRef = useMergedRefs(ref, buttonRef);

    const {isPressed: isPressedFromHook, buttonProps} = useButton(
        {
            elementType: isFocusable ? "button" : "div",
            isDisabled,
            onPress: () => {
                if (isDisabledButStillFocusable) return;

                // Currently, accounts without space access can't edit tasks. The max
                // permission level of `urlGrant` is `View`.
                assert(currentAccount);

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
                    const runCommitTaskActionTransaction = () => {
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
                    };

                    // Checks if there are any open subtasks
                    // if there are then open warning dialogue
                    if (task.getOpenChildTaskCount() !== 0) {
                        onCloseConfirmationDialogueOpen({
                            onConfirm: runCommitTaskActionTransaction,
                        });
                    } else {
                        runCommitTaskActionTransaction();
                    }
                }

                // Reward the user with haptic feedback when they change task's status.
                NativeMobileBridge?.haptic.playLightImpact();
            },
            onKeyDown,
        },
        buttonRef,
    );

    const isPressed = isPressedFromHook && !isDisabledButStillFocusable;

    let displayStatus = task.getDisplayStatus();

    if (shouldShowClosedStatusWhenPressed && isPressed && displayStatus !== "Closed") {
        displayStatus = "Closed";
    }

    const className = classNameBySize[platform][size];

    return (
        <FocusRing inset={touchSlopBySpacing[platform][size].slop}>
            {isFocusable ? (
                <button
                    {...mergeProps(buttonProps, {onKeyDownCapture})}
                    ref={mergedButtonRef as any}
                    data-testid={
                        process.env.NODE_ENV !== "production" ? "TaskStatusButton" : undefined
                    }
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
                    data-testid={
                        process.env.NODE_ENV !== "production" ? "TaskStatusButton" : undefined
                    }
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
