import classNames from "classnames";
import {CaretLeft} from "phosphor-react";
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
import {TaskRowTitleChildTasksButton} from "~/client/tasks/demo_2/internal/task_row_title_child_tasks_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {noop} from "~/shared/helpers/control/noop";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {
    contentSchemaStyles,
    hideScrollbarClassName,
    inputPlaceholderStyles,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles";
import {TaskTitle, assertTaskTitle} from "~/shared/tasks/task_title_schema";

export const taskRowTitleInputSingleLineHeight: Spacing = "9";

export type TaskRowTitleInputRef = {
    getSelection(): Selection;
    focusStart(): void;
    focusEnd(): void;
    focusAll(): void;
    focusCoord(coord: number): void;
    focusSelection(selection: Selection): void;
};

const taskRowTitleInputAriaLabel = "Title";

const taskRowTitleInputSingleLineClassName = `ProseMirror ${sprinkles({
    // Use an `inline-block` display so the `<div>` width is equal to our content width.
    display: "inline-block",
    maxWidth: "full",
    height: taskRowTitleInputSingleLineHeight,
    overflowY: "hidden",
    overflowX: "scroll",
    paddingY: "2",
    backgroundColor: "transparent",
})} ${hideScrollbarClassName}`;

const taskRowTitleInputSingleLineStyle: CSSProperties = {
    ...contentSchemaStyles.paragraphFontSize,
    // Make sure we have room to render the cursor.
    minWidth: "1ch",
    // Turn off text wrapping. This component emulates a single-line input.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/white-space
    whiteSpace: "pre",
    // `display: inline-block` creates an inline layout which adds extra space
    // below the element. Adding `vertical-align` stops the space from being added.
    // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
    verticalAlign: "top",
};

const taskRowTitleInputMultilineClassName = `ProseMirror ${sprinkles({
    // Use an `inline-block` display so the `<div>` width is equal to our content width.
    display: "inline-block",
    maxWidth: "full",
    minHeight: taskRowTitleInputSingleLineHeight,
    paddingY: "2",
    backgroundColor: "transparent",
})}`;

const taskRowTitleInputMultilineStyle: CSSProperties = {
    ...contentSchemaStyles.paragraphFontSize,
    // Make sure we have room to render the cursor.
    minWidth: "1ch",
    // `display: inline-block` creates an inline layout which adds extra space
    // below the element. Adding `vertical-align` stops the space from being added.
    // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
    verticalAlign: "top",
};

const TaskRowTitleInputForwardRef = forwardRef(TaskRowTitleInput);
export {TaskRowTitleInputForwardRef as TaskRowTitleInput};

