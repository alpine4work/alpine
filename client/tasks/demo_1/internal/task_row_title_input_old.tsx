import classNames from "classnames";
import {AllSelection, EditorState, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    CSSProperties,
    Memo,
    MutableRefObject,
    Ref,
    RefObject,
    forwardRef,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {isMac} from "~/client/helpers/browser/is_mac";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {LocalTasksAction} from "~/client/tasks/demo_1/internal/local_tasks_state_old";
import {
    TaskInteractiveGhostRow,
    TaskNormalRow,
    TaskRow,
} from "~/client/tasks/demo_1/internal/task_row";
import {TaskRowViewRef} from "~/client/tasks/demo_1/internal/task_row_view";
import {Spacing} from "~/shared/design/spacing";
import {UnimplementedError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {
    contentSchemaStyles,
    hideScrollbarClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles";
import {assertTaskTitle, emptyTaskTitle} from "~/shared/tasks/task_title_schema";

export const taskRowTitleInputHeight: Spacing = "9";

export type TaskRowTitleInputRef = {
    focusStart(): void;
    focusEnd(): void;
    focusAll(): void;
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
})} ${hideScrollbarClassName} ${tasksStyles.titleInputPlaceholderClassName}`;

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
        firstTaskRowRef,
        lastTaskRowRef,
        taskGhostRowPlaceholder,
        lastArrowNavigationXRef,
        dispatch,
    }: {
        taskRow: TaskNormalRow | TaskInteractiveGhostRow;
        nextTaskRow: TaskRow | null;
        nextTaskRowRef: RefObject<TaskRowViewRef>;
        previousTaskRow: TaskRow | null;
        previousTaskRowRef: RefObject<TaskRowViewRef>;
        firstTaskRowRef: RefObject<TaskRowViewRef>;
        lastTaskRowRef: RefObject<TaskRowViewRef>;
        taskGhostRowPlaceholder: string;
        lastArrowNavigationXRef: MutableRefObject<{setTime: Date; x: number} | null>;
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
                    if (
                        taskRow.type === "Normal" &&
                        view.state.selection.from === view.state.selection.to &&
                        view.state.selection.from === 0
                    ) {
                        dispatch({
                            type: "CreateTaskAbove",
                            taskId,
                        });
                    } else {
                        dispatch({
                            type: "CreateTaskBelow",
                            taskId,
                        });
                    }
                }
                break;
            }
            // TODO(calebmer): What should the behavior of the delete button be?
            case "Backspace": {
                if (
                    view.state.doc.childCount === 0 &&
                    // Cmd-backspace always deletes the task when its title is empty regardless of
                    // what other content it contains.
                    ((isMac ? event.metaKey : event.ctrlKey) ||
                        taskRow.type !== "Normal" ||
                        taskRow.task.childTaskIdByOrderKey.size === 0)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // TODO(calebmer): If the task we're deleting has other fields (like comments
                    // and notes) we should probably popup a warning and ask "are you sure you want
                    // to delete"? The join behavior is great for quickly iterating on tasks but
                    // can be dangerous.
                    //
                    // TODO(calebmer): Should we actually delete subtasks? Maybe we should give
                    // users an option to leave subtasks?
                    dispatch({
                        type: "DeleteTaskAndAllSubtasks",
                        taskId,
                    });
                }
                break;
            }
            case "ArrowUp": {
                event.preventDefault();
                event.stopPropagation();

                if (isMac ? event.metaKey : event.ctrlKey) {
                    firstTaskRowRef.current?.focusTitleStart();
                } else if (event.altKey) {
                    view.dispatch(
                        view.state.tr
                            .setSelection(Selection.atStart(view.state.doc))
                            .scrollIntoView(),
                    );
                } else if (!isModifiedKeyboardEvent(event)) {
                    if (previousTaskRow && previousTaskRow.type !== "DecorativeGhost") {
                        const coords = view.coordsAtPos(view.state.selection.from);
                        const arrowNavigationX = lastArrowNavigationXRef.current?.x ?? coords.left;

                        assertExists(previousTaskRowRef.current).focusTitleCoord(arrowNavigationX);

                        // Set `lastArrowNavigationXRef` after a microtask so that the `focus` and
                        // `selectionchange` events which clear the ref can fire first.
                        lastArrowNavigationXRef.current = {
                            setTime: new Date(),
                            x: arrowNavigationX,
                        };
                    }
                }
                break;
            }
            case "ArrowDown": {
                event.preventDefault();
                event.stopPropagation();

                if (isMac ? event.metaKey : event.ctrlKey) {
                    lastTaskRowRef.current?.focusTitleEnd();
                } else if (event.altKey) {
                    view.dispatch(
                        view.state.tr
                            .setSelection(Selection.atEnd(view.state.doc))
                            .scrollIntoView(),
                    );
                } else if (!isModifiedKeyboardEvent(event)) {
                    if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                        const coords = view.coordsAtPos(view.state.selection.from);
                        const arrowNavigationX = lastArrowNavigationXRef.current?.x ?? coords.left;

                        assertExists(nextTaskRowRef.current).focusTitleCoord(arrowNavigationX);

                        // Set `lastArrowNavigationXRef` after a microtask so that the `focus` and
                        // `selectionchange` events which clear the ref can fire first.
                        lastArrowNavigationXRef.current = {
                            setTime: new Date(),
                            x: arrowNavigationX,
                        };
                    }
                }
                break;
            }
            case "Tab": {
                if (event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (taskRow.type === "Normal") {
                        dispatch({
                            type: "DedentTask",
                            taskId: taskRow.task.id,
                        });
                    }
                } else if (!isModifiedKeyboardEvent(event)) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (taskRow.type === "Normal" && previousTaskRow?.type === "Normal") {
                        dispatch({
                            type: "IndentTask",
                            taskId: taskRow.task.id,
                            previousTaskId: previousTaskRow.task.id,
                        });
                    }
                }
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

            // We add this prop to `prosemirror-view` with a patch. With this prop when the
            // editor is focused we place focus where the browser places focus. So if the
            // user clicks into the editor focus goes to where the user clicked. Not to the
            // selection currently in state.
            shouldUseDOMSelectionOnFocus: true,

            attributes: {
                // Title row inputs are focusable but are not a part of the tab order.
                //
                // TODO(calebmer): Figure out a paradigm for focusing the tasks view. When the
                // user tabs into `<TasksView>` focus should go to the last focused task? If
                // we're using a virtualized scroll view, though, and the last focused task is
                // offscreen it's unclear whether we should scroll to it or focus a visible
                // task or what.
                //
                // Once focus is in a single task the user can navigate it entirely with
                // the keyboard.
                tabindex: "-1",
            },

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
            focusAll: () => {
                if (isInitialAppRender) {
                    throw new UnimplementedError(
                        "Focusing during initial app render is not implemented",
                    );
                }

                const view = assertExists(viewRef.current);

                const selection = new AllSelection(view.state.doc);

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

    // We initially consider ourselves to be fully scrolled to the left but not to
    // the right. On server-render this will render a right gradient on the task in
    // case it overflows.
    const [isFullyScrolledLeft, setIsFullyScrolledLeft] = useState(true);
    const [isFullyScrolledRight, setIsFullyScrolledRight] = useState(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const viewElement = assertExists(viewRef.current).dom;

        const update = () => {
            setIsFullyScrolledLeft(viewElement.scrollLeft === 0);
            setIsFullyScrolledRight(
                Math.ceil(viewElement.scrollLeft + viewElement.clientWidth) >=
                    viewElement.scrollWidth,
            );
        };

        update();

        viewElement.addEventListener("scroll", update);
        return () => {
            viewElement.removeEventListener("scroll", update);
        };
    }, [isInitialAppRender]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                tasksStyles.titleInputContainerClassName,
                titleState.doc.childCount === 0 && tasksStyles.titleInputEmptyContainerClassName,
                !isFullyScrolledLeft &&
                    tasksStyles.titleInputOverflowGradientLeftContainerClassName,
                !isFullyScrolledRight &&
                    tasksStyles.titleInputOverflowGradientRightContainerClassName,
                sprinkles({
                    color:
                        taskRow.type === "Normal" && !taskRow.task.isOpen ? "grey-60" : "grey-text",
                }),
            )}
            onBlur={() => {
                if (isInitialAppRender) return;

                // Reset scroll position when focus leaves the input.
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
                    // See why we set this attribute on `EditorView`.
                    tabIndex={-1}
                    dangerouslySetInnerHTML={{
                        __html: serializeProsemirrorFragmentToHtml(titleState.doc.content),
                    }}
                />
            )}
        </div>
    );
}
