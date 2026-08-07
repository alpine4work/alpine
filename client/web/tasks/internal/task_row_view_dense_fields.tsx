import {Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {pointerEventsNoneNotInheritedClassName, tasksStyles} from "~/client/web/styles/styles.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskAssigneeInput} from "~/client/web/tasks/internal/task_assignee_input.js";
import {TaskDateInput} from "~/client/web/tasks/internal/task_date_input.js";
import {TaskPriorityInput} from "~/client/web/tasks/internal/task_priority_input.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {RemLength, screenPaddingX} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

export type TaskRowViewDenseFieldsRef = {
    focusAssigneeInput(): void;
    focusPriorityInput(): void;
    focusDueDateInput(): void;
};

const TaskRowViewDenseFieldsForwardRef = forwardRef(TaskRowViewDenseFields);
export {TaskRowViewDenseFieldsForwardRef as TaskRowViewDenseFields};

function TaskRowViewDenseFields(
    {
        isReadOnly,
        withoutAssigneeField,
        store,
        task,
        marginLeft,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        commitActionTransaction,
    }: {
        isReadOnly: boolean;
        withoutAssigneeField: boolean;
        store: TaskClientReadonlyStore;
        task: TaskModel | null;
        marginLeft: RemLength;
        focusTitleEnd: () => void;
        focusTitleStart: () => void;
        focusTitleAll: () => void;
        commitActionTransaction: (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void;
    },
    ref: Ref<TaskRowViewDenseFieldsRef>,
) {
    const {currentAccount} = useSpaceContext();
    const {timeZone} = useClientInfo();
    const platform = usePlatform();

    const assigneeInputRef = useRef<HTMLDivElement>(null);
    const priorityInputRef = useRef<HTMLDivElement>(null);
    const dueDateInputRef = useRef<HTMLDivElement>(null);

    const assigneeAccountStore = task ? store.getTaskAssigneeAccountStore(task) : null;
    const assigneeAccountData = useStore(assigneeAccountStore);
    const priority = task?.getPriority() ?? null;
    const dueDate = task?.getDueDate() ?? null;

    const [assigneeInputState, setAssigneeInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    >(
        !withoutAssigneeField && assigneeAccountData
            ? {isVisible: true, shouldFocus: false, isFocused: false}
            : {isVisible: false},
    );

    if (
        assigneeInputState.isVisible &&
        (withoutAssigneeField ||
            (!assigneeInputState.isFocused &&
                !assigneeInputState.shouldFocus &&
                !assigneeAccountData))
    ) {
        setAssigneeInputState({isVisible: false});
    }

    if (!withoutAssigneeField && !assigneeInputState.isVisible && assigneeAccountData) {
        setAssigneeInputState({isVisible: true, shouldFocus: false, isFocused: false});
    }

    useLayoutEffectWithoutServerSideWarning(() => {
        if (assigneeInputState.isVisible && assigneeInputState.shouldFocus) {
            assertExists(
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(assigneeInputRef.current),
                }),
            ).focus({preventScroll: true});

            setAssigneeInputState(assigneeInputState => {
                if (!assigneeInputState.isVisible) return assigneeInputState;
                return {...assigneeInputState, shouldFocus: false};
            });
        }
    }, [assigneeInputState]);

    const [priorityInputState, setPriorityInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    >(priority ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

    if (
        priorityInputState.isVisible &&
        !priorityInputState.isFocused &&
        !priorityInputState.shouldFocus &&
        !priority
    ) {
        setPriorityInputState({isVisible: false});
    }

    if (!priorityInputState.isVisible && priority) {
        setPriorityInputState({isVisible: true, shouldFocus: false, isFocused: false});
    }

    useLayoutEffectWithoutServerSideWarning(() => {
        if (priorityInputState.isVisible && priorityInputState.shouldFocus) {
            assertExists(
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(priorityInputRef.current),
                }),
            ).focus({preventScroll: true});

            setPriorityInputState(priorityInputState => {
                if (!priorityInputState.isVisible) return priorityInputState;
                return {...priorityInputState, shouldFocus: false};
            });
        }
    }, [priorityInputState]);

    const [dueDateInputState, setDueDateInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    >(dueDate ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

    if (
        dueDateInputState.isVisible &&
        !dueDateInputState.isFocused &&
        !dueDateInputState.shouldFocus &&
        !dueDate
    ) {
        setDueDateInputState({isVisible: false});
    }

    if (!dueDateInputState.isVisible && dueDate) {
        setDueDateInputState({isVisible: true, shouldFocus: false, isFocused: false});
    }

    useLayoutEffectWithoutServerSideWarning(() => {
        if (dueDateInputState.isVisible && dueDateInputState.shouldFocus) {
            assertExists(
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(dueDateInputRef.current),
                }),
            ).focus({preventScroll: true});

            setDueDateInputState(dueDateInputState => {
                if (!dueDateInputState.isVisible) return dueDateInputState;
                return {...dueDateInputState, shouldFocus: false};
            });
        }
    }, [dueDateInputState]);

    useImperativeHandle(
        ref,
        () => ({
            focusAssigneeInput: () => {
                if (withoutAssigneeField) return;

                if (assigneeInputState.isVisible) {
                    assertExists(
                        getNextFocusableElementIfExists(null, {
                            withinElement: assertExists(assigneeInputRef.current),
                        }),
                    ).focus({preventScroll: true});
                } else {
                    setAssigneeInputState({
                        isVisible: true,
                        shouldFocus: true,
                        isFocused: false,
                    });
                }
            },
            focusPriorityInput: () => {
                if (priorityInputState.isVisible) {
                    assertExists(
                        getNextFocusableElementIfExists(null, {
                            withinElement: assertExists(priorityInputRef.current),
                        }),
                    ).focus({preventScroll: true});
                } else {
                    setPriorityInputState({
                        isVisible: true,
                        shouldFocus: true,
                        isFocused: false,
                    });
                }
            },
            focusDueDateInput: () => {
                if (dueDateInputState.isVisible) {
                    assertExists(
                        getNextFocusableElementIfExists(null, {
                            withinElement: assertExists(dueDateInputRef.current),
                        }),
                    ).focus({preventScroll: true});
                } else {
                    setDueDateInputState({
                        isVisible: true,
                        shouldFocus: true,
                        isFocused: false,
                    });
                }
            },
        }),
        [
            assigneeInputState.isVisible,
            dueDateInputState.isVisible,
            priorityInputState.isVisible,
            withoutAssigneeField,
        ],
    );

    const gap = "5";

    const fieldCount =
        (assigneeInputState.isVisible ? 1 : 0) +
        (priorityInputState.isVisible ? 1 : 0) +
        (dueDateInputState.isVisible ? 1 : 0);

    const fieldMaxWidth = `${100 / fieldCount}%`;

    const node = (
        <Box display="flex" alignItems="stretch">
            <Box
                flexShrink="0"
                cursor={!isReadOnly ? "text" : undefined}
                style={{width: marginLeft}}
                {...useOutOfBoundsClickSelection({
                    isDisabled: isReadOnly,
                    onSelect: focusTitleStart,
                    onSelectAll: focusTitleAll,
                })}
            />
            <Box
                flexGrow="1"
                display="flex"
                gap={gap}
                // I find some negative `marginLeft` helps the fields feel optically aligned.
                marginLeft="-0.5"
                // I find some negative `marginTop` helps the fields feel optically aligned. Since
                // above us is text, not a divider line.
                marginTop="-0.5"
                height="7"
                paddingBottom="3"
                className={!isReadOnly ? tasksStyles.textCursorNotInheritedClassName : undefined}
                {...useOutOfBoundsClickSelection({
                    isDisabled: isReadOnly,
                    onSelect: focusTitleEnd,
                    onSelectAll: focusTitleAll,
                })}
            >
                {assigneeInputState.isVisible && (
                    <Box
                        ref={assigneeInputRef}
                        style={{maxWidth: fieldMaxWidth, minWidth: 0}}
                        className={pointerEventsNoneNotInheritedClassName}
                        onFocus={() => {
                            setAssigneeInputState(assigneeInputState => {
                                if (!assigneeInputState.isVisible) return assigneeInputState;
                                if (assigneeInputState.isFocused) return assigneeInputState;
                                return {...assigneeInputState, isFocused: true};
                            });
                        }}
                        onBlur={event => {
                            // If focus is moving within the element, don't unfocus.
                            if (event.currentTarget.contains(event.relatedTarget)) return;

                            setAssigneeInputState(assigneeInputState => {
                                if (!assigneeInputState.isVisible) return assigneeInputState;
                                if (!assigneeInputState.isFocused) return assigneeInputState;
                                return {...assigneeInputState, isFocused: false};
                            });
                        }}
                    >
                        <TaskAssigneeInput
                            isReadOnly={isReadOnly}
                            aria-label="Assignee"
                            color="grey-60"
                            avatarSize="4"
                            shouldDisplayShortName={true}
                            // On mobile, don't blur once a value has been selected. This way the keyboard
                            // stays open and the user can tap on another field (e.g. assignee) to edit it
                            // instead of needing to reopen the keyboard.
                            withoutBlurAfterSelection={platform === "mobile"}
                            assigneeAccountData={assigneeAccountData}
                            onAssigneeAccountChange={assigneeAccount => {
                                // Currently, accounts without space access can't edit tasks. The max permission
                                // level of `urlGrant` is `View`.
                                assert(currentAccount);

                                const time = store.clock.now();

                                commitActionTransaction(taskId => [
                                    {
                                        type: "UpdateTask",
                                        time,
                                        taskId,
                                        taskAction: {
                                            type: "UpdateAssignee",
                                            assignee: assigneeAccount
                                                ? {
                                                      assigneeId: assigneeAccount.id,
                                                      assignerId: currentAccount.id,
                                                      assignedTime: new TaskFilterableTime({
                                                          absoluteTime: time,
                                                          setterTimeZone: timeZone,
                                                      }),
                                                  }
                                                : null,
                                        },
                                    },
                                ]);
                            }}
                        />
                    </Box>
                )}
                {priorityInputState.isVisible && (
                    <Box
                        ref={priorityInputRef}
                        style={{maxWidth: fieldMaxWidth, minWidth: 0}}
                        className={pointerEventsNoneNotInheritedClassName}
                        onFocus={() => {
                            setPriorityInputState(priorityInputState => {
                                if (!priorityInputState.isVisible) return priorityInputState;
                                if (priorityInputState.isFocused) return priorityInputState;
                                return {...priorityInputState, isFocused: true};
                            });
                        }}
                        onBlur={event => {
                            // If focus is moving within the element, don't unfocus.
                            if (event.currentTarget.contains(event.relatedTarget)) return;

                            setPriorityInputState(priorityInputState => {
                                if (!priorityInputState.isVisible) return priorityInputState;
                                if (!priorityInputState.isFocused) return priorityInputState;
                                return {...priorityInputState, isFocused: false};
                            });
                        }}
                    >
                        <TaskPriorityInput
                            isReadOnly={isReadOnly}
                            aria-label="Priority"
                            color="grey-60"
                            // If a task is closed, suppress the urgent warning.
                            shouldHighlightUrgent={task?.getDisplayStatus() !== "Closed"}
                            // On mobile, don't blur once a value has been selected. This way the keyboard
                            // stays open and the user can tap on another field (e.g. assignee) to edit it
                            // instead of needing to reopen the keyboard.
                            withoutBlurAfterSelection={platform === "mobile"}
                            priority={priority}
                            onPriorityChange={priority => {
                                commitActionTransaction(taskId => [
                                    {
                                        type: "UpdateTask",
                                        time: store.clock.now(),
                                        taskId,
                                        taskAction: {
                                            type: "UpdatePriority",
                                            priority,
                                        },
                                    },
                                ]);
                            }}
                        />
                    </Box>
                )}
                {dueDateInputState.isVisible && (
                    <Box
                        ref={dueDateInputRef}
                        overflow="hidden"
                        style={{minWidth: fieldMaxWidth}}
                        className={pointerEventsNoneNotInheritedClassName}
                        onFocus={() => {
                            setDueDateInputState(dueDateInputState => {
                                if (!dueDateInputState.isVisible) return dueDateInputState;
                                if (dueDateInputState.isFocused) return dueDateInputState;
                                return {...dueDateInputState, isFocused: true};
                            });
                        }}
                        onBlur={event => {
                            // If focus is moving within the element, don't unfocus.
                            if (event.currentTarget.contains(event.relatedTarget)) return;

                            setDueDateInputState(dueDateInputState => {
                                if (!dueDateInputState.isVisible) return dueDateInputState;
                                if (!dueDateInputState.isFocused) return dueDateInputState;
                                return {...dueDateInputState, isFocused: false};
                            });
                        }}
                    >
                        <TaskDateInput
                            isReadOnly={isReadOnly}
                            aria-label="Due date"
                            date={dueDate}
                            shouldIncludeCalendarIcon={true}
                            shouldWarnIfAfterDate={task?.getDisplayStatus() !== "Closed"}
                            shouldFormatAroundToday={true}
                            color="grey-60"
                            onDateChange={dueDate => {
                                commitActionTransaction(taskId => [
                                    {
                                        type: "UpdateTask",
                                        time: store.clock.now(),
                                        taskId,
                                        taskAction: {
                                            type: "UpdateDueDate",
                                            dueDate,
                                        },
                                    },
                                ]);
                            }}
                        />
                    </Box>
                )}
            </Box>
            <Box
                flexShrink="0"
                cursor={!isReadOnly ? "text" : undefined}
                width={screenPaddingX}
                {...useOutOfBoundsClickSelection({
                    isDisabled: isReadOnly,
                    onSelect: focusTitleEnd,
                    onSelectAll: focusTitleAll,
                })}
            />
        </Box>
    );

    if (
        !assigneeInputState.isVisible &&
        !priorityInputState.isVisible &&
        !dueDateInputState.isVisible
    ) {
        return null;
    }

    return node;
}
