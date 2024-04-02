import classNames from "classnames";
import {CaretLeft, Lock} from "phosphor-react";
import {AllSelection, EditorState, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    CSSProperties,
    Key,
    Ref,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useInsertionEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {unstable_LowPriority, unstable_scheduleCallback} from "scheduler";
import {ySyncPlugin, ySyncPluginKey, yUndoPlugin, yXmlFragmentToProsemirror} from "y-prosemirror";
import * as Y from "yjs";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCanPrimaryInputHover} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {createTaskEntryAccessStore} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {
    TaskRowTitleChildTasksButton,
    TaskRowTitleChildTasksButtonRef,
} from "~/client/tasks/internal/task_row_title_child_tasks_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {useTaskTitleModelYDoc} from "~/client/tasks/internal/use_task_title_model_y_doc.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStoreTaskEntry} from "~/client/tasks/task_client_store.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {RemLength, Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {
    contentSchemaStyles,
    inputPlaceholderStyles,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {emptyTaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
    emptyTaskTitleProsemirrorNode,
} from "~/shared/tasks/task_title.js";

const taskRowTitleInputSingleLineHeight: Spacing = taskRowViewMinHeight;
const taskRowTitleInputSingleLineHeightRem = parseRemLengthNumber(
    spacing[taskRowTitleInputSingleLineHeight],
);

export const taskRowTitleInputPaddingY: RemLength = `${
    (parseRemLengthNumber(spacing[taskRowViewMinHeight]) -
        parseRemLengthNumber(contentSchemaStyles.paragraphLineHeight)) /
    2
}rem`;

export type TaskRowTitleInputRef = {
    getSelection(): Selection;
    isFocused(): boolean;
    // NOCOMMIT: These focus methods should do the update state trick when in dual
    // modality mode.
    focusStart(): void;
    focusEnd(): void;
    focusAll(): void;
    focusCoord(coord: number, side: "top" | "bottom"): void;
    focusSelection(selection: Selection): void;
    isEmpty(): boolean;
    clear(): void;
};

const taskRowTitleInputAriaLabel = "Title";

const taskRowTitleInputSingleLineClassName = `ProseMirror ${sprinkles({
    // Use an `inline-block` display so the `<div>` width is equal to our content width.
    display: "inline-block",
    maxWidth: "full",
    height: taskRowTitleInputSingleLineHeight,
    overflowY: "hidden",
    overflowX: "scroll",
    backgroundColor: "transparent",
    userSelect: "text",
})}`;