function TaskRowTitleInput(
    {
        title,
        onTitleChange,
        shouldRenderMultilineTitle,
        placeholder,
        indentation,
        parentTaskTitle,
        shouldShowParentTaskTitle,
        childTaskCount,
        closedChildTaskCount,
        areChildTasksCollapsed,
        onAreChildTasksCollapsedToggle,
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
        title: TaskTitle;
        onTitleChange: (title: TaskTitle) => void;
        shouldRenderMultilineTitle: boolean;
        placeholder?: string;
        indentation: number;
        parentTaskTitle: TaskTitle | null;
        shouldShowParentTaskTitle: boolean;
        childTaskCount: number;
        closedChildTaskCount: number;
        areChildTasksCollapsed: boolean;
        onAreChildTasksCollapsedToggle: () => void;
        createTaskAbove: () => void;
        createTaskBelowAndFocus: () => void;
        createTaskChildAtStartAndFocus: () => void;
        nestWithPreviousTaskRowIfExistsAndExpand: (selection: Selection) => void;
        unnestTaskIfNestedRow: (selection: Selection) => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: () => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        focusFirstTaskTitleStart: () => void;
        focusLastTaskTitleEnd: () => void;
    },
    ref: Ref<TaskRowTitleInputRef>,
) {
    assert(
        !shouldRenderMultilineTitle || !shouldShowParentTaskTitle,
        "Can't set both `shouldRenderMultilineTitle` and `shouldShowParentTaskTitle` to true, they are incompatible",
    );

    const isInitialAppRender = useIsInitialAppRender();
    const containerRef = useRef<HTMLDivElement>(null);

    const viewRef = useRef<
        | {isReady: false; callbacks: Set<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: new Set()});

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

                    unnestTaskIfNestedRow(view.state.selection);
                } else if (!isModifiedKeyboardEvent(event)) {
                    event.preventDefault();
                    event.stopPropagation();

                    nestWithPreviousTaskRowIfExistsAndExpand(view.state.selection);
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

    // We initially consider ourselves to be fully scrolled to the left and to the
    // right. This means on server-render we won't see gradients. They will flash
    // in when we can measure element widths.
    const [isFullyScrolledLeft, setIsFullyScrolledLeft] = useState(true);
    const [isFullyScrolledRight, setIsFullyScrolledRight] = useState(true);

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

                // Native spellcheck is often more distracting then it's worth. It puts a red
                // squiggly under names, nouns, industry terms, and oddly sometimes
                // contractions (like "they're", maybe has to do with curly quotes?).
                //
                // It's also inconsistent with `<input>`s which don't have spellcheck on by
                // default.
                //
                // NOTE(calebmer, 2022-12-29): Someday in the future we should build our own
                // spellchecker.
                spellcheck: "false",
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
        view.dom.className = shouldRenderMultilineTitle
            ? taskRowTitleInputMultilineClassName
            : taskRowTitleInputSingleLineClassName;
        Object.assign(
            view.dom.style,
            shouldRenderMultilineTitle
                ? taskRowTitleInputMultilineStyle
                : taskRowTitleInputSingleLineStyle,
        );

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
            viewRef.current = {isReady: false, callbacks: new Set()};
            view.destroy();
        };

        // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
        // careful about what you put in here. Ideally we never destroy the
        // `EditorView` while this component is mounted.
    }, [isInitialAppRender, shouldRenderMultilineTitle]);

    // Update our `EditorView`'s `EditorState` whenever it changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!viewRef.current.isReady) return;
        viewRef.current.view.updateState(titleState);
    }, [isInitialAppRender, titleState]);

    const runWhenViewIsReady = useCallback((run: (view: EditorView) => void) => {
        if (viewRef.current.isReady) {
            run(viewRef.current.view);
            return noop;
        } else {
            const {callbacks} = viewRef.current;
            callbacks.add(run);
            return () => callbacks.delete(run);
        }
    }, []);

    useLayoutEffectWithoutServerSideWarning(() => {
        return runWhenViewIsReady(view => {
            if (!placeholder) {
                view.dom.removeAttribute("aria-placeholder");
            } else {
                view.dom.setAttribute("aria-placeholder", placeholder);
            }
        });
    }, [placeholder, runWhenViewIsReady]);

    const getSelection = useCallback(() => titleState.selection, [titleState.selection]);

    const focusStart = useCallback(() => {
        runWhenViewIsReady(view => {
            const selection = Selection.atStart(view.state.doc);

            view.focus();
            view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        });
    }, [runWhenViewIsReady]);

    const focusEnd = useCallback(() => {
        runWhenViewIsReady(view => {
            const selection = Selection.atEnd(view.state.doc);

            view.focus();
            view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        });
    }, [runWhenViewIsReady]);

    const focusAll = useCallback(() => {
        runWhenViewIsReady(view => {
            const selection = new AllSelection(view.state.doc);

            view.focus();
            view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        });
    }, [runWhenViewIsReady]);

    const focusCoord = useCallback(
        (coord: number) => {
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
        [runWhenViewIsReady],
    );

    const focusSelection = useCallback(
        (selection: Selection) => {
            runWhenViewIsReady(view => {
                view.focus();
                view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
            });
        },
        [runWhenViewIsReady],
    );

    useImperativeHandle(ref, () => ({
        getSelection,
        focusStart,
        focusEnd,
        focusAll,
        focusCoord,
        focusSelection,
    }));

    return (
        <div
            className={sprinkles({
                display: "flex",
                overflow: "hidden",
                position: "relative",
                zIndex: "0",
            })}
        >
            <div
                ref={containerRef}
                className={classNames(
                    sprinkles({
                        position: "relative",
                        zIndex: "0",
                        overflow: "hidden",
                        minHeight: taskRowTitleInputSingleLineHeight,
                        color: "grey-text",
                    }),
                    !isFullyScrolledLeft &&
                        tasksStyles.rowTitleInputOverflowGradientLeftContainerClassName,
                    !isFullyScrolledRight &&
                        tasksStyles.rowTitleInputOverflowGradientRightContainerClassName,
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
                        className={
                            shouldRenderMultilineTitle
                                ? taskRowTitleInputMultilineClassName
                                : taskRowTitleInputSingleLineClassName
                        }
                        style={
                            shouldRenderMultilineTitle
                                ? taskRowTitleInputMultilineStyle
                                : taskRowTitleInputSingleLineStyle
                        }
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
            {titleState.doc.childCount === 0 && placeholder && (
                // Render the placeholder in a div adjacent to our editor. For accessibility
                // the placeholder is present in an `aria-placeholder` but since the editor is
                // `display: inline-block` we need the placeholder to have width in the DOM
                // while not being editable. The best way to do that, we've found, is with a
                // separate `<div>` here.
                <div
                    aria-hidden={true}
                    className={sprinkles({
                        position: "absolute",
                        left: "0",
                        top: "0",
                        bottom: "0",
                        paddingY: "2",
                        pointerEvents: "none",
                        // Make sure placeholder is rendered underneath cursor.
                        zIndex: "-10",
                    })}
                    style={{
                        ...(shouldRenderMultilineTitle
                            ? taskRowTitleInputMultilineStyle
                            : taskRowTitleInputSingleLineStyle),
                        ...inputPlaceholderStyles,
                    }}
                >
                    {placeholder}
                </div>
            )}
            <div
                className={classNames(
                    tasksStyles.textCursorNotInheritedClassName,
                    sprinkles({
                        flexGrow: "1",
                        alignSelf: "stretch",
                    }),
                )}
                {...useOutOfBoundsClickSelection({
                    onSelect: focusEnd,
                    onSelectAll: focusAll,
                })}
            >
                <div
                    className={classNames(
                        tasksStyles.pointerEventsNoneNotInheritedClassName,
                        sprinkles({
                            display: "flex",
                            alignItems: "center",
                            height: taskRowTitleInputSingleLineHeight,
                        }),
                    )}
                >
                    {shouldShowParentTaskTitle && parentTaskTitle && indentation === 0 && (
                        <div
                            className={sprinkles({
                                pointerEvents: "none",
                                color: "grey-50",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5",
                                marginLeft: "1.5",
                            })}
                        >
                            <CaretLeft size={spacing["3"]} />
                            <div
                                className={sprinkles({
                                    fontStyle: "truncate",
                                    maxWidth: "48",
                                })}
                                dangerouslySetInnerHTML={{
                                    __html: serializeProsemirrorFragmentToHtml(
                                        parentTaskTitle.content,
                                    ),
                                }}
                            />
                        </div>
                    )}
                    {childTaskCount > 0 && (
                        <TaskRowTitleChildTasksButton
                            childTaskCount={childTaskCount}
                            closedChildTaskCount={closedChildTaskCount}
                            areChildTasksCollapsed={areChildTasksCollapsed}
                            onAreChildTasksCollapsedToggle={onAreChildTasksCollapsedToggle}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
