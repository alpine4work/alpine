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
    useMemo,
    useRef,
    useState,
} from "react";
import {ySyncPlugin} from "y-prosemirror";
import {isMac} from "~/client/helpers/browser/is_mac.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {
    TaskRowTitleChildTasksButton,
    TaskRowTitleChildTasksButtonRef,
} from "~/client/tasks/internal/task_row_title_child_tasks_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {useTaskTitleModelYDoc} from "~/client/tasks/internal/use_task_title_model_y_doc.js";
import {TaskClientStoreTaskEntry} from "~/client/tasks/task_client_store.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {RemLength, Spacing, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {
    contentSchemaStyles,
    inputPlaceholderStyles,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
    emptyTaskTitle,
    emptyTaskTitleProsemirrorNode,
    getTaskTitleProsemirrorNode,
} from "~/shared/tasks/task_title.js";

const taskRowTitleInputSingleLineHeight: Spacing = taskRowViewMinHeight;

export type TaskRowTitleInputRef = {
    getSelection(): Selection;
    isFocused(): boolean;
    focusStart(): void;
    focusEnd(): void;
    focusAll(): void;
    focusCoord(coord: number, side: "top" | "bottom"): void;
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
    userSelect: "text",
})}`;

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
    userSelect: "text",
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
        capabilities,
        title,
        onTitleChange,
        placeholder,
        indentation,
        paddingRight,
        parentTaskEntryStore,
        childTaskCount,
        closedChildTaskCount,
        areChildTasksExpanded,
        onAreChildTasksExpandedToggle,
        createTaskAbove,
        createTaskBelowAndFocus,
        nestWithPreviousTaskRowIfExistsAndExpand,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
        focusNextTaskTitleCoord,
        focusPreviousTaskTitleCoord,
        preserveLastTaskTitleArrowNavigationCoord,
        focusFirstVisibleTaskTitleStart,
        focusLastVisibleTaskTitleEnd,
        focusNextCell,
        focusPreviousCell,
    }: {
        capabilities: TaskGridViewCapabilities;
        title: TaskTitleModel;
        onTitleChange: (titleUpdate: TaskTitleUpdate) => void;
        placeholder?: string;
        indentation: number;
        paddingRight: RemLength | undefined;
        parentTaskEntryStore: Store<TaskClientStoreTaskEntry> | null;
        childTaskCount: number;
        closedChildTaskCount: number;
        areChildTasksExpanded: boolean;
        onAreChildTasksExpandedToggle: () => void;
        createTaskAbove: () => void;
        createTaskBelowAndFocus: () => void;
        nestWithPreviousTaskRowIfExistsAndExpand: (selection: Selection) => void;
        unnestTaskIfNestedRow: (selection: Selection) => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: (options: {withConfirmation: boolean}) => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        preserveLastTaskTitleArrowNavigationCoord: () => void;
        focusFirstVisibleTaskTitleStart: () => void;
        focusLastVisibleTaskTitleEnd: () => void;
        focusNextCell: () => void;
        focusPreviousCell: () => void;
    },
    ref: Ref<TaskRowTitleInputRef>,
) {
    const isInitialAppRender = useIsInitialAppRender();
    const containerRef = useRef<HTMLDivElement>(null);

    const viewRef = useRef<
        | {isReady: false; callbacks: Set<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: new Set()});
    const childTasksButtonRef = useRef<TaskRowTitleChildTasksButtonRef>(null);

    const titleYDoc = useTaskTitleModelYDoc(title, onTitleChange);

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
                    } else {
                        createTaskBelowAndFocus();
                    }
                }
                break;
            }
            case "Backspace": {
                if (view.state.doc.childCount === 0) {
                    event.preventDefault();
                    event.stopPropagation();

                    deleteTaskAndAllChildrenAndFocusPreviousRow({
                        // If the task has some children make sure the user confirms that deleting
                        // subtasks is ok.
                        withConfirmation: childTaskCount > 0,
                    });
                }
                break;
            }
            case "ArrowUp": {
                if (isMac ? event.metaKey : event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    // cmd-up goes up a page instead of to the top of the query. That's because
                    // cmd-down can't get to the bottom of a query since we load queries top down.
                    // To see the bottom of a query we'd have to load the entire query on the
                    // backend! Going page up/down is a reasonable implementation that's mostly in
                    // line with user expectations.
                    focusFirstVisibleTaskTitleStart();
                } else if (event.altKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    view.dispatch(
                        view.state.tr
                            .setSelection(Selection.atStart(view.state.doc))
                            .scrollIntoView(),
                    );
                } else if (!isModifiedKeyboardEvent(event)) {
                    const viewRect = view.dom.getBoundingClientRect();
                    const coords = view.coordsAtPos(view.state.selection.from);
                    const height = coords.bottom - coords.top;

                    // Only navigate to the previous task if our selection is at the top of
                    // the view.
                    if (coords.top - height <= viewRect.top) {
                        event.preventDefault();
                        event.stopPropagation();
                        focusPreviousTaskTitleCoord(coords.left);
                    } else {
                        preserveLastTaskTitleArrowNavigationCoord();
                    }
                }
                break;
            }
            case "ArrowDown": {
                if (isMac ? event.metaKey : event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    // cmd-down goes down a page instead of to the bottom of the query. That's
                    // because cmd-down can't get to the bottom of a query since we load queries top
                    // down. To see the bottom of a query we'd have to load the entire query on the
                    // backend! Going page up/down is a reasonable implementation that's mostly in
                    // line with user expectations.
                    focusLastVisibleTaskTitleEnd();
                } else if (event.altKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    view.dispatch(
                        view.state.tr
                            .setSelection(Selection.atEnd(view.state.doc))
                            .scrollIntoView(),
                    );
                } else if (!isModifiedKeyboardEvent(event)) {
                    const viewRect = view.dom.getBoundingClientRect();
                    const coords = view.coordsAtPos(view.state.selection.from);
                    const height = coords.bottom - coords.top;

                    // Only navigate to the next task if our selection is at the bottom of
                    // the view.
                    if (coords.bottom + height >= viewRect.bottom) {
                        event.preventDefault();
                        event.stopPropagation();
                        focusNextTaskTitleCoord(coords.left);
                    } else {
                        preserveLastTaskTitleArrowNavigationCoord();
                    }
                }
                break;
            }
            case "ArrowLeft": {
                if (
                    view.state.selection.from === view.state.selection.to &&
                    view.state.selection.from === 0
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    focusPreviousCell();
                }
                break;
            }
            case "ArrowRight": {
                if (
                    view.state.selection.from === view.state.selection.to &&
                    view.state.selection.from === view.state.doc.nodeSize - 2
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (childTaskCount > 0) {
                        assertExists(childTasksButtonRef.current).focus();
                    } else {
                        focusNextCell();
                    }
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

    const titleRef = useRef(title);
    const handleKeyDownRef = useRef(handleKeyDown);
    const isReadOnlyRef = useRef(capabilities.isReadOnly);
    useLayoutEffectWithoutServerSideWarning(() => {
        titleRef.current = title;
        handleKeyDownRef.current = handleKeyDown;
        isReadOnlyRef.current = capabilities.isReadOnly;
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

        const view = new EditorView(containerElement, {
            state: EditorState.create({
                schema: TaskTitleProsemirrorSchema,
                // Make sure we start with the correct initial document. After this the
                // `ySyncPlugin` manages document state.
                doc: getTaskTitleProsemirrorNode(titleRef.current.raw),
                plugins: [ySyncPlugin(titleYDoc.getXmlFragment("doc"))],
            }),

            // We add this prop to `prosemirror-view` with a patch. With this prop when the
            // editor is focused we place focus where the browser places focus. So if the
            // user clicks into the editor focus goes to where the user clicked. Not to the
            // selection currently in state.
            shouldUseDOMSelectionOnFocus: true,

            // Disable editing when the `isReadOnly` prop is set.
            editable: () => !isReadOnlyRef.current,

            attributes: {
                // Title row inputs are focusable but are not a part of the tab order.
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

                updateEditorEmptyClass(newTitleState);

                view.updateState(newTitleState);
            },
        });

        view.dom.ariaLabel = taskRowTitleInputAriaLabel;
        view.dom.className = capabilities.hasMultilineTitle
            ? taskRowTitleInputMultilineClassName
            : taskRowTitleInputSingleLineClassName;
        Object.assign(
            view.dom.style,
            capabilities.hasMultilineTitle
                ? taskRowTitleInputMultilineStyle
                : taskRowTitleInputSingleLineStyle,
        );

        // Don't render a scrollbar with our row title input.
        view.dom.dataset.scrollbar = "false";

        const updateFullyScrolledState = () => {
            setIsFullyScrolledLeft(view.dom.scrollLeft === 0);
            setIsFullyScrolledRight(
                Math.ceil(view.dom.scrollLeft + view.dom.clientWidth) + 1 >= view.dom.scrollWidth,
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

        updateEditorEmptyClass(view.state);

        return () => {
            view.dom.removeEventListener("scroll", updateFullyScrolledState);
            viewRef.current = {isReady: false, callbacks: new Set()};
            view.destroy();
        };

        // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
        // careful about what you put in here. Ideally we never destroy the
        // `EditorView` while this component is mounted.
    }, [capabilities.hasMultilineTitle, isInitialAppRender, titleYDoc]);

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

    const {getSelection, isFocused, focusStart, focusEnd, focusAll, focusCoord, focusSelection} =
        useMemo(
            () => ({
                getSelection: () => {
                    if (!viewRef.current.isReady) {
                        // A selection at the start of an empty task title should be the same as the
                        // initial selection for our title when the view is ready.
                        return Selection.atStart(emptyTaskTitleProsemirrorNode);
                    } else {
                        return viewRef.current.view.state.selection;
                    }
                },
                isFocused: () => {
                    if (!viewRef.current.isReady) return false;
                    return viewRef.current.view.dom === document.activeElement;
                },
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
                focusCoord: (coord: number, side: "top" | "bottom") => {
                    runWhenViewIsReady(view => {
                        const viewRect = view.dom.getBoundingClientRect();

                        const posResult = view.posAtCoords({
                            left: coord,
                            top:
                                side === "top"
                                    ? viewRect.top +
                                      parseFloat(getComputedStyle(view.dom).paddingTop) +
                                      1
                                    : viewRect.bottom -
                                      parseFloat(getComputedStyle(view.dom).paddingBottom) -
                                      1,
                        });

                        const selection = posResult
                            ? new TextSelection(view.state.doc.resolve(posResult.pos))
                            : coord > viewRect.right
                            ? Selection.atEnd(view.state.doc)
                            : Selection.atStart(view.state.doc);

                        view.focus();
                        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                    });
                },
                focusSelection: (selection: Selection) => {
                    runWhenViewIsReady(view => {
                        view.focus();

                        // If the document changed since the selection was created then create a
                        // bookmark for the selection and resolve it to the new doc.
                        //
                        // We added `focusSelection()` so that when indenting/dedenting (which sometimes
                        // mounts/unmounts the task) we can preserve the selection. For that use case we
                        // don't expect the underlying document to actually be different but we'll have
                        // created a new `titleYDoc` that also creates a new ProseMirror node so strict
                        // equality checks fail.
                        if (selection.$from.doc !== view.state.doc) {
                            selection = selection.getBookmark().resolve(view.state.doc);
                        }

                        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                    });
                },
            }),
            [runWhenViewIsReady],
        );

    useImperativeHandle(ref, () => ({
        getSelection,
        isFocused,
        focusStart,
        focusEnd,
        focusAll,
        focusCoord,
        focusSelection,
    }));

    function updateEditorEmptyClass(state: EditorState) {
        assert(viewRef.current.isReady);
        const containerElement = assertExists(
            viewRef.current.view.dom.parentElement?.parentElement,
        );

        const addEmptyClassName = state.doc.childCount === 0;
        if (
            addEmptyClassName &&
            !containerElement.classList.contains(tasksStyles.rowTitleInputEmptyContainerClassName)
        ) {
            containerElement.classList.add(tasksStyles.rowTitleInputEmptyContainerClassName);
        }
        if (
            !addEmptyClassName &&
            containerElement.classList.contains(tasksStyles.rowTitleInputEmptyContainerClassName)
        ) {
            containerElement.classList.remove(tasksStyles.rowTitleInputEmptyContainerClassName);
        }
    }

    const taskNodeForInitialAppRender = isInitialAppRender
        ? getTaskTitleProsemirrorNode(title.raw)
        : null;

    return (
        <div
            className={classNames(
                sprinkles({
                    display: "flex",
                    overflow: "hidden",
                    position: "relative",
                    zIndex: "0",
                }),
                taskNodeForInitialAppRender &&
                    taskNodeForInitialAppRender.childCount === 0 &&
                    // We use a different class than `rowTitleInputEmptyContainerClassName` because
                    // we don't want React removing the class managed by `updateEditorEmptyClass()`.
                    tasksStyles.rowTitleInputInitialAppRenderEmptyContainerClassName,
            )}
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
                {taskNodeForInitialAppRender && (
                    // On server-side render serialize our title to HTML since we can't mount an
                    // `EditorView` until we are on the client.
                    <div
                        className={
                            capabilities.hasMultilineTitle
                                ? taskRowTitleInputMultilineClassName
                                : taskRowTitleInputSingleLineClassName
                        }
                        style={
                            capabilities.hasMultilineTitle
                                ? taskRowTitleInputMultilineStyle
                                : taskRowTitleInputSingleLineStyle
                        }
                        data-scrollbar="false"
                        aria-label={taskRowTitleInputAriaLabel}
                        aria-placeholder={placeholder}
                        // See why we set this attribute on `EditorView`.
                        tabIndex={-1}
                        dangerouslySetInnerHTML={{
                            __html: serializeProsemirrorFragmentToHtml(
                                taskNodeForInitialAppRender.content,
                            ),
                        }}
                    />
                )}
            </div>
            {placeholder && (
                // Render the placeholder in a div adjacent to our editor. For accessibility
                // the placeholder is present in an `aria-placeholder` but since the editor is
                // `display: inline-block` we need the placeholder to have width in the DOM
                // while not being editable. The best way to do that, we've found, is with a
                // separate `<div>` here.
                <div
                    aria-hidden={true}
                    className={classNames(
                        // Since we don't have access to the title node in our render method we
                        // imperatively add/remove a class on our container to let us know when it's
                        // empty or not and use CSS to control our placeholder visibility.
                        tasksStyles.rowTitleInputPlaceholderClassName,
                        sprinkles({
                            position: "absolute",
                            left: "0",
                            top: "0",
                            bottom: "0",
                            paddingY: "2",
                            pointerEvents: "none",
                            // Make sure placeholder is rendered underneath cursor.
                            zIndex: "-10",
                        }),
                    )}
                    style={{
                        ...(capabilities.hasMultilineTitle
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
                    !capabilities.isReadOnly
                        ? tasksStyles.textCursorNotInheritedClassName
                        : undefined,
                    sprinkles({
                        flexGrow: "1",
                        alignSelf: "stretch",
                    }),
                )}
                style={{paddingRight}}
                {...useOutOfBoundsClickSelection({
                    isDisabled: capabilities.isReadOnly,
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
                    {capabilities.hasParentTaskTitle &&
                        parentTaskEntryStore &&
                        indentation === 0 && (
                            <TaskRowTitleParentTaskTitle
                                parentTaskEntryStore={parentTaskEntryStore}
                            />
                        )}
                    {childTaskCount > 0 && (
                        <TaskRowTitleChildTasksButton
                            ref={childTasksButtonRef}
                            childTaskCount={childTaskCount}
                            closedChildTaskCount={closedChildTaskCount}
                            areChildTasksExpanded={areChildTasksExpanded}
                            onAreChildTasksExpandedToggle={onAreChildTasksExpandedToggle}
                            onKeyDown={event => {
                                switch (event.key) {
                                    case "ArrowLeft": {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        focusEnd();
                                        break;
                                    }
                                    case "ArrowRight": {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        focusNextCell();
                                        break;
                                    }
                                }
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function TaskRowTitleParentTaskTitle({
    parentTaskEntryStore,
}: {
    parentTaskEntryStore: Store<TaskClientStoreTaskEntry>;
}) {
    const parentTaskEntry = useStore(parentTaskEntryStore);
    const parentTaskTitle = parentTaskEntry.task?.getTitle();

    const parentTaskTitleHtml = useMemo(
        () =>
            serializeProsemirrorFragmentToHtml(
                getTaskTitleProsemirrorNode(parentTaskTitle?.raw ?? emptyTaskTitle.get()).content,
            ),
        [parentTaskTitle?.raw],
    );

    return (
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
                    __html: parentTaskTitleHtml,
                }}
            />
        </div>
    );
}
