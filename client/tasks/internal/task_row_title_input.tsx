import {setInteractionModality} from "@react-aria/interactions";
import {useGlobalListeners} from "@react-aria/utils";
import classNames from "classnames";
import {CaretLeft, Lock} from "phosphor-react";
import {Fragment, Node, Schema as ProsemirrorSchema, Slice} from "prosemirror-model";
import {
    AllSelection,
    EditorState,
    Plugin,
    PluginKey,
    Selection,
    TextSelection,
} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {
    CSSProperties,
    Key,
    Memo,
    MutableRefObject,
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
import {parseContentFromClipboard} from "~/client/content/parse_content_from_clipboard.js";
import {findElementVerticalNavigationPosition} from "~/client/content/state/find_element_vertical_navigation_position.js";
import {buildSharedContentEditorInputRulesPlugin} from "~/client/content/state/shared/build_shared_content_editor_input_rules_plugin.js";
import {sharedContentEditorTrackSelectionWithinPlugin} from "~/client/content/state/shared/shared_content_editor_track_selection_within_plugin.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {
    getPlatformWithoutListening,
    useCanPrimaryInputHover,
} from "~/client/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    useSpacingScale,
} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    contentStyles,
    inputPlaceholderStyles,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
    tasksStyles,
} from "~/client/styles/styles.js";
import {
    taskGridViewColumnHeaderHeight,
    taskRowTitleInputPaddingYPx,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint} from "~/client/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientReadonlyStore,
    TaskClientStoreTaskEntry,
} from "~/client/tasks/core/task_client_store.js";
import {buildTaskTitleInputKeymapPlugin} from "~/client/tasks/internal/build_task_title_input_keymap_plugin.js";
import {createTaskEntryAccessStore} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {
    TaskRowTitleChildTasksButton,
    TaskRowTitleChildTasksButtonRef,
} from "~/client/tasks/internal/task_row_title_child_tasks_button.js";
import {TaskGridViewColumn} from "~/client/tasks/internal/task_row_view.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {contentBaseProsemirrorSchemaSpec} from "~/shared/content/content_schema.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {Platform} from "~/shared/design/core/platform.js";
import {
    RemLength,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
} from "~/shared/design/core/spacing.js";
import {
    SpacingScale,
    allSpacingScales,
    remPxBySpacingScale,
} from "~/shared/design/core/spacing_scale.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {
    TaskTitleModel,
    TaskTitleProsemirrorSchema,
    TaskTitleUpdateModel,
    emptyTaskTitleModel,
    emptyTaskTitleProsemirrorNode,
} from "~/shared/tasks/title/task_title.js";

const taskRowViewMinHeightRem = parseRemLength(taskRowViewMinHeight);

