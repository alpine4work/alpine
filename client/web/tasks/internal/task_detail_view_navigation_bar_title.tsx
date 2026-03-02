import {ReactNode, Ref, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskProjectDetailViewParentBreadcrumbs} from "~/client/web/tasks/internal/task_detail_view_parent_breadcrumbs.js";
import {TaskChildTasksProgressWheel} from "~/client/web/tasks/task_child_tasks_progress_wheel.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    TaskTitleUpdateModel,
    addFallbackToTaskTitle,
    emptyTaskTitleModel,
    taskFallbackTitle,
} from "~/shared/tasks/title/task_title.js";

export type TaskDetailViewNavigationBarTitleRef = {
    editProjectTitle(): void;
};

export function TaskDetailViewNavigationBarTitle({
    ref,
    taskSubscription,
    isReadOnly,
    onTitleChange,
}: {
    ref?: Ref<TaskDetailViewNavigationBarTitleRef>;
    taskSubscription: TaskClientTaskSubscription | null;
    isReadOnly: boolean;
    onTitleChange: (titleUpdate: TaskTitleUpdateModel) => void;
}) {
    const projectRef = useRef<TaskProjectDetailViewNavigationBarTitleRef>(null);

    const task = useStore(taskSubscription?.taskEntryStore ?? null)?.task;

    useImperativeHandle(ref, () => ({
        editProjectTitle: () => {
            if (task?.getLayout() !== "Project") return;
            assertExists(projectRef.current).editTitle();
        },
    }));

    if (task?.getLayout() !== "Project") {
        const titleText = addFallbackToTaskTitle(task?.getTitle().getText() ?? "");
        return <>{titleText}</>;
    }

    return (
        <TaskProjectDetailViewNavigationBarTitle
            ref={projectRef}
            taskSubscription={taskSubscription}
            isReadOnly={isReadOnly}
            onTitleChange={onTitleChange}
        />
    );
}

export type TaskProjectDetailViewNavigationBarTitleRef = {
    editTitle(): void;
};

export function TaskProjectDetailViewNavigationBarTitle({
    ref,
    taskSubscription,
    isReadOnly,
    onTitleChange,
}: {
    ref?: Ref<TaskProjectDetailViewNavigationBarTitleRef>;
    taskSubscription: TaskClientTaskSubscription | null;
    isReadOnly: boolean;
    onTitleChange: (titleUpdate: TaskTitleUpdateModel) => void;
}) {
    const platform = usePlatform();

    const task = useStore(taskSubscription?.taskEntryStore ?? null)?.task;
    const originalTitleText = task?.getTitle().getText() ?? "";
    const titleText = addFallbackToTaskTitle(originalTitleText);

    const lastPointerDownTimeRef = useRef<number | null>(null);

    const [isEditingTitleInline, setIsEditingTitleInline] = useState(false);

    if ((isReadOnly || platform !== "desktop") && isEditingTitleInline) {
        setIsEditingTitleInline(false);
    }

    useImperativeHandle(ref, () => ({
        editTitle: () => {
            if (platform !== "desktop") return;
            setIsEditingTitleInline(true);
        },
    }));

    let node: ReactNode;

    if (!isEditingTitleInline) {
        node = (
            <Box
                fontStyle="truncate-semi-bold"
                paddingRight="1"
                style={{
                    // Render contextual alternate glyphs. User text may be rendered here. Helpful
                    // for consistency if the user types anything like 2x2 or an @ mention.
                    // eslint-disable-next-line cyberworlds/string-quotes
                    fontFeatureSettings: '"calt" on',
                }}
                onPointerDown={event => {
                    const currentTime = Date.now();
                    const lastPointerDownTime = lastPointerDownTimeRef.current;
                    lastPointerDownTimeRef.current = currentTime;

                    if (lastPointerDownTime === null) return;

                    if (currentTime - lastPointerDownTime > doubleClickDelayMs) return;

                    if (!isReadOnly && platform === "desktop") {
                        // Disable selection from double click.
                        //
                        // We implement double click with `onPointerDown` instead of `onDoubleClick`
                        // because `onDoubleClick` fires one pointer up but the browser performs text
                        // selection on double click pointer down. So there's a small visual glitch
                        // where you can see the browser selection after double click before pointer up
                        // when you use `onDoubleClick`,
                        event.preventDefault();

                        setIsEditingTitleInline(true);
                    }
                }}
            >
                {titleText}
            </Box>
        );
    } else {
        node = (
            <Box marginLeft="-1" overflow="hidden">
                <TaskProjectDetailViewNavigationBarDesktopTitleEditor
                    initialTitle={originalTitleText}
                    onCancel={() => setIsEditingTitleInline(false)}
                    onSave={title => {
                        if (!task) {
                            onTitleChange(emptyTaskTitleModel.get().replace(0, 0, title));
                        } else {
                            // Don't try to do piecemeal updates for project task titles. Update the full
                            // thing! Our input doesn't show realtime updates so trying to merge for
                            // realtime updates after the update would likely get an unexpected result.
                            onTitleChange(
                                task.getTitle().replace(0, originalTitleText.length, title),
                            );
                        }
                        setIsEditingTitleInline(false);
                    }}
                />
            </Box>
        );
    }

    return (
        <Box display="flex" gap="2">
            {node}
            <Box
                flexShrink="0"
                display="flex"
                alignItems="center"
                gap="1"
                fontSize="75"
                fontStyle="normal"
                userSelect="none"
            >
                <TaskChildTasksProgressWheel
                    childTaskCount={task?.getChildTaskCount() ?? 0}
                    closedChildTaskCount={task?.getClosedChildTaskCount() ?? 0}
                />
                <Box color="grey-70">
                    {task?.getClosedChildTaskCount() ?? 0}/{task?.getChildTaskCount() ?? 0}
                </Box>
            </Box>
            {task && (
                <TaskProjectDetailViewParentBreadcrumbs
                    task={task}
                    taskSubscription={taskSubscription}
                />
            )}
        </Box>
    );
}

