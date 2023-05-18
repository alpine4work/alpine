import {EditorState, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    CSSProperties,
    Memo,
    Ref,
    RefObject,
    forwardRef,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {LocalTasksAction} from "~/client/tasks/internal/local_tasks_state";
import {TaskInteractiveGhostRow, TaskNormalRow, TaskRow} from "~/client/tasks/internal/task_row";
import {TaskRowViewRef} from "~/client/tasks/internal/task_row_view";
import {assertTaskTitle, emptyTaskTitle} from "~/client/tasks/internal/task_title_schema";
import {Spacing} from "~/shared/design/spacing";
import {UnimplementedError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {
    contentSchemaStyles,
    hideScrollbarClassName,
    sprinkles,
    taskRowTitleInputStyles,
} from "~/shared/styles/styles";

export const taskRowTitleInputHeight: Spacing = "9";

export type TaskRowTitleInputRef = {
    focusStart(): void;
    focusEnd(): void;
    focusPos(pos: number): void;
    focusCoord(left: number): void;
};

const taskRowTitleInputAriaLabel = "Title";

const taskRowTitleInputClassName = `ProseMirror ${sprinkles({
    width: "full",
    height: taskRowTitleInputHeight,
    overflowY: "hidden",
    overflowX: "scroll",
    paddingY: "2",
    backgroundColor: "transparent",
})} ${hideScrollbarClassName} ${taskRowTitleInputStyles.placeholderClassName}`;

const taskRowTitleInputStyle: CSSProperties = {
    ...contentSchemaStyles.paragraphFontSize,
    // Turn off text wrapping. This component emulates a single-line input.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/white-space
    whiteSpace: "pre",
};

const TaskRowTitleInputForwardRef = forwardRef(TaskRowTitleInput);
export {TaskRowTitleInputForwardRef as TaskRowTitleInput};

function TaskRowTitleInput(
    {
        taskRow,
        nextTaskRow,
        nextTaskRowRef,
        previousTaskRow,
        previousTaskRowRef,
        taskGhostRowPlaceholder,
        dispatch,
    }: {
        taskRow: TaskNormalRow | TaskInteractiveGhostRow;
        nextTaskRow: TaskRow | null;
        nextTaskRowRef: RefObject<TaskRowViewRef>;
        previousTaskRow: TaskRow | null;
        previousTaskRowRef: RefObject<TaskRowViewRef>;
        taskGhostRowPlaceholder: string;
        dispatch: Memo<(action: LocalTasksAction) => void>;
    },
    ref: Ref<TaskRowTitleInputRef>,
) {
    const isInitialAppRender = useIsInitialAppRender();
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    const taskId = taskRow.type === "Normal" ? taskRow.task.id : taskRow.ghostTaskId;
    const title = taskRow.type === "Normal" ? taskRow.task.title : emptyTaskTitle;

    const [titleState, setTitleState] = useState(() => EditorState.create({doc: title}));

    // If our title in state changed out-of-step with our editor state then reset
    // the editor state. Maybe a parent component didn't accept our title update?
    // Or a parent component push a new update down.
    if (title !== titleState.doc) {
        setTitleState(EditorState.create({doc: title}));
    }

    const handleKeyDown = (view: EditorView, event: KeyboardEvent) => {
        switch (event.key) {
            case "Enter": {
                event.preventDefault();
                event.stopPropagation();

                if (!isModifiedKeyboardEvent(event)) {
                    dispatch({
                        type: "SplitTaskFromTitle",
                        taskId,
                        titleSelection: view.state.selection,
                    });
                }
                break;
            }
            case "Backspace": {
                if (
                    view.state.selection.from === view.state.selection.to &&
                    view.state.selection.from === 0
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // TODO(calebmer): If the task we're deleting has other fields (like comments
                    // and notes) we should probably popup a warning and ask "are you sure you want
                    // to delete"? The join behavior is great for quickly iterating on tasks but
                    // can be dangerous.
                    dispatch({
                        type: "JoinTaskFromTitle",
                        deleteTaskId: taskId,
                    });
                }
                break;
            }
            case "Delete": {
                if (
                    view.state.selection.from === view.state.selection.to &&
                    view.state.selection.from === view.state.doc.nodeSize - 2
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // TODO(calebmer): If the task we're deleting has other fields (like comments
                    // and notes) we should probably popup a warning and ask "are you sure you want
                    // to delete"? The join behavior is great for quickly iterating on tasks but
                    // can be dangerous.
                    if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                        dispatch({
                            type: "JoinTaskFromTitle",
                            deleteTaskId:
                                nextTaskRow.type === "Normal"
                                    ? nextTaskRow.task.id
                                    : nextTaskRow.ghostTaskId,
                        });
                    }
                }
                break;
            }
            case "ArrowUp":
            case "ArrowDown": {
                // NOCOMMIT

                // event.preventDefault();
                // event.stopPropagation();

                // if (!isModifiedKeyboardEvent(event)) {
                //     const titleInputElement = assertExists(titleInputRef.current);

                //     // Get the X coordinate of the input's selection. We will maintain the X
                //     // position when moving up/down with arrow keys.
                //     //
                //     // NOTE(calebmer): Unfortunately we can't use `window.getSelection()` with an
                //     // `<input>` element so to figure out the X coordinate of our selection we need
                //     // to insert the text in our editor to a hidden `<div>` to get correct
                //     // measurements.
                //     const titleInputMeasurementElement = assertExists(
                //         titleInputMeasurementRef.current,
                //     );

                //     titleInputMeasurementElement.textContent = title.slice(0, selectionStart);

                //     const selectionX =
                //         titleInputMeasurementElement.getBoundingClientRect().right -
                //         // We don't scroll our measurement element, so adjust the X position by how
                //         // much the input has scrolled.
                //         titleInputElement.scrollLeft;

                //     titleInputMeasurementElement.textContent = "";

                //     // NOCOMMIT: If we are continuously arrowing up/down we should reuse an old
                //     // `selectionX`.
                //     if (event.key === "ArrowUp") {
                //         if (previousTaskRow && previousTaskRow.type !== "DecorativeGhost") {
                //             assertExists(previousTaskRowRef.current).focusTitleField({
                //                 type: "Coordinate",
                //                 selectionX,
                //             });
                //         }
                //     } else {
                //         if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                //             assertExists(nextTaskRowRef.current).focusTitleField({
                //                 type: "Coordinate",
                //                 selectionX,
                //             });
                //         }
                //     }
                // }
                break;
            }
        }
    };

    const taskRowRef = useRef(taskRow);
    const titleStateRef = useRef(titleState);
    const handleKeyDownRef = useRef(handleKeyDown);
    useLayoutEffectWithoutServerSideWarning(() => {
        taskRowRef.current = taskRow;
        titleStateRef.current = titleState;
        handleKeyDownRef.current = handleKeyDown;
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        // Wait for the client-side rerender before mounting our editor.
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);
        const initialTitleState = titleStateRef.current;

        const view = new EditorView(containerElement, {
            state: initialTitleState,

            handleKeyDown: (view, event) => {
                handleKeyDownRef.current(view, event);
                return event.defaultPrevented;
            },

            dispatchTransaction: transaction => {
                const oldTitleState = view.state;
                const newTitleState = oldTitleState.apply(transaction);

                // We need to run this with immediate priority so that we call
                // `view.updateState()` synchronously.
                //
                // See the "Efficient updating" section in the [editor view guide][1].
                // If we don't synchronously apply the transaction it is considered
                // cancelled. A quote from the guide:
                //
                // > When such a transaction is canceled or modified somehow, the view
                // > will undo the DOM change...
                //
                // [1]: https://prosemirror.net/docs/guide/#view
                runWithImmediatePriority(() => {
                    setTitleState(newTitleState);

                    // We only need to send this update to our parent if the doc changed. Selection
                    // changes do nothing.
                    if (oldTitleState.doc !== newTitleState.doc) {
                        dispatch({
                            type: "UpdateTaskTitle",
                            taskId,
                            title: assertTaskTitle(newTitleState.doc),
                        });
                    }
                });
            },
        });

        view.dom.ariaLabel = taskRowTitleInputAriaLabel;
        view.dom.className = taskRowTitleInputClassName;
        Object.assign(view.dom.style, taskRowTitleInputStyle);

        viewRef.current = view;
        return () => {
            viewRef.current = null;
            view.destroy();
        };

        // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
        // careful about what you put in here. Ideally we never destroy the
        // `EditorView` while this component is mounted.
    }, [dispatch, isInitialAppRender, taskId]);

    // Update our `EditorView`'s `EditorState` whenever it changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        // Wait for the client-side rerender before mounting our editor.
        if (isInitialAppRender) return;

        const view = assertExists(viewRef.current);
        view.updateState(titleState);
    }, [isInitialAppRender, titleState]);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Server-side render attaches this attribute differently.
        if (isInitialAppRender) return;

        const viewElement = assertExists(viewRef.current).dom;

        if (taskRow.type === "Normal") {
            viewElement.removeAttribute("aria-placeholder");
        } else {
            viewElement.setAttribute("aria-placeholder", taskGhostRowPlaceholder);
        }
    }, [isInitialAppRender, taskGhostRowPlaceholder, taskRow.type]);

    useImperativeHandle(
        ref,
        () => ({
            focusStart: () => {
                if (isInitialAppRender) {
                    throw new UnimplementedError(
                        "Focusing during initial app render is not implemented",
                    );
                }

                const view = assertExists(viewRef.current);

                const selection = Selection.atStart(view.state.doc);

                view.focus();
                view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
            },
            focusEnd: () => {
                if (isInitialAppRender) {
                    throw new UnimplementedError(
                        "Focusing during initial app render is not implemented",
                    );
                }

                const view = assertExists(viewRef.current);

                const selection = Selection.atEnd(view.state.doc);

                view.focus();
                view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
            },
            focusPos: (pos: number) => {
                if (isInitialAppRender) {
                    throw new UnimplementedError(
                        "Focusing during initial app render is not implemented",
                    );
                }

                const view = assertExists(viewRef.current);

                const selection = new TextSelection(view.state.doc.resolve(pos));

                view.focus();
                view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
            },
            focusCoord: (left: number) => {
                if (isInitialAppRender) {
                    throw new UnimplementedError(
                        "Focusing during initial app render is not implemented",
                    );
                }

                const view = assertExists(viewRef.current);

                const rect = view.dom.getBoundingClientRect();
                const top = rect.top + rect.height / 2;
                const posResult = view.posAtCoords({left, top});

                const selection = posResult
                    ? new TextSelection(view.state.doc.resolve(posResult.pos))
                    : left > rect.right
                    ? Selection.atEnd(view.state.doc)
                    : Selection.atStart(view.state.doc);

                view.focus();
                view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
            },
        }),
        [isInitialAppRender],
    );

    return (
        <div
            ref={containerRef}
            className={
                titleState.doc.childCount === 0 ? taskRowTitleInputStyles.emptyClassName : undefined
            }
            // Reset scroll position when focus leaves the input.
            onBlur={() => {
                if (isInitialAppRender) return;
                assertExists(viewRef.current).dom.scrollLeft = 0;
            }}
        >
            {isInitialAppRender && (
                // On server-side render serialize our title to HTML since we can't mount an
                // `EditorView` until we are on the client.
                <div
                    className={taskRowTitleInputClassName}
                    style={taskRowTitleInputStyle}
                    aria-label={taskRowTitleInputAriaLabel}
                    aria-placeholder={
                        taskRow.type === "InteractiveGhost" ? taskGhostRowPlaceholder : undefined
                    }
                    dangerouslySetInnerHTML={{
                        __html: serializeProsemirrorFragmentToHtml(titleState.doc.content),
                    }}
                />
            )}
        </div>
    );
}