export type TaskRowTitleInputRef = {
    getSelection(): Selection;
    isFocused(): boolean;
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
    paddingLeft: tasksStyles.rowTitleInputSingleLineOverflowGradientMarginX,
    paddingRight: tasksStyles.rowTitleInputSingleLineOverflowGradientMarginX,
    maxWidth: "full",
    height: taskRowViewMinHeight,
    overflowY: "hidden",
    overflowX: "scroll",
    backgroundColor: "transparent",
    userSelect: "text",
})}`;

const taskRowTitleInputSingleLineMinWidth = `calc(1ch + ${addRemLengths(
    tasksStyles.rowTitleInputSingleLineOverflowGradientMarginX,
    tasksStyles.rowTitleInputSingleLineOverflowGradientMarginX,
)})`;

const taskRowTitleInputSingleLineStyle = createObjectFromKeys(
    allSpacingScales,
    (spacingScale): CSSProperties => ({
        ...contentStyles.paragraphFontSize,
        paddingTop: `${taskRowTitleInputPaddingYPx[spacingScale]}px`,
        paddingBottom: `${taskRowTitleInputPaddingYPx[spacingScale]}px`,
        // Make sure we have room to render the cursor.
        minWidth: taskRowTitleInputSingleLineMinWidth,
        // Turn off text wrapping. This component emulates a single-line input.
        // https://developer.mozilla.org/en-US/docs/Web/CSS/white-space
        whiteSpace: "pre",
        // `display: inline-block` creates an inline layout which adds extra space
        // below the element. Adding `vertical-align` stops the space from being added.
        // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
        verticalAlign: "top",
        // Render contextual alternate glyphs. User text may be rendered here. Helpful
        // for consistency if the user types anything like 2x2 or an @ mention.
        // eslint-disable-next-line string-quotes
        fontFeatureSettings: '"calt" on',
    }),
);

const taskRowTitleInputMultilineClassName = `ProseMirror ${sprinkles({
    // Use an `inline-block` display so the `<div>` width is equal to our content width.
    display: "inline-block",
    maxWidth: "full",
    minHeight: taskRowViewMinHeight,
    backgroundColor: "transparent",
    userSelect: "text",
})}`;

const taskRowTitleInputMultilineStyle = createObjectFromKeys(
    allSpacingScales,
    (spacingScale): CSSProperties => ({
        ...contentStyles.paragraphFontSize,
        paddingTop: `${taskRowTitleInputPaddingYPx[spacingScale]}px`,
        paddingBottom: `${taskRowTitleInputPaddingYPx[spacingScale]}px`,
        // Make sure we have room to render the cursor.
        minWidth: "1ch",
        // `display: inline-block` creates an inline layout which adds extra space
        // below the element. Adding `vertical-align` stops the space from being added.
        // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
        verticalAlign: "top",
        // Render contextual alternate glyphs. User text may be rendered here. Helpful
        // for consistency if the user types anything like 2x2 or an @ mention.
        // eslint-disable-next-line string-quotes
        fontFeatureSettings: '"calt" on',
    }),
);

const rootClassName = sprinkles({
    display: "flex",
    position: "relative",
    zIndex: "0",
});

const containerClassName = sprinkles({
    position: "relative",
    zIndex: "0",
    minHeight: taskRowViewMinHeight,
    color: "grey-100",
});

const containerStyles: CSSProperties = {
    // Make sure margin right can never completely hide the input text.
    minWidth: "1ch",
};

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

const taskRowTitleInputMultilineAfterWidthRem = parseRemLength(
    tasksStyles.rowTitleInputMultilineAfterWidth,
);

const marginRightContentContainerClassName = sprinkles({
    flexGrow: "1",
    display: "flex",
    alignItems: "center",
    gap: "3",
    height: taskRowViewMinHeight,
});

const parentTaskTitleClassName = sprinkles({
    pointerEvents: "none",
    color: "grey-50",
    display: "flex",
    alignItems: "center",
    gap: "0.5",
    maxWidth: "full",
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
    props: {
        capabilities: TaskGridViewCapabilities;
        hasEditAccessLevel: boolean;
        maxGridExpandableTaskDepth: number;
        stateKey: Key | undefined;
        store: TaskClientReadonlyStore;
        query: TaskClientQuery | null;
        isQueryManuallySorted: boolean;
        task: TaskModel | null;
        onTitleChange: (titleUpdate: TaskTitleUpdateModel) => void;
        placeholder?: string;
        indentation: number;
        paddingRight: RemLength | undefined;
        parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
        parentTaskEntryStore: Store<TaskClientStoreTaskEntry> | null;
        isGhostTask: boolean;
        isFirstRow: boolean;
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
        focusTaskTitleSelection: (gridKey: TaskGridViewTaskKey, selection: Selection) => void;
        focusCell: Memo<(column: TaskGridViewColumn) => void>;
        focusNextCell: Memo<(column: TaskGridViewColumn) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        getMoveTaskToQueryActions: (
            taskId: TaskId,
            position:
                | {type: "Start"}
                | {type: "End"}
                | {type: "Above"; taskId: TaskId}
                | {type: "Below"; taskId: TaskId},
        ) => Array<TaskActionModel>;
        getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskActionModel>;
        commitActionTransaction: (
            getActions:
                | ((taskId: TaskId) => Iterable<TaskActionModel>)
                | {
                      getBeforeMoveTaskActions: (taskId: TaskId) => Iterable<TaskActionModel>;
                      getAfterMoveTaskActions: (taskId: TaskId) => Iterable<TaskActionModel>;
                  },
        ) => void;
    },
    ref: Ref<TaskRowTitleInputRef>,
) {
    const {
        capabilities,
        hasEditAccessLevel,
        maxGridExpandableTaskDepth,
        stateKey,
        query,
        task,
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
        focusCell,
        focusNextCell,
        focusPreviousCell,
    } = props;

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
    const {isAppleDevice, timeZone} = useClientInfo();
    const spacingScale = useSpacingScale();
    const isInitialAppRender = useIsInitialAppRender();
    const {space, currentAccount} = useSpaceContext();

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
                    // the view. Matters for multi-line inputs.
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

                    // Navigating between cells changes the interaction modality to keyboard.
                    setInteractionModality("keyboard");

                    focusPreviousCell("Title");
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

                    // Navigating between cells changes the interaction modality to keyboard.
                    setInteractionModality("keyboard");

                    if ((task?.getChildTaskCount() ?? 0) > 0) {
                        const childTasksButton = assertExists(childTasksButtonRef.current);
                        if (childTasksButton.isFocusable()) {
                            childTasksButton.focus();
                        } else {
                            focusNextCell("Title");
                        }
                    } else {
                        focusNextCell("Title");
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

    const propsRef = useRef(props);
    const titleRef = useRef(title);
    const handleKeyDownRef = useRef(handleKeyDown);
    const timeZoneRef = useRef(timeZone);
    const spacingScaleRef = useRef(spacingScale);
    const isDualModalityRef = useRef(isDualModality);
    const spaceIdRef = useRef(space.id);
    const currentAccountIdRef = useRef(currentAccount?.id);
    useInsertionEffect(() => {
        propsRef.current = props;
        titleRef.current = title;
        handleKeyDownRef.current = handleKeyDown;
        timeZoneRef.current = timeZone;
        spacingScaleRef.current = spacingScale;
        isDualModalityRef.current = isDualModality;
        spaceIdRef.current = space.id;
        currentAccountIdRef.current = currentAccount?.id;
    });

    const onNextLayoutEffectCallbacksRef = useRef<Array<() => void>>([]);
    useLayoutEffectWithoutServerSideWarning(() => {
        const callbacks = onNextLayoutEffectCallbacksRef.current;
        onNextLayoutEffectCallbacksRef.current = [];

        for (const callback of callbacks) {
            callback();
        }
    });

    const updateTitleStateRef = useRef<{
        titleUpdate: TaskTitleUpdateModel;
        titleState: EditorState;
    } | null>(null);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const {addGlobalListener, removeAllGlobalListeners} = useGlobalListeners();

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
                ? taskRowTitleInputMultilineClassName
                : taskRowTitleInputSingleLineClassName;
            Object.assign(
                viewElement.style,
                capabilities.hasMultilineTitle
                    ? taskRowTitleInputMultilineStyle[spacingScale]
                    : taskRowTitleInputSingleLineStyle[spacingScale],
            );

            // Don't render a scrollbar with our row title input.
            viewElement.dataset.scrollbar = "false";

            const initialIsDualModality = isDualModalityRef.current;
            const initialHasEditAccessLevel = propsRef.current.hasEditAccessLevel;
            const initialIsEditable = !initialIsDualModality && initialHasEditAccessLevel;

            let lastPlatform: Platform | null = null;
            let lastSpacingScale: SpacingScale | null = null;
            let lastScrollMargin: {
                top: number;
                bottom: number;
                left: number;
                right: number;
            } | null = null;

            function getScrollMargin() {
                const platform = getPlatformWithoutListening();
                const spacingScale = getSpacingScaleWithoutListening();

                if (
                    lastScrollMargin !== null &&
                    lastPlatform === platform &&
                    lastSpacingScale === spacingScale
                ) {
                    return lastScrollMargin;
                }

                lastPlatform = platform;
                lastSpacingScale = spacingScale;

                const scrollMarginY =
                    taskRowTitleInputPaddingYPx[spacingScale] +
                    convertRemLengthToPx(spacing["4"], spacingScale);

                const scrollMarginTop =
                    scrollMarginY +
                    (platform === "mobile"
                        ? convertRemLengthToPx(navigationBarHeight, spacingScale)
                        : convertRemLengthToPx(
                              addRemLengths(navigationBarHeight, taskGridViewColumnHeaderHeight),
                              spacingScale,
                          ));

                const scrollMarginX = convertRemLengthToPx(
                    tasksStyles.rowTitleInputSingleLineOverflowGradientMarginX,
                    spacingScale,
                );

                lastScrollMargin = {
                    top: scrollMarginTop,
                    bottom: scrollMarginY,
                    left: scrollMarginX,
                    right: scrollMarginX,
                };

                return lastScrollMargin;
            }

            const view = new EditorView(
                {mount: viewElement},
                {
                    state: EditorState.create({
                        schema: TaskTitleProsemirrorSchema,
                        doc: titleRef.current.getProsemirrorNode(),
                        plugins: [
                            taskTitlePlugin(titleRef.current),

                            buildSharedContentEditorInputRulesPlugin(),
                            buildTaskTitleInputKeymapPlugin(),

                            // Our shared keymap commands use this plugin.
                            sharedContentEditorTrackSelectionWithinPlugin(),
                        ],
                    }),

                    get scrollThreshold() {
                        return getScrollMargin();
                    },
                    get scrollMargin() {
                        return getScrollMargin();
                    },

                    // We add this prop to `prosemirror-view` with a patch. With this prop when the
                    // editor is focused we place focus where the browser places focus. So if the
                    // user clicks into the editor focus goes to where the user clicked. Not to the
                    // selection currently in state.
                    shouldUseDOMSelectionOnFocus: true,

                    // Disable editing when the `hasEditAccessLevel` prop is false.
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
                        // In iOS, however, the native spellchecker is _essential_ for proper
                        // document editing. Since typos abound on mobile keyboards. Unlike on web, iOS
                        // spell check results show up inline instead of requiring a right click (which
                        // we override).
                        ...(!isMobileWebKit ? {spellcheck: "false"} : undefined),
                    },

                    handleKeyDown: (view, event) => {
                        handleKeyDownRef.current(view, event);
                        return event.defaultPrevented;
                    },

                    handleKeyPress: (view, event) => {
                        // NOTE(calebmer): Looks like mobile Safari doesn't respect when we call
                        // `event.preventDefault()` for the `Enter` `keydown` event but it will respect
                        // calling `event.preventDefault()` in `keypress`.
                        if (event.key === "Enter") {
                            event.preventDefault();
                        }

                        return event.defaultPrevented;
                    },

                    handleDOMEvents: {
                        paste: (view, event) => {
                            handleTaskRowTitleInputPaste(event, {
                                store: propsRef.current.store,
                                spaceId: spaceIdRef.current,
                                currentAccountId: assertExists(currentAccountIdRef.current),
                                timeZone: timeZoneRef.current,
                                isQueryManuallySorted: propsRef.current.isQueryManuallySorted,
                                parents: propsRef.current.parents,
                                isGhostTask: propsRef.current.isGhostTask,
                                isFirstRow: propsRef.current.isFirstRow,
                                titleState: view.state,
                                updateTitleStateRef,
                                focusTaskTitleSelection: propsRef.current.focusTaskTitleSelection,
                                getMoveTaskToQueryActions:
                                    propsRef.current.getMoveTaskToQueryActions,
                                getMaybeRemoveTaskFromQueryActions:
                                    propsRef.current.getMaybeRemoveTaskFromQueryActions,
                                commitActionTransaction: propsRef.current.commitActionTransaction,
                            });

                            return true;
                        },
                    },

                    dispatchTransaction: transaction => {
                        const oldTitleState = view.state;

                        if (!transaction.docChanged) {
                            const newTitleState = oldTitleState.apply(transaction);
                            view.updateState(newTitleState);
                            return;
                        }

                        const {update: titleUpdate, truncatedCharacterCount} =
                            titleRef.current.replaceManyWithStepWithTruncatedCharacterCount(
                                mapIterable(transaction.steps, step => {
                                    assert(step instanceof ReplaceStep);
                                    return step;
                                }),
                            );

                        // If the title was truncated through the model, we don't
                        // run this optimization. We force update the editor state below.
                        // See: updateTitleStateRef.current
                        // TODO: Ideally we'd create a new transaction based on oldTitleState
                        // with the updated steps instead of skipping this code completely.
                        if (truncatedCharacterCount === 0) {
                            const newTitleState = oldTitleState.apply(
                                transaction.setMeta(taskTitlePluginKey, titleUpdate.newTitle),
                            );

                            updateTitleStateRef.current = {
                                titleUpdate,
                                titleState: newTitleState,
                            };
                        }

                        // We must flush synchronously. Since ProseMirror preserves local DOM
                        // state when we call `updateState()` synchronously but won't otherwise.
                        //
                        // See the "Efficient updating" section in the [editor view guide][1].
                        // If we don't synchronously apply the transaction it is considered
                        // cancelled. A quote from the guide:
                        //
                        // > When such a transaction is canceled or modified somehow, the view
                        // > will undo the DOM change...
                        //
                        // [1]: https://prosemirror.net/docs/guide/#view
                        flushSync(() => {
                            propsRef.current.onTitleChange(titleUpdate);
                        });

                        updateTitleStateRef.current = null;
                    },
                },
            );

            if (!initialIsEditable) {
                view.dom.classList.add(tasksStyles.rowTitleInputIsNotEditableClassName);
            }

            // NOTE(calebmer): The logic here is taken almost exactly from
            // `<ContentEditor>` since that component supports dual modality on mobile
            // too. If you make a change here you probably also want to make a change
            // there and vice versa.
            let handleDocumentSelectionChange: () => void;
            {
                let touchState: {
                    finish: (event: TouchEvent) => void;
                    cancel: () => void;
                } | null = null;

                view.dom.addEventListener(
                    "touchstart",
                    event => {
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
                    },
                    {passive: true},
                );

                view.dom.addEventListener(
                    "touchmove",
                    () => {
                        // Touch move turns into a scroll or drag gesture.
                        touchState?.cancel();
                        touchState = null;
                    },
                    {passive: true},
                );

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

                handleDocumentSelectionChange = () => {
                    // After a long press, iOS selects text. If we see the selection change during
                    // a tap we no longer have a tap gesture and instead we have a long press
                    // gesture.
                    touchState?.cancel();
                    touchState = null;
                };

                document.addEventListener("selectionchange", handleDocumentSelectionChange);
            }

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
                document.removeEventListener("selectionchange", handleDocumentSelectionChange);

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
        [capabilities.hasMultilineTitle, isInitialAppRender, spacingScale],
    );

    // NOTE(calebmer): This used to be in the above `useInsertionEffect()` but we
    // saw bugs since we were destroying the `EditorView` whenever
    // `hasMultilineTitleAndShouldShowMarginRightContent` changes. See the
    // integration test added by this commit for an example bug that moving this
    // logic to its own effect fixes.
    useInsertionEffect(
        (rootElement?: HTMLDivElement) => {
            if (isInitialAppRender) return;
            if (!hasMultilineTitleAndShouldShowMarginRightContent) return;

            let isDestroyed = false;

            assert(rootElement);

            assert(viewRef.current.isReady);
            const {view} = viewRef.current;

            view.dom.classList.add(tasksStyles.rowTitleInputMultilineAfterClassName);

            const updateMultilineState = (isInitialUpdate: boolean) => {
                assert(!isDestroyed);

                const {state} = view;

                const rootRect = rootElement.getBoundingClientRect();
                let newMultilineState: TaskRowTitleInputMultilineState | null = null;

                const spacingScale = getSpacingScaleWithoutListening();
                const remPx = remPxBySpacingScale[spacingScale];

                if (
                    state.doc.nodeSize > 2 &&
                    // Make sure the input has more than one line...
                    rootRect.height > taskRowViewMinHeightRem * remPx
                ) {
                    const endCoords = view.coordsAtPos(state.doc.nodeSize - 2, 1);
                    const remainingWidth = rootRect.left + rootRect.width - endCoords.left;

                    // If there's less width than our "after width" that means our after class will
                    // have broken out a new line. So our margin right content should render at the
                    // start of that new line.
                    if (remainingWidth < taskRowTitleInputMultilineAfterWidthRem * remPx) {
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

            // This reads from the DOM (`getBoundingClientRect`). We can't run this during
            // React's insertion phase. It has to run in a layout effect.
            onNextLayoutEffectCallbacksRef.current.push(() => {
                if (view.isDestroyed) return;
                updateMultilineState(true);
            });

            // eslint-disable-next-line @typescript-eslint/unbound-method
            const originalUpdateState = view.updateState;

            // Modify `view.updateState()` to update multiline state whenever our editor
            // state changes.
            view.updateState = function (state: EditorState) {
                originalUpdateState.call(this, state);

                // Make sure React state updates render in the same paint as transaction.
                updateMultilineState(false);
            };

            // When the window resizes, re-evaluate state that depends on task
            // container size.
            const handleWindowResize = () => {
                updateMultilineState(false);
            };

            window.addEventListener("resize", handleWindowResize);

            return () => {
                isDestroyed = true;
                view.dom.classList.remove(tasksStyles.rowTitleInputMultilineAfterClassName);
                view.updateState = originalUpdateState;
                window.removeEventListener("resize", handleWindowResize);
            };
        },
        [hasMultilineTitleAndShouldShowMarginRightContent, isInitialAppRender],
    );

    // Reconcile our imperative `EditorView` state with state from React. If this
    // is run by `dispatchTransaction()` (which updates state in `flushSync()`)
    // then this should be flushed synchronously given this is a layout effect.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        assert(viewRef.current.isReady);
        const {view} = viewRef.current;
        const {state} = view;

        // Optimization: If the user is currently typing (in other words
        // `dispatchTransaction` is called) then `updateTitleStateRef.current` will be
        // populated with the new `EditorState` which'll have the correct selection.
        if (updateTitleStateRef.current?.titleUpdate.newTitle === title) {
            view.updateState(updateTitleStateRef.current.titleState);
            return;
        }

        if (title.getProsemirrorNode() === state.doc) return;

        const transaction = state.tr;

        // If something externally changes the title (e.g. another user in realtime or
        // an undo) then we completely replace the ProseMirror content with the new
        // content. Then manually move the selection to its new position.
        //
        // This is the same approach [`y-prosemirror` uses][1]. This approach has
        // [meaningful drawbacks][2]. Namely any decorations being maintained via
        // `decorationSet.map()` will be wiped away by the full replace. We don't have
        // any decorations on this editor currently so it's not an issue for us right
        // now.
        //
        // It should be possible to compute a precise text diff between `oldTitle` and
        // the new `title` using the Yjs CRDT structure. Then call
        // `transaction.replace()` just for the changed text ranges. This would
        // preserve anything that needs to be `map()`ed along by ProseMirror (like
        // decorations for some plugins). However, such an algorithm would be
        // challenging to write so we copy the dumb `y-prosemirror` strategy for now.
        //
        // [1]: https://github.com/yjs/y-prosemirror/blob/15a3862640d4a0d02eae8cbf895f4c9927413a9e/src/plugins/sync-plugin.js#L567-L571
        // [2]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488
        transaction.replace(
            0,
            state.doc.content.size,
            new Slice(Fragment.from(title.getProsemirrorNode()), 0, 0),
        );

        // Move the selection to a new position using Yjs relative positions.
        // The Yjs CRDT contains enough information to map positions on its own without
        // needing the intermediate updates.
        //
        // TODO(calebmer): If this title update is from an undo ideally we'd reset the
        // selection to whatever it was before the undo. This is the standard
        // convention for text editors. Not implementing for now because wiring all the
        // pieces up through the task undo system is annoying.
        {
            const oldTitle = assertExists(taskTitlePluginKey.getState(view.state));

            const anchor = title.fromRelativePosition(
                oldTitle.intoRelativePosition(state.selection.anchor),
            );
            const head = title.fromRelativePosition(
                oldTitle.intoRelativePosition(state.selection.head),
            );

            if (state.selection instanceof AllSelection) {
                transaction.setSelection(new AllSelection(transaction.doc));
            } else if (anchor !== null && head !== null) {
                transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
            }
        }

        transaction.setMeta(taskTitlePluginKey, title);

        view.updateState(state.apply(transaction));
    }, [isInitialAppRender, title]);

    const [isFocused, setIsFocused] = useState(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        assert(viewRef.current.isReady);
        const {view} = viewRef.current;

        const isEditable = (!isDualModality || isFocused) && hasEditAccessLevel;

        // Optimization: Don't update editor if editable state equals what we expect.
        // It'll be initialized to the correct value when constructed.
        if (view.editable === isEditable) return;

        view.setProps({
            editable: () => isEditable,

            // Copied from the `new EditorView()` call above. See `new EditorView()` for
            // documentation on why we set these attributes.
            attributes: {
                ...(isEditable ? {tabindex: "-1"} : {}),
                ...(!isMobileWebKit ? {spellcheck: "false"} : undefined),
            },
        });

        if (!isEditable) {
            view.dom.classList.add(tasksStyles.rowTitleInputIsNotEditableClassName);
        } else {
            view.dom.classList.remove(tasksStyles.rowTitleInputIsNotEditableClassName);
        }
    }, [hasEditAccessLevel, isDualModality, isFocused, isInitialAppRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        assert(viewRef.current.isReady);
        const {view} = viewRef.current;
        const viewElement = view.dom;

        const handleFocus = () => {
            setIsFocused(true);
        };

        const handleBlur = () => {
            // If `<TaskRowTitleInput>` is focused when `view.destroy()` is called then
            // `handleBlur` will be called in a `useInsertionEffect()` cleanup which will
            // cause React to log a warning. So don't change state if the view is
            // destroyed.
            if (!viewRef.current.isReady || viewRef.current.view !== view) return;

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
            viewElement.removeEventListener("focus", handleFocus);
            viewElement.removeEventListener("blur", handleBlur);
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
                if (!propsRef.current.hasEditAccessLevel) {
                    focusCell("Title");
                    return;
                }

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
                if (!propsRef.current.hasEditAccessLevel) {
                    focusCell("Title");
                    return;
                }

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
                if (!propsRef.current.hasEditAccessLevel) {
                    focusCell("Title");
                    return;
                }

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
                if (!propsRef.current.hasEditAccessLevel) {
                    focusCell("Title");
                    return;
                }

                runWhenViewIsReady(view => {
                    const position = findElementVerticalNavigationPosition(side, view.dom, coord);

                    const selection =
                        position === null
                            ? Selection.atStart(view.state.doc)
                            : new TextSelection(
                                  view.state.doc.resolve(
                                      view.posAtDOM(position.node, position.offset),
                                  ),
                              );

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
                if (!propsRef.current.hasEditAccessLevel) {
                    focusCell("Title");
                    return;
                }

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
        [focusCell, runWhenViewIsReady],
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

    const titleNodeForInitialAppRender = isInitialAppRender ? title.getProsemirrorNode() : null;

    return (
        <div
            className={classNames(
                rootClassName,
                title.getProsemirrorNode().childCount === 0 &&
                    tasksStyles.rowTitleInputEmptyContainerClassName,
            )}
        >
            <div
                className={classNames(
                    containerClassName,
                    !capabilities.hasMultilineTitle &&
                        tasksStyles.rowTitleInputSingleLineOverflowGradientContainerClassName,
                )}
                style={containerStyles}
                onBlur={() => {
                    runWhenViewIsReady(view => {
                        // Reset scroll position when focus leaves the input.
                        view.dom.scrollLeft = 0;
                    });
                }}
            >
                {titleNodeForInitialAppRender && (
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
                                ? taskRowTitleInputMultilineStyle[spacingScale]
                                : taskRowTitleInputSingleLineStyle[spacingScale]
                        }
                        data-scrollbar="false"
                        aria-label={taskRowTitleInputAriaLabel}
                        aria-placeholder={placeholder}
                        // See why we set this attribute on `EditorView`.
                        tabIndex={-1}
                        dangerouslySetInnerHTML={{
                            __html: serializeProsemirrorFragmentToHtml(
                                titleNodeForInitialAppRender.content,
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
                            ? taskRowTitleInputMultilineStyle[spacingScale]
                            : taskRowTitleInputSingleLineStyle[spacingScale]),
                        ...inputPlaceholderStyles,
                    }}
                >
                    {placeholder}
                </div>
            )}
            <div
                className={classNames(
                    hasEditAccessLevel ? tasksStyles.textCursorNotInheritedClassName : undefined,
                    marginRightContainerClassName,
                )}
                style={{
                    paddingRight,
                    // Margin right should collapse to 0 width when there's a long multiline title.
                    width: capabilities.hasMultilineTitle ? 0 : undefined,
                }}
                {...useOutOfBoundsClickSelection({
                    isDisabled: capabilities.isReadOnly,
                    onSelect: event => {
                        focusEnd();

                        if (!("pointerType" in event)) return;
                        if (event.pointerType !== "mouse") return;

                        // If the user clicks in the out of bounds area and starts dragging we manually
                        // implement updating the selection with their drag. Since the browser won't do
                        // it for us given we're manually focusing the input.
                        //
                        // We don't do this for all out of bounds areas since it's intuitive that other
                        // out of bounds areas might not be editable. We want to create the illusion of
                        // editability on hover but it's ok if drag to select doesn't work since the
                        // user will typically drag to select on actual text.
                        //
                        // However, the area to the right of the task title users definitely expect to
                        // be an editable area! So we need to respect their drag to select assumptions.
                        addGlobalListener(document, "pointermove", event => {
                            if (viewRef.current.isReady === false) return;

                            const {view} = viewRef.current;

                            // Selection must be at the end of the doc.
                            if (view.state.selection.anchor < view.state.doc.nodeSize - 2) return;

                            const result = view.posAtCoords({
                                left: event.clientX,
                                top: event.clientY,
                            });

                            let newHead: number;

                            if (result !== null) {
                                newHead = result.pos;
                            } else {
                                const viewRect = view.dom.getBoundingClientRect();

                                if (
                                    event.clientY <= viewRect.top ||
                                    event.clientX <= viewRect.left
                                ) {
                                    newHead = 0;
                                } else {
                                    newHead = view.state.selection.anchor;
                                }
                            }

                            if (newHead !== view.state.selection.head) {
                                view.dispatch(
                                    view.state.tr.setSelection(
                                        new TextSelection(
                                            view.state.selection.$anchor,
                                            view.state.doc.resolve(newHead),
                                        ),
                                    ),
                                );
                            }
                        });

                        addGlobalListener(document, "pointerup", removeAllGlobalListeners);
                        addGlobalListener(document, "pointercancel", removeAllGlobalListeners);
                        addGlobalListener(document, "dragstart", removeAllGlobalListeners);
                    },
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
                                      spacing[tasksStyles.rowTitleInputMultilineAfterWidth]
                                  })`
                            : undefined,
                        marginLeft: capabilities.hasMultilineTitle
                            ? multilineState
                                ? undefined
                                : `-${spacing[tasksStyles.rowTitleInputMultilineAfterWidth]}`
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

                                        focusNextCell("Title");
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