function TaskProjectDetailViewNavigationBarDesktopTitleEditor({
    initialTitle,
    onCancel,
    onSave,
}: {
    initialTitle: string;
    onCancel: () => void;
    onSave: (title: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [title, setTitle] = useState(initialTitle);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        return scheduleAfterNavigationAnimation(() => {
            const inputElement = assertExists(inputRef.current);
            inputElement.select();
            inputElement.focus({preventScroll: true});
        });
    }, [shouldShowConfirmSaveDialog]);

    return (
        <>
            <Box maxWidth="full" height="8">
                <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                    <InputWithAutoGrowingWidth
                        ref={useMergedRefs(
                            inputRef,
                            useConfirmSaveAfterLosingFocus({
                                shouldConfirmSave:
                                    // Otherwise if you delete all of the collection name it will revert back to
                                    // the initial name.
                                    title !== initialTitle,

                                isConfirmingSave: shouldShowConfirmSaveDialog,
                                onCancelSave: () => void onCancel(),
                                onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                            }),
                        )}
                        placeholder={initialTitle.length > 0 ? initialTitle : taskFallbackTitle}
                        autoComplete="false"
                        value={title}
                        onChange={event => setTitle(event.currentTarget.value)}
                        className={sprinkles({
                            paddingY: "1",
                            borderRadius: "1",
                        })}
                        style={{
                            boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                        }}
                        textClassName={sprinkles({
                            fontSize: "200",
                            fontStyle: "semi-bold",
                            paddingX: "1",
                        })}
                        textStyle={{
                            // Render contextual alternate glyphs. User text may be rendered here. Helpful
                            // for consistency if the user types anything like 2x2 or an @ mention.
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                        onKeyDown={event => {
                            switch (event.key) {
                                case "Enter": {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    onSave(title);
                                    break;
                                }
                                case "Escape": {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onCancel();
                                    break;
                                }
                            }
                        }}
                    />
                </FocusRing>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save project name"
                    description="Would you like to save your new project name?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t save name"
                    onPrimaryButtonPress={() => onSave(title)}
                    cancelButtonLabel="Discard name"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard name"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
