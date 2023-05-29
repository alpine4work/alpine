import classNames from "classnames";
import {AllSelection, EditorState, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    CSSProperties,
    Ref,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {isMac} from "~/client/helpers/browser/is_mac";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {TaskStatus} from "~/client/tasks/demo_2/task_status_button";
import {Spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {
    contentSchemaStyles,
    hideScrollbarClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles";
import {TaskTitle, assertTaskTitle} from "~/shared/tasks/task_title_schema";

export const taskRowTitleInputHeight: Spacing = "9";

export type TaskRowTitleInputRef = {
    focusStart(): void;
    focusEnd(): void;
    focusAll(): void;
    focusCoord(coord: number): void;
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
        status,
        title,
        onTitleChange,
        placeholder,
        childTaskCount,
        areChildTasksCollapsed,
        createTaskAbove,
        createTaskBelowAndFocus,
        createTaskChildAtStartAndFocus,
        nestWithPreviousTaskRowIfExistsAndExpand,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
        focusNextTaskTitleCoord,
        focusPreviousTaskTitleCoord,
        focusFirstTaskTitleStart,
        focusLastTaskTitleEnd,
    }: {
        status: TaskStatus | null;
        title: TaskTitle;
        onTitleChange: (title: TaskTitle) => void;
        placeholder?: string;
        childTaskCount: number;
        areChildTasksCollapsed: boolean;
        createTaskAbove: () => void;
        createTaskBelowAndFocus: () => void;
        createTaskChildAtStartAndFocus: () => void;
        nestWithPreviousTaskRowIfExistsAndExpand: () => void;
        unnestTaskIfNestedRow: () => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: () => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        focusFirstTaskTitleStart: () => void;
        focusLastTaskTitleEnd: () => void;
    },
    ref: Ref<TaskRowTitleInputRef>,
) {
    const isInitialAppRender = useIsInitialAppRender();
    const containerRef = useRef<HTMLDivElement>(null);

    const viewRef = useRef<
        | {isReady: false; callbacks: Array<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: []});

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
                        view.state.selection.from === view.state.selection.to &&
                        view.state.selection.from === 0
                    ) {
                        createTaskAbove();
                    } else if (childTaskCount > 0 && !areChildTasksCollapsed) {
                        createTaskChildAtStartAndFocus();
                    } else {
                        createTaskBelowAndFocus();
                    }
                }
                break;
            }
            case "Backspace": {
                if (
                    view.state.doc.childCount === 0 &&
                    // Cmd-backspace always deletes the task when its title is empty regardless of
                    // what other content it contains.
                    ((isMac ? event.metaKey : event.ctrlKey) || childTaskCount === 0)
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
                    deleteTaskAndAllChildrenAndFocusPreviousRow();
                }
                break;
            }
            case "ArrowUp": {
                event.preventDefault();
                event.stopPropagation();

                if (isMac ? event.metaKey : event.ctrlKey) {
                    focusFirstTaskTitleStart();
                } else if (event.altKey) {
                    view.dispatch(
                        view.state.tr
                            .setSelection(Selection.atStart(view.state.doc))
                            .scrollIntoView(),
                    );
                } else if (!isModifiedKeyboardEvent(event)) {
                    const coords = view.coordsAtPos(view.state.selection.from);
                    focusPreviousTaskTitleCoord(coords.left);
                }
                break;
            }
            case "ArrowDown": {
                event.preventDefault();
                event.stopPropagation();

                if (isMac ? event.metaKey : event.ctrlKey) {
                    focusLastTaskTitleEnd();
                } else if (event.altKey) {
                    view.dispatch(
                        view.state.tr
                            .setSelection(Selection.atEnd(view.state.doc))
                            .scrollIntoView(),
                    );
                } else if (!isModifiedKeyboardEvent(event)) {
                    const coords = view.coordsAtPos(view.state.selection.from);
                    focusNextTaskTitleCoord(coords.left);
                }
                break;
            }
            case "Tab": {
                if (event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    unnestTaskIfNestedRow();
                } else if (!isModifiedKeyboardEvent(event)) {
                    event.preventDefault();
                    event.stopPropagation();

                    nestWithPreviousTaskRowIfExistsAndExpand();
                }
                break;
            }
        }
    };

    const titleStateRef = useRef(titleState);
    const onTitleChangeRef = useRef(onTitleChange);
    const handleKeyDownRef = useRef(handleKeyDown);
    useLayoutEffectWithoutServerSideWarning(() => {
        titleStateRef.current = titleState;
        onTitleChangeRef.current = onTitleChange;
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

                    // We only need to send this update to our parent if the doc changed. Otherwise
                    // we have a selection change.
                    if (oldTitleState.doc !== newTitleState.doc) {
                        onTitleChangeRef.current(assertTaskTitle(newTitleState.doc));
                    }
                });
            },
        });

        view.dom.ariaLabel = taskRowTitleInputAriaLabel;
        view.dom.className = taskRowTitleInputClassName;
        Object.assign(view.dom.style, taskRowTitleInputStyle);

        const updateFullyScrolledState = () => {
            setIsFullyScrolledLeft(view.dom.scrollLeft === 0);
            setIsFullyScrolledRight(
                Math.ceil(view.dom.scrollLeft + view.dom.clientWidth) >= view.dom.scrollWidth,
            );
        };

        updateFullyScrolledState();

        view.dom.addEventListener("scroll", updateFullyScrolledState);

        // Update `viewRef` and call any callbacks that were waiting for the view to
        // be ready.
        {
            const callbacks = !viewRef.current.isReady ? viewRef.current.callbacks : [];

            viewRef.current = {isReady: true, view};

            for (const callback of callbacks) {
                callback(view);
            }
        }

        return () => {
            view.dom.removeEventListener("scroll", updateFullyScrolledState);
            viewRef.current = {isReady: false, callbacks: []};
            view.destroy();
        };

        // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
        // careful about what you put in here. Ideally we never destroy the
        // `EditorView` while this component is mounted.
    }, [isInitialAppRender]);

    // Update our `EditorView`'s `EditorState` whenever it changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!viewRef.current.isReady) return;
        viewRef.current.view.updateState(titleState);
    }, [isInitialAppRender, titleState]);

    const runWhenViewIsReady = useCallback((run: (view: EditorView) => void) => {
        if (viewRef.current.isReady) {
            run(viewRef.current.view);
        } else {
            viewRef.current.callbacks.push(run);
        }
    }, []);

    useLayoutEffectWithoutServerSideWarning(() => {
        runWhenViewIsReady(view => {
            if (!placeholder) {
                view.dom.removeAttribute("aria-placeholder");
            } else {
                view.dom.setAttribute("aria-placeholder", placeholder);
            }
        });
    }, [placeholder, runWhenViewIsReady]);

    useImperativeHandle(
        ref,
        () => ({
            focusStart: () => {
                runWhenViewIsReady(view => {
                    const selection = Selection.atStart(view.state.doc);

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
            focusEnd: () => {
                runWhenViewIsReady(view => {
                    const selection = Selection.atEnd(view.state.doc);

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
            focusAll: () => {
                runWhenViewIsReady(view => {
                    const selection = new AllSelection(view.state.doc);

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
            focusCoord: (coord: number) => {
                runWhenViewIsReady(view => {
                    const rect = view.dom.getBoundingClientRect();
                    const top = rect.top + rect.height / 2;
                    const posResult = view.posAtCoords({left: coord, top});

                    const selection = posResult
                        ? new TextSelection(view.state.doc.resolve(posResult.pos))
                        : coord > rect.right
                        ? Selection.atEnd(view.state.doc)
                        : Selection.atStart(view.state.doc);

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
        }),
        [runWhenViewIsReady],
    );

    // We initially consider ourselves to be fully scrolled to the left but not to
    // the right. On server-render this will render a right gradient on the task in
    // case it overflows.
    const [isFullyScrolledLeft, setIsFullyScrolledLeft] = useState(true);
    const [isFullyScrolledRight, setIsFullyScrolledRight] = useState(false);

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
                    color: status === "Closed" ? "grey-60" : "grey-text",
                }),
            )}
            onBlur={() => {
                runWhenViewIsReady(view => {
                    // Reset scroll position when focus leaves the input.
                    view.dom.scrollLeft = 0;
                });
            }}
        >
            {isInitialAppRender && (
                // On server-side render serialize our title to HTML since we can't mount an
                // `EditorView` until we are on the client.
                <div
                    className={taskRowTitleInputClassName}
                    style={taskRowTitleInputStyle}
                    aria-label={taskRowTitleInputAriaLabel}
                    aria-placeholder={placeholder}
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