const taskTitlePluginKey = new PluginKey<TaskTitleModel>("taskTitle");

function taskTitlePlugin(initialTaskTitle: TaskTitleModel) {
    return new Plugin<TaskTitleModel>({
        key: taskTitlePluginKey,
        state: {
            init: () => initialTaskTitle,
            apply: (transaction, oldTitle) => {
                const newTitle: TaskTitleModel | undefined =
                    transaction.getMeta(taskTitlePluginKey);
                if (newTitle) {
                    return newTitle;
                }

                return oldTitle;
            },
        },
    });
}

function TaskRowTitleParentTaskTitle({
    query,
    parentTaskEntryStore,
}: {
    query: TaskClientQuery | null;
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
            () =>
                createTaskEntryAccessStore(
                    currentAccount?.id,
                    // If `query` is null then we'll only ever render a ghost task. Ghost tasks
                    // should never have a parent task.
                    assertExists(query),
                    parentTaskEntryStore,
                ),
            [currentAccount?.id, parentTaskEntryStore, query],
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

// Copied from ProseMirror:
// https://github.com/ProseMirror/prosemirror-view/blob/7e97ca8b735cd5a38c126fb9b7cfa95201c05e31/src/input.ts#L635-L640
function getClipboardDataText(clipboardData: DataTransfer) {
    const text = clipboardData.getData("text/plain") || clipboardData.getData("Text");
    if (text) return text;
    const uris = clipboardData.getData("text/uri-list");
    return uris ? uris.replace(/\r?\n/g, " ") : "";
}

function handleTaskRowTitleInputPaste(
    event: ClipboardEvent,
    {
        store,
        spaceId,
        currentAccountId,
        timeZone,
        isQueryManuallySorted,
        parents,
        isGhostTask,
        isFirstRow,
        titleState,
        updateTitleStateRef,
        focusTaskTitleSelection,
        getMoveTaskToQueryActions,
        getMaybeRemoveTaskFromQueryActions,
        commitActionTransaction,
    }: {
        store: TaskClientReadonlyStore;
        spaceId: SpaceId;
        currentAccountId: AccountId;
        timeZone: TimeZone;
        isQueryManuallySorted: boolean;
        parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
        isGhostTask: boolean;
        isFirstRow: boolean;
        titleState: EditorState;
        updateTitleStateRef: MutableRefObject<{
            titleUpdate: TaskTitleUpdateModel;
            titleState: EditorState;
        } | null>;
        focusTaskTitleSelection: (gridKey: TaskGridViewTaskKey, selection: Selection) => void;
        getMoveTaskToQueryActions: (
            taskId: TaskId,
            position:
                | {type: "Start"}
                | {type: "End"}
                | {type: "Above"; taskId: TaskId}
                | {type: "Below"; taskId: TaskId},
        ) => Array<TaskActionModel>;
        getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskActionModel>;
        commitActionTransaction: (
            getActions:
                | ((taskId: TaskId) => Iterable<TaskActionModel>)
                | {
                      getBeforeMoveTaskActions: (taskId: TaskId) => Iterable<TaskActionModel>;
                      getAfterMoveTaskActions: (taskId: TaskId) => Iterable<TaskActionModel>;
                  },
        ) => void;
    },
) {
    event.preventDefault();

    const schema = new ProsemirrorSchema({
        nodes: {
            doc: contentBaseProsemirrorSchemaSpec.nodes.doc,
            text: contentBaseProsemirrorSchemaSpec.nodes.text,
            paragraph: contentBaseProsemirrorSchemaSpec.nodes.paragraph,
            unorderedListItem: contentBaseProsemirrorSchemaSpec.nodes.unorderedListItem,
            orderedListItem: contentBaseProsemirrorSchemaSpec.nodes.orderedListItem,
        },
    });

    // Parse the pasted data using a custom ProseMirror content schema that can
    // only parse paragraphs and list items. If we see indented list items we want
    // to convert them into subtasks.
    const slice =
        parseContentFromClipboard(
            spaceId,
            schema,
            null,
            event.clipboardData ? getClipboardDataText(event.clipboardData) : "",
            event.clipboardData?.getData("text/html") ?? null,
            false,
        ) ?? Slice.empty;

    type PastedTask = {
        title: string;
        childTasks: Array<PastedTask>;
    };

    const pastedTasks: Array<PastedTask> = [];

    const doesNodeHaveText = (node: Node): boolean => {
        for (const childNode of node.content.content) {
            if (childNode.isText) {
                return childNode.nodeSize > 0;
            } else if (doesNodeHaveText(childNode)) {
                return true;
            }
        }
        return false;
    };

    for (const node of slice?.content.content ?? []) {
        // Ignore empty nodes or non-text nodes (e.g. files and dividers).
        if (!doesNodeHaveText(node)) continue;

        const pastedTask: PastedTask = {
            title: printContentSingleLineTextSnippet(schema.node("doc", {}, [node]), {
                // The `schema` object we create above and use to parse `node` doesn't contain
                // `mention` nodes. So we expect these functions to never be called. Throw an
                // error to make that assumption clear.
                getAccountIfExists: () => {
                    throw new UnimplementedError("Should be unreachable");
                },
                getSearchEntityIfExists: () => {
                    throw new UnimplementedError("Should be unreachable");
                },
                getFileIfExists: () => {
                    throw new UnimplementedError("Should be unreachable");
                },
            }),
            childTasks: [],
        };

        const indentation: number = node.type.groups.includes("listItem")
            ? node.attrs.indent ?? 0
            : 0;
        let pastedParentChildTasks = pastedTasks;

        for (let i = 0; i < indentation; i++) {
            if (pastedParentChildTasks.length === 0) {
                break;
            } else {
                pastedParentChildTasks =
                    pastedParentChildTasks[pastedParentChildTasks.length - 1]!.childTasks;
            }
        }

        pastedParentChildTasks.push(pastedTask);
    }

    if (pastedTasks.length === 0) return;

    // Pasting a bullet list of tasks to create each task individually only makes
    // sense in a manually sorted query. We don't have control of task order in an
    // auto-sorted query.
    //
    // As a fallback, merge all pasted task titles together and paste them into the
    // current task title.
    //
    // TODO(calebmer): Eventually we want to support pasting multiple tasks in an
    // auto-sorted query too. We just need some "temporary floating task" state to
    // make this work.
    if (!isQueryManuallySorted) {
        let combinedTitle = "";

        const loop = (pastedTasks: Array<PastedTask>) => {
            for (const pastedTask of pastedTasks) {
                combinedTitle += pastedTask.title;
                loop(pastedTask.childTasks);
            }
        };

        loop(pastedTasks);

        const titleUpdate = assertExists(taskTitlePluginKey.getState(titleState)).replace(
            titleState.selection.from,
            titleState.selection.to,
            combinedTitle,
        );

        const transaction = titleState.tr.replace(
            titleState.selection.from,
            titleState.selection.to,
            new Slice(Fragment.from(TaskTitleProsemirrorSchema.text(combinedTitle)), 0, 0),
        );

        // Set the selection to the end of the pasted content.
        transaction.setSelection(
            TextSelection.near(
                transaction.doc.resolve(titleState.selection.from + combinedTitle.length),
            ),
        );

        const newTitleState = titleState.apply(transaction);

        updateTitleStateRef.current = {
            titleUpdate,
            titleState: newTitleState,
        };

        flushSync(() => {
            commitActionTransaction(taskId => [
                {
                    type: "UpdateTask",
                    time: store.clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                        // Don't allow merging title text updates that happen after the paste. So users
                        // don't accidentally undo an entire paste when they wanted to only undo some
                        // text they typed.
                        withoutUndoMerge: true,
                    },
                },
            ]);
        });

        updateTitleStateRef.current = null;
        return;
    }

    indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint();

    updateTitleStateRef.current = null;

    let focusTaskTitleSelectionAfterCommit: {
        gridKey: TaskGridViewTaskKey;
        selection: Selection;
    } | null = null;

    const getActions = (lastPastedTaskId: TaskId) => {
        const actions: Array<TaskActionModel> = [];

        const loop = (
            pastedParentTaskIds: ReadonlyArray<TaskId>,
            pastedParentTaskId: TaskId | null,
            isParentLastPastedTask: boolean,
            pastedTasks: Array<PastedTask>,
        ) => {
            for (let i = 0; i < pastedTasks.length; i++) {
                const pastedTask = pastedTasks[i]!;
                const isLastPastedTask =
                    isParentLastPastedTask &&
                    i === pastedTasks.length - 1 &&
                    pastedTask.childTasks.length === 0;

                const pastedTaskId: TaskId = isLastPastedTask ? lastPastedTaskId : generateId();

                if (!isLastPastedTask) {
                    actions.push({
                        type: "UpdateTask",
                        time: store.clock.now(),
                        taskId: pastedTaskId,
                        taskAction: {
                            type: "Create",
                            creatorId: currentAccountId,
                            creatorTimeZone: timeZone,
                        },
                    });

                    // If this task doesn't have a parent then we need to add it to the query so
                    // it'll show up right where the user pasted.
                    if (pastedParentTaskId === null) {
                        for (const action of getMoveTaskToQueryActions(
                            pastedTaskId,
                            isGhostTask
                                ? {type: isFirstRow ? "Start" : "End"}
                                : {type: "Above", taskId: lastPastedTaskId},
                        )) {
                            actions.push(action);
                        }
                    }
                }

                if (pastedParentTaskId !== null) {
                    // If this is the last pasted task and it's being made the child of another
                    // pasted task then let's remove it from the query so it doesn't show up as both
                    // a child and a task in the query.
                    if (isLastPastedTask) {
                        for (const action of getMaybeRemoveTaskFromQueryActions(pastedTaskId)) {
                            actions.push(action);
                        }
                    }

                    actions.push({
                        type: "UpdateTask",
                        time: store.clock.now(),
                        taskId: pastedTaskId,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: pastedParentTaskId,
                        },
                    });
                }

                // Don't allow merging title text updates that happen after the paste. So users
                // don't accidentally undo an entire paste when they wanted to only undo some
                // text they typed.
                const withoutUndoMerge = true;

                if (!isLastPastedTask) {
                    actions.push({
                        type: "UpdateTask",
                        time: store.clock.now(),
                        taskId: pastedTaskId,
                        taskAction: {
                            type: "UpdateTitle",
                            titleUpdate: emptyTaskTitleModel.get().replace(0, 0, pastedTask.title),
                            withoutUndoMerge,
                        },
                    });
                }
                // If this is the last pasted task then generate a `titleUpdate` that replaces
                // text in the last task at the current selection.
                else {
                    const {update: titleUpdate, truncatedCharacterCount: truncatedCharacters} =
                        assertExists(
                            taskTitlePluginKey.getState(titleState),
                        ).replaceManyWithStepWithTruncatedCharacterCount([
                            {
                                from: titleState.selection.from,
                                to: titleState.selection.to,
                                text: pastedTask.title,
                            },
                        ]);

                    const pastedTaskTitle = pastedTask.title.substring(
                        0,
                        pastedTask.title.length - truncatedCharacters,
                    );

                    if (pastedTaskTitle.length > 0) {
                        const transaction = titleState.tr.replace(
                            titleState.selection.from,
                            titleState.selection.to,
                            new Slice(
                                Fragment.from(TaskTitleProsemirrorSchema.text(pastedTaskTitle)),
                                0,
                                0,
                            ),
                        );

                        // Set the selection to the end of the pasted content.
                        transaction.setSelection(
                            TextSelection.near(
                                transaction.doc.resolve(
                                    titleState.selection.from + pastedTaskTitle.length,
                                ),
                            ),
                        );

                        const newTitleState = titleState.apply(transaction);

                        updateTitleStateRef.current = {
                            titleUpdate,
                            titleState: newTitleState,
                        };

                        actions.push({
                            type: "UpdateTask",
                            time: store.clock.now(),
                            taskId: pastedTaskId,
                            taskAction: {
                                type: "UpdateTitle",
                                titleUpdate,
                                withoutUndoMerge,
                            },
                        });

                        // If the task used to have no parents but after the paste will be indented then
                        // we need to manually move focus into the new `<TaskRowView>` component since
                        // child tasks have a key prefixed by their root parent task.
                        if (parents.length === 0 && pastedParentTaskIds.length > 0) {
                            focusTaskTitleSelectionAfterCommit = {
                                gridKey: `${pastedParentTaskIds[0]!}-${pastedTaskId}`,
                                selection: transaction.selection,
                            };
                        }
                    }
                }

                loop(
                    [...pastedParentTaskIds, pastedTaskId],
                    pastedTaskId,
                    isParentLastPastedTask && i === pastedTasks.length - 1,
                    pastedTask.childTasks,
                );
            }
        };

        loop(emptyArray, null, true, pastedTasks);

        return actions;
    };

    // Synchronous flush to make sure `updateTitleStateRef` is used before it's
    // reset to null at the end of this function.
    flushSync(() => {
        commitActionTransaction({
            getBeforeMoveTaskActions: getActions,
            getAfterMoveTaskActions: () => emptyArray,
        });
    });

    updateTitleStateRef.current = null;

    if (focusTaskTitleSelectionAfterCommit !== null) {
        const {gridKey, selection} = focusTaskTitleSelectionAfterCommit;
        focusTaskTitleSelection(gridKey, selection);
    }
}