const taskRowTitleInputSingleLineStyle: CSSProperties = {
    ...contentSchemaStyles.paragraphFontSize,
    paddingTop: taskRowTitleInputPaddingY,
    paddingBottom: taskRowTitleInputPaddingY,
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
    backgroundColor: "transparent",
    userSelect: "text",
})}`;

const taskRowTitleInputMultilineStyle: CSSProperties = {
    ...contentSchemaStyles.paragraphFontSize,
    paddingTop: taskRowTitleInputPaddingY,
    paddingBottom: taskRowTitleInputPaddingY,
    // Make sure we have room to render the cursor.
    minWidth: "1ch",
    // `display: inline-block` creates an inline layout which adds extra space
    // below the element. Adding `vertical-align` stops the space from being added.
    // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
    verticalAlign: "top",
};

const rootClassName = sprinkles({
    display: "flex",
    overflow: "hidden",
    position: "relative",
    zIndex: "0",
});

const containerClassName = sprinkles({
    position: "relative",
    zIndex: "0",
    overflow: "hidden",
    minHeight: taskRowTitleInputSingleLineHeight,
    color: "grey-text",
});

const placeholderClassName = sprinkles({
    position: "absolute",
    left: "0",
    top: "0",
    bottom: "0",
    paddingY: "2",
    pointerEvents: "none",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: "-10",
});

const marginRightContainerClassName = sprinkles({
    position: "relative",
    // Higher z-index than content so in a multiline title if we put margin right
    // content on top of the title text it's clickable.
    zIndex: "10",
    flexGrow: "1",
    alignSelf: "stretch",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
});

const taskRowTitleInputMultilineAfterWidthRem = parseRemLengthNumber(
    spacing[tasksStyles.taskRowTitleInputMultilineAfterWidth],
);

const marginRightContentContainerClassName = sprinkles({
    flexGrow: "1",
    display: "flex",
    alignItems: "center",
    gap: "3",
    height: taskRowTitleInputSingleLineHeight,
});

const parentTaskTitleClassName = sprinkles({
    pointerEvents: "none",
    color: "grey-50",
    display: "flex",
    alignItems: "center",
    gap: "0.5",
    maxWidth: "full",
    overflow: "hidden",
});

const parentTaskTitleIconClassName = sprinkles({
    flexShrink: "0",
});

const parentTaskTitlePermissionDeniedClassName = sprinkles({
    display: "flex",
    alignItems: "center",
    gap: "1",
});

const parentTaskTitleTextClassName = sprinkles({
    fontStyle: "truncate",
    maxWidth: "48",
});

type TaskRowTitleInputMultilineState = {
    readonly remainingWidth: number;
    readonly withoutMarginLeft: boolean;
};

const TaskRowTitleInputForwardRef = forwardRef(TaskRowTitleInput);
export {TaskRowTitleInputForwardRef as TaskRowTitleInput};

let scheduledDestroyTaskRowTitleInputEditorViewCallbacks: Array<() => void> | null = null;

function TaskRowTitleInput(
    {
        capabilities,
        maxGridExpandableTaskDepth,
        stateKey,
        query,
        task,
        onTitleChange,
        placeholder,
        indentation,
        paddingRight,
        parentTaskEntryStore,
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
        pushUndoStackYDocEntry,
        pushUndoStackYDocEntryFromRedo,
        pushRedoStackYDocEntry,
    }: {
        capabilities: TaskGridViewCapabilities;
        maxGridExpandableTaskDepth: number;
        stateKey: Key | undefined;
        query: TaskClientQuery;
        task: TaskModel | null;
        onTitleChange: (titleUpdate: TaskTitleUpdate) => void;
        placeholder?: string;
        indentation: number;
        paddingRight: RemLength | undefined;
        parentTaskEntryStore: Store<TaskClientStoreTaskEntry> | null;
        areChildTasksExpanded: boolean;
        onAreChildTasksExpandedToggle: () => void;
        createTaskAbove: () => void;
        createTaskBelowAndFocus: () => void;
        nestWithPreviousTaskRowIfExistsAndExpand: (selection: Selection) => void;
        unnestTaskIfNestedRow: (selection: Selection) => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: () => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        preserveLastTaskTitleArrowNavigationCoord: () => void;
        focusFirstVisibleTaskTitleStart: () => void;
        focusLastVisibleTaskTitleEnd: () => void;
        focusNextCell: () => void;
        focusPreviousCell: () => void;
        pushUndoStackYDocEntry: (entry: {yUndoManager: Y.UndoManager; release: () => void}) => void;
        pushUndoStackYDocEntryFromRedo: (entry: {
            yUndoManager: Y.UndoManager;
            release: () => void;
        }) => void;
        pushRedoStackYDocEntry: (entry: {yUndoManager: Y.UndoManager; release: () => void}) => void;
    },
    ref: Ref<TaskRowTitleInputRef>,
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

    const canPrimaryInputHover = useCanPrimaryInputHover();
    const {isAppleDevice} = useClientInfo();
    const remPx = useRemPx();
    const isInitialAppRender = useIsInitialAppRender();

    // Title input is in dual modality mode if:
    //
    // - We are on a mobile device (drag handle is hidden on mobile sizes); OR
    // - The primary input can't hover (e.g. we're on an iPad)
    //
    // Dual modality mode, like `<ContentEditor>`, means the input content is
    // interactive while unfocused and non-interactive while focused. Now, task row
    // title inputs don't currently have any interactive content but we may add
    // mentions, links, or other styling options in the future that require
    // interaction.
    const isDualModality = !canPrimaryInputHover;

    const viewRef = useRef<
        | {isReady: false; callbacks: Set<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: new Set()});
    const childTasksButtonRef = useRef<TaskRowTitleChildTasksButtonRef>(null);

    const title = task?.getTitle() ?? emptyTaskTitleModel.get();

    const titleYDoc = useTaskTitleModelYDoc({
        title,
        onTitleChange,
        pushUndoStackYDocEntry,
        pushUndoStackYDocEntryFromRedo,
        pushRedoStackYDocEntry,
    });

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

                    deleteTaskAndAllChildrenAndFocusPreviousRow();
                }
                break;
            }
            case "ArrowUp": {
                if (isAppleDevice ? event.metaKey : event.ctrlKey) {
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
                if (isAppleDevice ? event.metaKey : event.ctrlKey) {
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

                    if ((task?.getChildTaskCount() ?? 0) > 0) {
                        const childTasksButton = assertExists(childTasksButtonRef.current);
                        if (childTasksButton.isFocusable()) {
                            childTasksButton.focus();
                        } else {
                            focusNextCell();
                        }
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
    const remPxRef = useRef(remPx);
    const isDualModalityRef = useRef(isDualModality);
    useInsertionEffect(() => {
        titleRef.current = title;
        handleKeyDownRef.current = handleKeyDown;
        isReadOnlyRef.current = capabilities.isReadOnly;
        remPxRef.current = remPx;
        isDualModalityRef.current = isDualModality;
    });

    const onLayoutEffectCallbacksRef = useRef<Array<() => void>>([]);
    useLayoutEffectWithoutServerSideWarning(() => {
        const callbacks = onLayoutEffectCallbacksRef.current;
        onLayoutEffectCallbacksRef.current = [];

        for (const callback of callbacks) {
            callback();
        }
    });

    // We initially consider ourselves to be fully scrolled to the left and to the
    // right. This means on server-render we won't see gradients. They will flash
    // in when we can measure element widths.
    const [isFullyScrolledLeft, setIsFullyScrolledLeft] = useState(true);
    const [isFullyScrolledRight, setIsFullyScrolledRight] = useState(true);

    const shouldShowChildTasksButton = (task?.getChildTaskCount() ?? 0) > 0;

    const shouldShowParentTaskTitle =
        capabilities.hasParentTaskTitle && !!parentTaskEntryStore && indentation === 0;

    // If the task has a multiline title and margin right content (show child task
    // button or parent task title) then we want to render the margin right content
    // in the negative space at the end of our wrapped text.
    //
    // For example, we want to put margin right content in the area occupied by
    // dashes (`---`) in the text below.
    //
    // ```
    // this is another subtask that's very long, i’m going to just keep typing
    // in it until it wraps onto a new line ----------------------------------
    // ```
    //
    // This is quite a challenge! There's no easy CSS rule to put content where we
    // need. So when we have both margin content and a multiline title we do the
    // following:
    //
    // 1. Add a CSS class with an `::after` pseudo element that adds some spacer
    //    width to the end of the multiline title. Let's say 100px. This way if the
    //    text is less than 100px from the container edge it will break and create
    //    a new line.
    //
    // 2. In a layout effect, do some measurements. If the text occupies a single
    //    line, set `multilineState` to null. Otherwise set `multilineState` so it
    //    contains the width between the container right edge and the last
    //    character in the title.
    //
    // So we need a two phase React render to position everything correctly.
    const hasMultilineTitleAndShouldShowMarginRightContent =
        capabilities.hasMultilineTitle && (shouldShowChildTasksButton || shouldShowParentTaskTitle);

    const [multilineState, setMultilineState] = useState<TaskRowTitleInputMultilineState | null>(
        null,
    );
    if (!hasMultilineTitleAndShouldShowMarginRightContent && multilineState !== null) {
        setMultilineState(null);
    }

    // Huh? `useInsertionEffect()`? That's a React hook? Ok, [it is][1] but the
    // docs say only CSS-in-JS libraries should use it.
    //
    // Wait what?? A `rootElement` parameter??? That's not documented? What the what?
    //
    // This is me reenacting your reaction to this code. Something very strange is
    // afoot here. Instead of using `useLayoutEffect()` to mount our ProseMirror
    // editor, we use `useInsertionEffect()`. This is pretty critical for
    // the performance of a large task grid view.
    //
    // We need to use `useInsertionEffect()` to prevent browser [layout
    // thrashing][2]. Layout thrashing happens when you read from the DOM and write
    // to the DOM in a loop. Since whenever you read from the DOM after writing to
    // the DOM the browser needs to perform an expensive layout calculation to give
    // you the right answer. So if you're in a loop that expensive layout
    // calculation happens on every iteration of the loop.
    //
    // A common way to fix this is to batch your reads and writes with a library
    // like [`fastdom`][3]. React is already batching writes internally though so
    // ideally we'd use React itself.
    //
    // A React render you can think of as a big loop over components. It happens in
    // three phases:
    //
    // 1. Render phase: React calls all of your function components to build up the
    //    new virtual DOM.
    // 2. Mutation phase: React reconciles your virtual DOM with the actual DOM.
    //    Creating new nodes and appending them. `useInsertionEffect()` is called
    //    during this phase.
    // 3. Layout phase: React updates all your `ref`s and calls
    //    `useLayoutEffect()`s.
    // 4. React is done, now the browser paints.
    //
    // The intended use of `useLayoutEffect()` is to [measure layout before the
    // browser repaints the screen][4]. Otherwise you should use `useEffect()` if
    // your effect can run after the browser paints (most effects). So that's how
    // we use `useLayoutEffect()` in our code.
    //
    // The problem is if you read from the DOM in `useLayoutEffect()` in one
    // component and write to the DOM in `useLayoutEffect()` in another component
    // (this one) and you're rendering a large list of stuff you get layout thrash!
    //
    // We saw this when rendering task grid views. The solution, like
    // [`fastdom`][3], is to batch our DOM writes (adding the ProseMirror editor to
    // the DOM) with React. Our DOM reads continue to be batched in the layout
    // phase.
    //
    // React gives us a mutation phase hook, `useInsertionEffect()`. However, it's
    // pretty severely limited since it doesn't have access to the DOM React is
    // actively rendering. So we PATCH REACT to pass in the DOM element it's
    // rendering to the effect (hence `rootElement`). `rootElement` is not attached
    // to document. `document.body.contains(rootElement)` will return false. React
    // renders children first then parents. Once we render the final parent React
    // will add our element to the document. However it's ok if the element isn't
    // attached to the DOM when we build our ProseMirror editor.
    //
    // I want to know what the React team thinks the proper solution to this layout
    // thrashing problem is. I believe React is missing a feature which is why I
    // resorted to a patch. Maybe we turn this into a blog post someday to get the
    // React team's attention.
    //
    // [1]: https://react.dev/reference/react/useInsertionEffect
    // [2]: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
    // [3]: https://www.npmjs.com/package/fastdom
    // [4]: https://react.dev/reference/react/useLayoutEffect#measuring-layout-before-the-browser-repaints-the-screen
    useInsertionEffect(
        (rootElement?: HTMLDivElement) => {
            // Wait for the client-side rerender before mounting our editor.
            if (isInitialAppRender) return;

            assert(rootElement);

            const containerElement = assertExists(rootElement.firstElementChild);
            assert(containerElement.childElementCount === 0);

            const yXmlFragment = titleYDoc.getXmlFragment("doc");

            // Make sure our undo manager sees transactions originating from our
            // `EditorView`.
            titleYDoc.getUndoManager().addTrackedOrigin(ySyncPluginKey);

            const viewElement = document.createElement("div");
            containerElement.appendChild(viewElement);

            // Set the role for assistive technologies. For documentation see:
            // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
            viewElement.role = "textbox";

            // Update the view element before `EditorView`'s `MutationObserver` starts
            // listening for changes. When `MutationObserver` detects a change it will
            // perform a browser layout which is expensive.
            viewElement.ariaLabel = taskRowTitleInputAriaLabel;
            viewElement.className = capabilities.hasMultilineTitle
                ? hasMultilineTitleAndShouldShowMarginRightContent
                    ? `${taskRowTitleInputMultilineClassName} ${tasksStyles.taskRowTitleInputMultilineAfterClassName}`
                    : taskRowTitleInputMultilineClassName
                : taskRowTitleInputSingleLineClassName;
            Object.assign(
                viewElement.style,
                capabilities.hasMultilineTitle
                    ? taskRowTitleInputMultilineStyle
                    : taskRowTitleInputSingleLineStyle,
            );

            // Don't render a scrollbar with our row title input.
            viewElement.dataset.scrollbar = "false";

            const initialIsDualModality = isDualModalityRef.current;
            const initialIsReadOnly = isReadOnlyRef.current;
            const initialIsEditable = !initialIsDualModality && !initialIsReadOnly;

            const view = new EditorView(
                {mount: viewElement},
                {
                    state: EditorState.create({
                        schema: TaskTitleProsemirrorSchema,
                        // Make sure we start with the correct initial document. After this the
                        // `ySyncPlugin` manages document state.
                        doc: yXmlFragmentToProsemirror(TaskTitleProsemirrorSchema, yXmlFragment),
                        plugins: [
                            ySyncPlugin(yXmlFragment),
                            // We install the Y.js undo plugin but we don't install the `undo`/`redo`
                            // commands from `y-prosemirror` in a keymap. Instead `useTaskTitleModelYDoc()`
                            // registers us with our global undo stack.
                            yUndoPlugin({undoManager: titleYDoc.getUndoManager()}),
                        ],
                    }),

                    // We add this prop to `prosemirror-view` with a patch. With this prop when the
                    // editor is focused we place focus where the browser places focus. So if the
                    // user clicks into the editor focus goes to where the user clicked. Not to the
                    // selection currently in state.
                    shouldUseDOMSelectionOnFocus: true,

                    // Disable editing when the `isReadOnly` prop is set.
                    //
                    // Or if we're in dual modality mode on mobile/touch devices.
                    editable: () => initialIsEditable,

                    // NOTE(calebmer): If you add or update an attribute here you'll also need to
                    // update the attribute in a layout effect below! Since `tabindex` needs to
                    // update as our editable state changes.
                    attributes: {
                        // Title row inputs are focusable but are not a part of the tab order.
                        ...(initialIsEditable ? {tabindex: "-1"} : {}),

                        // Native spellcheck is often more distracting then it's worth. It puts a red
                        // squiggly under names, nouns, industry terms, and oddly sometimes
                        // contractions (like "they're", maybe has to do with curly quotes?).
                        //
                        // It's also inconsistent with `<input>`s which don't have spellcheck on by
                        // default.
                        //
                        // NOTE(calebmer, 2022-12-29): Someday in the future we should build our own
                        // spellchecker.
                        //
                        // NOTE(calebmer, 2023-02-19): Re-enabling this is now even harder now that we
                        // have custom right-click menus. On desktop you right click to see the correct
                        // spellings. But if we have our own right-click menu we can't show the correct
                        // spellings there so we only show a permanent red squiggle which is bad. I
                        // think the best answer here is to build our own spellchecker eventually.
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

                        if (hasMultilineTitleAndShouldShowMarginRightContent) {
                            // Make sure React state updates render in the same paint as transaction.
                            runWithImmediatePriority(() => {
                                updateMultilineState(false);
                            });
                        }
                    },
                },
            );

            if (!initialIsEditable) {
                view.dom.classList.add(tasksStyles.rowTitleInputIsNotEditableClassName);
            }

            const updateFullyScrolledState = (isInitialUpdate: boolean) => {
                const isFullyScrolledLeft = view.dom.scrollLeft === 0;
                const isFullyScrolledRight =
                    Math.ceil(view.dom.scrollLeft + view.dom.clientWidth) + 1 >=
                    view.dom.scrollWidth;

                // NOTE(calebmer): For performance, it's important we call
                // `setMultilineState()` instead of directly updating styles. This way React
                // batches DOM writes. So we batch DOM reads in `useLayoutEffect()` then batch
                // DOM writes with state updates. Otherwise we risk [layout thrashing][1].
                //
                // NOTE(calebmer): Unexpectedly, I've found calling `setState(state)` on the
                // first render if `state` is the same as the hook's initial state triggers a
                // React re-render. I would have expected React to noop calls that don't change
                // state. Maybe it behaves differently on the first render? Anyway, avoid
                // calling `setState(state)` on initial update if we can.
                //
                // [1]: https://gist.github.com/paulirish/5d52fb081b3570c81e3a

                if (!isInitialUpdate || !isFullyScrolledLeft) {
                    setIsFullyScrolledLeft(isFullyScrolledLeft);
                }

                if (!isInitialUpdate || !isFullyScrolledRight) {
                    setIsFullyScrolledRight(isFullyScrolledRight);
                }
            };

            // This reads from the DOM (`scrollLeft`). We can't run this during React's
            // insertion phase. It has to run in a layout effect.
            onLayoutEffectCallbacksRef.current.push(() => {
                if (view.isDestroyed) return;
                updateFullyScrolledState(true);
            });

            view.dom.addEventListener("scroll", () => updateFullyScrolledState(false));

            const updateEditorEmptyClass = (state: EditorState) => {
                const addEmptyClassName = state.doc.childCount === 0;
                if (
                    addEmptyClassName &&
                    !rootElement.classList.contains(
                        tasksStyles.rowTitleInputEmptyContainerClassName,
                    )
                ) {
                    rootElement.classList.add(tasksStyles.rowTitleInputEmptyContainerClassName);
                }
                if (
                    !addEmptyClassName &&
                    rootElement.classList.contains(tasksStyles.rowTitleInputEmptyContainerClassName)
                ) {
                    rootElement.classList.remove(tasksStyles.rowTitleInputEmptyContainerClassName);
                }
            };

            // This mutates the DOM but does not read from the DOM in a way that triggers
            // layout. It's ok to run during React's insertion phase.
            updateEditorEmptyClass(view.state);

            const updateMultilineState = (isInitialUpdate: boolean) => {
                assert(hasMultilineTitleAndShouldShowMarginRightContent);
                const {state} = view;

                const rootRect = rootElement.getBoundingClientRect();
                let newMultilineState: TaskRowTitleInputMultilineState | null = null;

                if (
                    state.doc.nodeSize > 2 &&
                    // Make sure the input has more than one line...
                    rootRect.height > taskRowTitleInputSingleLineHeightRem * remPxRef.current
                ) {
                    const endCoords = view.coordsAtPos(state.doc.nodeSize - 2, 1);
                    const remainingWidth = rootRect.left + rootRect.width - endCoords.left;

                    // If there's less width than our "after width" that means our after class will
                    // have broken out a new line. So our margin right content should render at the
                    // start of that new line.
                    if (
                        remainingWidth <
                        taskRowTitleInputMultilineAfterWidthRem * remPxRef.current
                    ) {
                        newMultilineState = {
                            remainingWidth: rootRect.width,
                            withoutMarginLeft: true,
                        };
                    } else {
                        newMultilineState = {
                            remainingWidth,
                            withoutMarginLeft: false,
                        };
                    }
                }

                // NOTE(calebmer): For performance, it's important we call
                // `setMultilineState()` instead of directly updating styles. This way React
                // batches DOM writes. So we batch DOM reads in `useLayoutEffect()` then batch
                // DOM writes with state updates. Otherwise we risk [layout thrashing][1].
                //
                // NOTE(calebmer): Unexpectedly, I've found calling `setState(state)` on the
                // first render if `state` is the same as the hook's initial state triggers a
                // React re-render. I would have expected React to noop calls that don't change
                // state. Maybe it behaves differently on the first render? Anyway, avoid
                // calling `setState(state)` on initial update if we can.
                //
                // [1]: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
                if (!isInitialUpdate || newMultilineState !== null) {
                    setMultilineState(multilineState => {
                        if (newMultilineState === null) return newMultilineState;
                        if (multilineState === null) return newMultilineState;

                        if (
                            multilineState.remainingWidth === newMultilineState.remainingWidth &&
                            multilineState.withoutMarginLeft === newMultilineState.withoutMarginLeft
                        ) {
                            return multilineState;
                        }

                        return newMultilineState;
                    });
                }
            };

            if (hasMultilineTitleAndShouldShowMarginRightContent) {
                // This reads from the DOM (`getBoundingClientRect`). We can't run this during
                // React's insertion phase. It has to run in a layout effect.
                onLayoutEffectCallbacksRef.current.push(() => {
                    if (view.isDestroyed) return;
                    updateMultilineState(true);
                });
            }

            // When the window resizes, re-evaluate state that depends on task
            // container size.
            const handleWindowResize = () => {
                updateFullyScrolledState(false);

                if (hasMultilineTitleAndShouldShowMarginRightContent) {
                    updateMultilineState(false);
                }
            };

            window.addEventListener("resize", handleWindowResize);

            let touchState: {
                finish: (event: TouchEvent) => void;
                cancel: () => void;
            } | null = null;

            // NOTE(calebmer): The logic here is taken almost exactly from
            // `<ContentEditor>` since that component supports dual modality on mobile
            // too. If you make a change here you probably also want to make a change
            // there and vice versa.
            view.dom.addEventListener("touchstart", event => {
                touchState?.cancel();
                touchState = null;

                // If we're not on mobile the document is always editable.
                if (!isDualModalityRef.current) return;

                // If our view already has focus, we don't need a tap to give it focus.
                if (view.hasFocus()) return;

                // Only support a single touch.
                if (event.touches.length !== 1) return;
                const touch = event.touches[0]!;

                // If there's a selection this tap dismisses the selection. It doesn't make the
                // editor editable.
                const selection = window.getSelection();
                const hasSelection =
                    selection &&
                    (selection.anchorNode !== selection.focusNode ||
                        selection.anchorOffset !== selection.focusOffset);
                if (hasSelection) return;

                // Long press touch starts dragging the task instead of editing. 0.5 seconds is
                // the long press duration we use since that's what iOS's default long press
                // duration is.
                // https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
                const longPressTimeout = createTimeout(() => {
                    touchState?.cancel();
                    touchState = null;
                }, 500);

                touchState = {
                    finish: event => {
                        longPressTimeout.clear();

                        const posResult = view.posAtCoords({
                            left: touch.clientX,
                            top: touch.clientY,
                        });
                        if (!posResult) return;

                        // By default, iOS will move the selection to the end of the word you touched.
                        // We instead want focus moved to the selection specified in our
                        // `setSelection()` call.
                        event.preventDefault();

                        // This may seem strange. Shouldn't `setIsFocused(true)` be set from an event
                        // handler after `focus()` is called? Well in this case our editor is not
                        // editable if we are in dual modality state and `isFocused` is false. When our
                        // editor is not editable it's also not focusable. So we need to set `isFocused`
                        // to true to be able to focus!
                        //
                        // We must call `focus()` during the `touchend` event since iOS won't open the
                        // software keyboard unless focus happens in a user-initiated event. So we call
                        // `flushSync()` to make sure `isFocused` is updated synchronously so we can
                        // call `focus()` synchronously.
                        flushSync(() => setIsFocused(true));
                        view.focus();

                        view.dispatch(
                            view.state.tr.setSelection(
                                new TextSelection(view.state.doc.resolve(posResult.pos)),
                            ),
                        );
                    },
                    cancel: () => {
                        longPressTimeout.clear();
                    },
                };
            });

            view.dom.addEventListener("touchmove", () => {
                // Touch move turns into a scroll or drag gesture.
                touchState?.cancel();
                touchState = null;
            });

            view.dom.addEventListener("touchend", event => {
                // If our tap state hasn't been cancelled we actually successfully received
                // a tap!
                touchState?.finish(event);
                touchState = null;
            });

            view.dom.addEventListener("touchcancel", () => {
                touchState?.cancel();
                touchState = null;
            });

            const handleSelectionChange = () => {
                // After a long press, iOS selects text. If we see the selection change during
                // a tap we no longer have a tap gesture and instead we have a long press
                // gesture.
                touchState?.cancel();
                touchState = null;
            };

            document.addEventListener("selectionchange", handleSelectionChange);

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
                window.removeEventListener("resize", handleWindowResize);
                document.addEventListener("selectionchange", handleSelectionChange);

                viewRef.current = {isReady: false, callbacks: new Set()};
                containerElement.removeChild(view.dom);

                // NOTE(calebmer): While profiling task grid view scrolling I've found
                // `view.destroy()` takes a meaningful chunk of blocking time. Since when
                // scrolling a virtualized list we're destroying the old components as well as
                // mounting new ones. So move view destruction off the render hot path. Using
                // the React scheduler so new renders from scroll can interrupt.
                if (scheduledDestroyTaskRowTitleInputEditorViewCallbacks === null) {
                    scheduledDestroyTaskRowTitleInputEditorViewCallbacks = [];
                    unstable_scheduleCallback(unstable_LowPriority, () => {
                        const callbacks = assertExists(
                            scheduledDestroyTaskRowTitleInputEditorViewCallbacks,
                        );
                        scheduledDestroyTaskRowTitleInputEditorViewCallbacks = null;

                        for (const callback of callbacks) {
                            callback();
                        }
                    });
                }

                scheduledDestroyTaskRowTitleInputEditorViewCallbacks.push(() => {
                    view.destroy();
                });
            };

            // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
            // careful about what you put in here. Ideally we never destroy the
            // `EditorView` while this component is mounted.
        },
        [
            capabilities.hasMultilineTitle,
            isInitialAppRender,
            titleYDoc,
            hasMultilineTitleAndShouldShowMarginRightContent,
        ],
    );

    const [isFocused, setIsFocused] = useState(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        assert(viewRef.current.isReady);
        const {view} = viewRef.current;

        const isEditable = (!isDualModality || isFocused) && !capabilities.isReadOnly;

        // Optimization: Don't update editor if editable state equals what we expect.
        // It'll be initialized to the correct value when constructed.
        if (view.editable === isEditable) return;

        view.setProps({
            editable: () => isEditable,

            // Copied from the `new EditorView()` call above. See `new EditorView()` for
            // documentation on why we set these attributes.
            attributes: {
                ...(isEditable ? {tabindex: "-1"} : {}),
                spellcheck: "false",
            },
        });

        if (!isEditable) {
            view.dom.classList.add(tasksStyles.rowTitleInputIsNotEditableClassName);
        } else {
            view.dom.classList.remove(tasksStyles.rowTitleInputIsNotEditableClassName);
        }
    }, [capabilities.isReadOnly, isDualModality, isFocused, isInitialAppRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        assert(viewRef.current.isReady);
        const {view} = viewRef.current;
        const viewElement = view.dom;

        const handleFocus = () => {
            setIsFocused(true);
        };

        const handleBlur = () => {
            setIsFocused(false);
        };

        if (document.activeElement === viewElement) {
            handleFocus();
        } else {
            handleBlur();
        }

        viewElement.addEventListener("focus", handleFocus);
        viewElement.addEventListener("blur", handleBlur);
        return () => {
            viewElement.addEventListener("focus", handleFocus);
            viewElement.addEventListener("blur", handleBlur);
        };
    }, [isInitialAppRender]);

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

    const {
        getSelection,
        getIsFocused,
        focusStart,
        focusEnd,
        focusAll,
        focusCoord,
        focusSelection,
        isEmpty,
        clear,
    } = useMemo(
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
            getIsFocused: () => {
                if (!viewRef.current.isReady) return false;
                return viewRef.current.view.dom === document.activeElement;
            },
            focusStart: () => {
                runWhenViewIsReady(view => {
                    const selection = Selection.atStart(view.state.doc);

                    // When in dual modality, the `isFocused` state must be true for the editor to
                    // be `contenteditable="true"` and thus focusable.
                    if (isDualModalityRef.current) {
                        flushSync(() => setIsFocused(true));
                    }

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
            focusEnd: () => {
                runWhenViewIsReady(view => {
                    const selection = Selection.atEnd(view.state.doc);

                    // When in dual modality, the `isFocused` state must be true for the editor to
                    // be `contenteditable="true"` and thus focusable.
                    if (isDualModalityRef.current) {
                        flushSync(() => setIsFocused(true));
                    }

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
            focusAll: () => {
                runWhenViewIsReady(view => {
                    const selection = new AllSelection(view.state.doc);

                    // When in dual modality, the `isFocused` state must be true for the editor to
                    // be `contenteditable="true"` and thus focusable.
                    if (isDualModalityRef.current) {
                        flushSync(() => setIsFocused(true));
                    }

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

                    // When in dual modality, the `isFocused` state must be true for the editor to
                    // be `contenteditable="true"` and thus focusable.
                    if (isDualModalityRef.current) {
                        flushSync(() => setIsFocused(true));
                    }

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
            focusSelection: (selection: Selection) => {
                runWhenViewIsReady(view => {
                    // When in dual modality, the `isFocused` state must be true for the editor to
                    // be `contenteditable="true"` and thus focusable.
                    if (isDualModalityRef.current) {
                        flushSync(() => setIsFocused(true));
                    }

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

                    // NOTE(calebmer): We need to focus the selection again after a turn of the
                    // event loop for it to stick. Otherwise I've seen the selection jump to the
                    // end. If I had to bet, I'd bet it has to do with [the Y.js ProseMirror][1]
                    // re-render timeout.
                    //
                    // [1]: https://github.com/yjs/y-prosemirror/blob/e0e5e951614abe1be2295e5ab8987ab5916bcaec/src/plugins/sync-plugin.js#L180-L184
                    setTimeout(() => {
                        if (selection.$from.doc !== view.state.doc) {
                            selection = selection.getBookmark().resolve(view.state.doc);
                        }

                        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                    }, 0);
                });
            },
            isEmpty: () => {
                return titleRef.current.getProsemirrorNode().childCount === 0;
            },
            clear: () => {
                runWhenViewIsReady(view => {
                    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
                });
            },
        }),
        [runWhenViewIsReady],
    );

    useImperativeHandle(ref, () => ({
        getSelection,
        isFocused: getIsFocused,
        focusStart,
        focusEnd,
        focusAll,
        focusCoord,
        focusSelection,
        isEmpty,
        clear,
    }));

    const taskNodeForInitialAppRender = isInitialAppRender ? title.getProsemirrorNode() : null;

    return (
        <div
            className={classNames(
                rootClassName,
                taskNodeForInitialAppRender &&
                    taskNodeForInitialAppRender.childCount === 0 &&
                    // We use a different class than `rowTitleInputEmptyContainerClassName` because
                    // we don't want React removing the class managed by `updateEditorEmptyClass()`.
                    tasksStyles.rowTitleInputInitialAppRenderEmptyContainerClassName,
            )}
        >
            <div
                className={classNames(
                    containerClassName,
                    !isFullyScrolledLeft &&
                        tasksStyles.rowTitleInputOverflowGradientLeftContainerClassName,
                    !isFullyScrolledRight &&
                        tasksStyles.rowTitleInputOverflowGradientRightContainerClassName,
                )}
                style={{
                    // Make sure margin right can never completely hide the input text.
                    minWidth: "1ch",
                }}
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
                        placeholderClassName,
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
                    marginRightContainerClassName,
                )}
                style={{
                    paddingRight,
                    // Margin right should collapse to 0 width when there's a long multiline title.
                    width: capabilities.hasMultilineTitle ? 0 : undefined,
                }}
                {...useOutOfBoundsClickSelection({
                    isDisabled: capabilities.isReadOnly,
                    onSelect: focusEnd,
                    onSelectAll: focusAll,
                })}
            >
                <div
                    className={classNames(
                        pointerEventsNoneNotInheritedClassName,
                        marginRightContentContainerClassName,
                    )}
                    style={{
                        // On server side render we won't have `multilineState` so don't render.
                        pointerEvents:
                            capabilities.hasMultilineTitle && isInitialAppRender
                                ? "none"
                                : undefined,
                        visibility:
                            capabilities.hasMultilineTitle && isInitialAppRender
                                ? "hidden"
                                : undefined,

                        paddingLeft:
                            capabilities.hasMultilineTitle && multilineState?.withoutMarginLeft
                                ? undefined
                                : shouldShowParentTaskTitle
                                ? spacing["1.5"]
                                : shouldShowChildTasksButton
                                ? spacing["3"]
                                : undefined,

                        // Two states to think about here:
                        //
                        // 1. `capabilities.hasMultilineTitle && !multilineState`: We share the same
                        //    line as task title since the task title is a single line. However, the
                        //    task title is taking more space than just it's text since it includes
                        //    some "after width". Reposition ourselves to render over the
                        //    after width.
                        //
                        // 2. `capabilities.hasMultilineTitle && multilineState`: We are in the
                        //    remaining space of the last line of some multiline task title. The
                        //    remaining space is saved in state. `flexShrink: "0"` so we don't shrink
                        //    to the parent's width of 0.
                        width: capabilities.hasMultilineTitle
                            ? multilineState
                                ? multilineState.remainingWidth
                                : `calc(100% + ${
                                      spacing[tasksStyles.taskRowTitleInputMultilineAfterWidth]
                                  })`
                            : undefined,
                        marginLeft: capabilities.hasMultilineTitle
                            ? multilineState
                                ? undefined
                                : `-${spacing[tasksStyles.taskRowTitleInputMultilineAfterWidth]}`
                            : undefined,
                        flexShrink:
                            capabilities.hasMultilineTitle && multilineState ? "0" : undefined,
                    }}
                >
                    {shouldShowParentTaskTitle && (
                        <TaskRowTitleParentTaskTitle
                            query={query}
                            parentTaskEntryStore={parentTaskEntryStore}
                        />
                    )}
                    {shouldShowChildTasksButton && (
                        <TaskRowTitleChildTasksButton
                            ref={childTasksButtonRef}
                            stateKey={stateKey}
                            task={task}
                            areChildTasksExpanded={areChildTasksExpanded}
                            onAreChildTasksExpandedToggle={onAreChildTasksExpandedToggle}
                            isMaxExpandedTaskDepth={indentation >= maxGridExpandableTaskDepth}
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
    query,
    parentTaskEntryStore,
}: {
    query: TaskClientQuery;
    parentTaskEntryStore: Store<TaskClientStoreTaskEntry>;
}) {
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

    const {currentAccount} = useSpaceContext();

    const access = useStore(
        useMemo(
            () => createTaskEntryAccessStore(currentAccount.id, query, parentTaskEntryStore),
            [currentAccount.id, parentTaskEntryStore, query],
        ),
    );

    const parentTaskEntry = useStore(parentTaskEntryStore);
    const parentTaskTitle = parentTaskEntry.task?.getTitle();

    return useMemo(() => {
        // If the parent task was deleted, don't show the deleted task's title.
        if (access.type === "Deleted") return null;

        return (
            <div className={parentTaskTitleClassName}>
                <CaretLeft size={spacing["3"]} className={parentTaskTitleIconClassName} />
                {access.type !== "PermissionGranted" ? (
                    <div className={parentTaskTitlePermissionDeniedClassName}>
                        <Lock size={spacing["3"]} className={parentTaskTitleIconClassName} />
                        <div className={parentTaskTitleTextClassName}>Private</div>
                    </div>
                ) : (
                    <div
                        className={parentTaskTitleTextClassName}
                        dangerouslySetInnerHTML={{
                            __html: serializeProsemirrorFragmentToHtml(
                                (
                                    parentTaskTitle?.getProsemirrorNode() ??
                                    emptyTaskTitleProsemirrorNode
                                ).content,
                            ),
                        }}
                    />
                )}
            </div>
        );
    }, [access.type, parentTaskTitle]);
}
