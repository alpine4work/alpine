import {useDraggable} from "@dnd-kit/core";
import classNames from "classnames";
import {ArrowsOutSimple, DotsSixVertical} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {
    KeyboardEvent,
    Ref,
    forwardRef,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskAssigneeInput} from "~/client/tasks/internal/task_assignee_input.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewDraggableData} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {TaskPriorityInput} from "~/client/tasks/internal/task_priority_input.js";
import {
    TaskRowAssigneeCell,
    TaskRowAssigneeCellRef,
} from "~/client/tasks/internal/task_row_assignee_cell.js";
import {
    TaskRowCollectionsCell,
    TaskRowCollectionsCellRef,
} from "~/client/tasks/internal/task_row_collections_cell.js";
import {
    TaskRowDueDateCell,
    TaskRowDueDateCellRef,
} from "~/client/tasks/internal/task_row_due_date_cell.js";
import {
    TaskRowPriorityCell,
    TaskRowPriorityCellRef,
} from "~/client/tasks/internal/task_row_priority_cell.js";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/internal/task_row_title_input.js";
import {TaskRowViewDroppable} from "~/client/tasks/internal/task_row_view_droppable_indentations.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {
    taskRowViewFirstColumnExtraPaddingLeft,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {Context} from "~/shared/context/context.js";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {emptyTaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

export type TaskRowViewDenseFieldsRef = {
    focusAssigneeInput(): void;
    focusPriorityInput(): void;
    focusDueDateInput(): void;
};

const TaskRowViewDenseFieldsForwardRef = forwardRef(TaskRowViewDenseFields);
export {TaskRowViewDenseFieldsForwardRef as TaskRowViewDenseFields};

function TaskRowViewDenseFields(
    {
        store,
        task,
        marginLeft,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
    }: {
        store: TaskClientStore;
        task: TaskModel;
        marginLeft: RemLength;
        focusTitleEnd: () => void;
        focusTitleStart: () => void;
        focusTitleAll: () => void;
    },
    ref: Ref<TaskRowViewDenseFieldsRef>,
) {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const {timeZone} = useClientInfo();

    const assigneeInputRef = useRef<HTMLDivElement>(null);
    const priorityInputRef = useRef<HTMLDivElement>(null);
    const dueDateInputRef = useRef<HTMLDivElement>(null);

    const assigneeAccountStore = store.getTaskAssigneeAccountStore(task);
    const assigneeAccountData = useStore(assigneeAccountStore);
    const priority = task.getPriority();
    const dueDate = task.getDueDate();

    const fieldMaxWidth = `calc(${100 / 3}% - ${
        parseRemLengthNumber(
            addRemLengths(
                marginLeft, // Margin left
                spacing["2"], // Gap
                spacing["5"], // Margin right
            ),
        ) / 3
    }rem)`;

    const [assigneeInputState, setAssigneeInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    >(
        assigneeAccountData
            ? {isVisible: true, shouldFocus: false, isFocused: false}
            : {isVisible: false},
    );

    if (
        assigneeInputState.isVisible &&
        !assigneeInputState.isFocused &&
        !assigneeInputState.shouldFocus &&
        !assigneeAccountData
    ) {
        setAssigneeInputState({isVisible: false});
    }

    if (!assigneeInputState.isVisible && assigneeAccountData) {
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
        [assigneeInputState.isVisible, dueDateInputState.isVisible, priorityInputState.isVisible],
    );

    const node = (
        <Box display="flex" alignItems="stretch">
            <Box
                flexShrink="0"
                cursor="text"
                style={{width: marginLeft}}
                {...useOutOfBoundsClickSelection({
                    onSelect: focusTitleStart,
                    onSelectAll: focusTitleAll,
                })}
            />
            <Box
                flexGrow="1"
                display="flex"
                gap="5"
                // I find some negative `marginLeft` helps the fields feel optically aligned.
                marginLeft="-0.5"
                // I find some negative `marginTop` helps the fields feel optically aligned.
                // Since above us is text, not a divider line.
                marginTop="-0.5"
                paddingBottom="2"
                className={tasksStyles.textCursorNotInheritedClassName}
                {...useOutOfBoundsClickSelection({
                    onSelect: focusTitleEnd,
                    onSelectAll: focusTitleAll,
                })}
            >
                {assigneeInputState.isVisible && (
                    <Box
                        ref={assigneeInputRef}
                        flexShrink="0"
                        style={{maxWidth: fieldMaxWidth}}
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
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
                            aria-label="Assignee"
                            color="grey-60"
                            avatarSize="4"
                            shouldDisplayShortName={true}
                            assigneeAccountData={assigneeAccountData}
                            onAssigneeAccountChange={assigneeAccount => {
                                const time = store.clock.now();

                                store.commitTaskActionTransaction(context, [
                                    {
                                        type: "UpdateTask",
                                        time,
                                        taskId: task.id,
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
                        flexShrink="0"
                        style={{maxWidth: fieldMaxWidth}}
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
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
                            aria-label="Priority"
                            color="grey-60"
                            priority={priority}
                            onPriorityChange={priority => {
                                store.commitTaskActionTransaction(context, [
                                    {
                                        type: "UpdateTask",
                                        time: store.clock.now(),
                                        taskId: task.id,
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
                        flexShrink="0"
                        style={{maxWidth: fieldMaxWidth}}
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
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
                            aria-label="Due date"
                            date={dueDate}
                            shouldIncludeCalendarIcon={true}
                            shouldWarnIfAfterDate={task.getDisplayStatus() !== "Closed"}
                            shouldFormatAroundToday={true}
                            color="grey-60"
                            onDateChange={dueDate => {
                                store.commitTaskActionTransaction(context, [
                                    {
                                        type: "UpdateTask",
                                        time: store.clock.now(),
                                        taskId: task.id,
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
