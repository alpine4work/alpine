import classNames from "classnames";
import {history, redoDepth, undoDepth} from "prosemirror-history";
import {Node, Slice} from "prosemirror-model";
import {
    AllSelection,
    Command,
    EditorState,
    PluginKey,
    Selection,
    TextSelection,
    Transaction,
} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    FocusEvent,
    PropsWithoutRef,
    ReactElement,
    Ref,
    RefAttributes,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {
    ContentEditorState,
    getContentEditorFloaterState,
    setContentEditorFloaterState,
} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {createContentEditorCheckListItemNodeView} from "~/client/content/internal/content_editor_check_list_item_node_view.js";
import {ContentEditorCodeBlockLanguagePickerComboBox} from "~/client/content/internal/content_editor_code_block_language_picker_combo_box.js";
import {createContentEditorCodeBlockNodeViewConstructor} from "~/client/content/internal/content_editor_code_block_node_view.js";
import {createContentEditorCommentMarkViewConstructor} from "~/client/content/internal/content_editor_comment_mark_view.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {ContentEditorFloater} from "~/client/content/internal/content_editor_floater.js";
import {createContentEditorLinkMarkViewConstructor} from "~/client/content/internal/content_editor_link_mark_view.js";
import {createContentEditorMentionNodeViewConstructor} from "~/client/content/internal/content_editor_mention_node_view.js";
import {ContentEditorMobileCommentInputBottomBar} from "~/client/content/internal/content_editor_mobile_comment_input_bottom_bar.js";
import {ContentEditorMobileKeyboardToolbar} from "~/client/content/internal/content_editor_mobile_keyboard_toolbar.js";
import {
    ContentEditorMobileLinkModal,
    ContentEditorMobileLinkModalState,
} from "~/client/content/internal/content_editor_mobile_link_modal.js";
import {createContentEditorOrderedListItemNodeView} from "~/client/content/internal/content_editor_ordered_list_item_node_view.js";
import {ContentEditorPhantomSelectionCursor} from "~/client/content/internal/content_editor_phantom_selection_cursor.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {dispatchParentScrollWhenPointerDownAndOverEvent} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {useContentEditorDebugTools} from "~/client/content/internal/use_content_editor_debug_tools.js";
import {useAppContextIfExists} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {
    MobileFullScreenModal,
    useIsBehindMobileFullScreenModal,
} from "~/client/design/mobile_full_screen_modal.js";
import {
    dispatchTriggeredOverlayCloseEvent,
    dispatchTriggeredOverlayOpenEvent,
} from "~/client/design/overlay_trigger_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {Tooltip, TooltipRef} from "~/client/design/tooltip.js";
import {textInputVisibilityMaintainerMarginYRem} from "~/client/design/use_text_input_visibility_maintainer.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isVirtualKeyboardEvent} from "~/client/helpers/events/is_virtual_keyboard_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContextIfExists} from "~/client/spaces/space_context.js";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {Id, generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {colorSchemeVars, contentEditorStyles, contentSchemaStyles} from "~/shared/styles/styles.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

const {
    docClassName,
    emptyBodyClassName,
    emptyTitleClassName,
    linkClassName,
    commentClassName,
    phantomSelectionClassName,
    emojiClassName,
    withMobileLayoutDocClassName,
    compactDocClassName,
    extraCompactDocClassName,
    parentScrollWhenPointerDownAndOverReceiverClassName,
    codeBlockToolbarClassName,
} = contentSchemaStyles;

const {
    containerClassName,
    shiftKeyOrAltKeyDownClassName,
    inlineMentionInputClassName,
    canNotPrimaryInputHoverContainerClassName,
} = contentEditorStyles;

// TODO(calebmer, #mobile-webkit-weirdness): Safari doesn't support
// `ascent-override` and `descent-override` which means our phantom selection
// or comment highlights an emoji the top looks ragged instead of straight.
// https://bugs.webkit.org/show_bug.cgi?id=219735

// TODO(calebmer): We set `spellcheck="false"` but if you tap on a word that
// Safari would have put a red squiggle under then replacement words appear.
// This is confusing to users since it's unclear why this list would appear.
// `autocorrect="false"` turns this off but it also turns off typing correction
// which we don't want.
// https://stackoverflow.com/questions/78022279/ios-safari-when-contenteditable-true-and-spellcheck-false-clicking-on-a-word-tha
//
// After much debugging I've narrowed the issue down to
// `UITextInputTraits.autocorrectionType`. If I manually set
// `UITextInputTraits.autocorrectionType = .no` (with swizzling, see
// `swizzleWKWebView()`) it turns off both predictive input on the keyboard and
// the tap to show corrections behavior I don't like. So looks like these two
// behaviors are tied together in Apple's private text input code. Unfortunate.
// https://developer.apple.com/documentation/uikit/uitextinputtraits/1624453-autocorrectiontype
//
// I know it should be possible to get the behavior I want since Google Docs
// has figured it out. (Though I don't think they use `WKWebView`.)
//
// Arguably this behavior is good and should be left in. I don't think so since
// users may accidentally click on a word that makes sense to them and get this
// menu which could be frustrating. Long term we also plan on implementing our
// own spell checking. So the conflicting spell checking is unfortunate.

function wrap<Content extends ContentWithReferences>(
    state: EditorState,
): ContentEditorState<Content> {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return new ContentEditorState(state);
}

function unwrap(
    state: ContentEditorState<ContentWithReferences>,
): EditorState & {schema: ContentProsemirrorSchema} {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return state._state;
}

const historyPluginKey = new Lazy((): PluginKey => {
    const plugin = history();
    return (plugin as any).key;
});

export type ContentEditorRef<Content extends ContentWithReferences> = {
    getState(): ContentEditorState<Content>;
    isFocused(): boolean;
    focus(options?: FocusOptions): void;
    blur(): void;

    /**
     * Does the editor contain the provided element? Only checks for children of
     * the `contenteditable` editor. Doesn't check siblings of the editor.
     */
    contains(element: Element): boolean;

    /**
     * Select all content in the editor.
     */
    selectAll(): void;

    /**
     * Get the coordinates of the provided position. Directly calls
     * [`EditorView.coordsAtPos()`][1].
     *
     * [1]: https://prosemirror.net/docs/ref/#view.EditorView.coordsAtPos
     */
    coordsAtPos(pos: number): {left: number; right: number; top: number; bottom: number};

    /**
     * Execute a ProseMirror command against this editor.
     */
    dispatchCommand(command: Command): void;

    /**
     * If we're in a mobile environment and `withoutMobileKeyboardToolbar` is false
     * then calling this function opens the comment input for the current
     * selection. If the selection is empty nothing happens.
     */
    openMobileKeyboardToolbarCommentInputIfPossible(): void;

    /**
     * Get the internal ProseMirror editor view object. Prefer the public methods
     * on this ref that provide a constrained, safe, interface. But this escape
     * hatch is available if necessary.
     */
    _getInternalView(): EditorView;
};

const ContentEditorForwardRef = forwardRef(ContentEditorWrapper) as <
    Content extends ContentWithReferences,
>(
    props: PropsWithoutRef<ContentEditorProps<Content>> & RefAttributes<ContentEditorRef<Content>>,
) => ReactElement;
export {ContentEditorForwardRef as ContentEditor};

export type ContentEditorProps<Content extends ContentWithReferences> = {
    /**
     * Whether the content editor should use a mobile layout without actually being
     * on a mobile device. This is true for some peeks on desktop.
     *
     * Not all mobile behaviors are enabled by this flag. For instance, mobile
     * keyboard toolbars are reserved for mobile devices. You still get floaters if
     * `withMobileLayout` is true on desktop.
     */
    withMobileLayout: boolean;

    /**
     * Should this content be rendered with our compact rendering? Compact
     * rendering reduces some margins so content can be closer together.
     */
    isCompact?: boolean;

    /**
     * Should this content be rendered with our extra compact render? Extra compact
     * rendering implies `isCompact` and decreases the paragraph font size.
     */
    isExtraCompact?: boolean;

    /**
     * The current state of our content editor.
     *
     * Mostly the content editor state is a wrapper around ProseMirror's immutable
     * `EditorState` with some type safety and helper functions.
     */
    state: ContentEditorState<Content>;

    /**
     * Fired whenever the content editor's state changes.
     *
     * Every state change will be optimistically synchronously applied to the
     * DOM. If you don't re-render with the new state then that optimistic
     * update will be reverted.
     */
    onChange: (
        state: ContentEditorState<Content>,
        // We send the transaction on change in case the parent wants to respond
        // to some specific action taken in the transaction.
        transaction: Transaction,
    ) => void;

    /**
     * Fired when the user presses enter in a content editor.
     *
     * Providing an `onEnterFromPhysicalKeyboard` callback will prevent the default
     * enter behavior. It will also switch our editor out of multiline mode for
     * assistive technologies.
     *
     * Pressing shift+enter has the same behavior as pressing enter as a
     * workaround. Pressing alt+enter will insert a hard line break and won't
     * trigger this callback. Pasting in content with multiple paragraphs also
     * allows you to add multiple lines. So providing `onEnterFromPhysicalKeyboard`
     * doesn't make our editor fully single lined.
     */
    onEnterFromPhysicalKeyboard?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user press cmd-enter (or ctrl-enter on non MacOS platforms)
     * in a content editor.
     *
     * Providing an `onModEnter` callback will prevent the default enter behavior.
     */
    onModEnter?: (event: KeyboardEvent) => void;

    /**
     * Placeholder text to render in the editor when there is no other content.
     */
    placeholder?: string;

    /**
     * The class name we'll apply to the content editable `<div>`.
     */
    className?: string;

    /**
     * The class name we'll apply to the `<div>` containing the content editable
     * `<div>`. We need a container `<div>` (unfortunately) to have an element to
     * mount ProseMirror editor within given the ProseMirror editor is not a React
     * component.
     */
    containerClassName?: string;

    /**
     * Don't render the mobile keyboard toolbar with this content editor. Use this
     * if you render your own toolbar outside the `<ContentEditor>`.
     * `<MessageInput>` is a component that does this.
     */
    withoutMobileKeyboardToolbar?: boolean;

    /**
     * Disable dual modality editing on devices that don't have a primary input
     * that can hover (our mobile apps). The content editor will always be in our
     * mobile editing state and never our mobile interactive state. e.g. So links
     * won't be pressable.
     */
    withoutMobileDualModality?: boolean;

    /**
     * Event fired when the user focuses the content editor.
     */
    onFocus?: (event: FocusEvent<HTMLDivElement>) => void;

    /**
     * Event fired when the user focuses the content editor.
     */
    onFocusCapture?: (event: FocusEvent<HTMLDivElement>) => void;

    /**
     * Event fired when the user unfocuses the content editor.
     */
    onBlur?: (event: FocusEvent<HTMLDivElement>) => void;

    /**
     * Fired when the user presses the escape key.
     */
    onEscape?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user presses the up arrow key.
     */
    onArrowUp?: (event: KeyboardEvent) => void;

    /**
     * Phantom text selections decorations that render on top of the editor and
     * represent the cursor position of other users.
     */
    phantomSelections?: ReadonlyArray<ContentEditorPhantomSelection>;

    /**
     * Opens a comment thread when clicked. If your schema supports comment marks
     * you must provide this function to open them. `<ContentEditor>` knows almost
     * nothing about how comments are implemented, only how they are styled.
     */
    openCommentThread?: (commentThreadId: DocumentCommentThreadId) => Promise<void>;

    /**
     * When a pointer presses down on a comment thread this function is called.
     * `openCommentThread` is called when a press is considered a click. (So
     * pointer up and the pointer hasn't moved off.) Our parent component is
     * responsible for updating the styles of all marks for this comment thread
     * using `commentActiveDynamicCssTemplate`.
     */
    onCommentThreadPressedChange?: (
        commentThreadId: DocumentCommentThreadId,
        isHovered: boolean,
    ) => void;

    /**
     * Called when an undo stack entry is added. If you're managing undo/redo
     * keyboard shortcuts you'll need to push to our own stack when this is called.
     */
    onUndoStackEntryPushed?: () => void;

    /**
     * Called when an undo stack entry is added during a redo command. This needs
     * to behave a bit differently than `onUndoStackEntryPushed()` since it
     * shouldn't reset the redo stack.
     *
     * If you're managing undo/redo keyboard shortcuts you'll need to push to our
     * own stack when this is called.
     */
    onUndoStackEntryPushedFromRedo?: () => void;

    /**
     * Called when a redo stack entry is added. If you're managing undo/redo
     * keyboard shortcuts you'll need to push to our own stack when this is called.
     */
    onRedoStackEntryPushed?: () => void;
} & (
    | {
          /**
           * A label exposed to assistive technology (through `aria-label`) when
           * there is no visible label for the element.
           */
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          /**
           * A reference to another element (through `aria-labelledby`) with a
           * visible label for this element.
           */
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
);

export type ContentEditorPhantomSelection = {
    readonly key: string;
    readonly color: ThemeColor;
    readonly anchor: number;
    readonly head: number;
    readonly isTextSelection: boolean;
};

// When server-side rendering (initial app render), we render as a
// `<ContentView>` then once React hydrates on the client we switch out the
// non-editable `<ContentView>` for an editable `<ContentEditor>` component.
function ContentEditorWrapper<Content extends ContentWithReferences>(
    props: ContentEditorProps<Content>,
    ref: Ref<ContentEditorRef<Content>>,
) {
    const isInitialAppRender = useIsInitialAppRender();

    // Preload space accounts so when the user tries to mention one they
    // are available.
    //
    // Only preload space accounts outside of Jest unit tests! That way we don't
    // depend on space context in unit tests.
    if (!import.meta.jest) {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useExpensivelyPreloadAllSpaceAccounts();
    }

    if (isInitialAppRender) {
        return <ContentEditorInitialAppRender {...props} editorRef={ref} />;
    } else {
        return <ContentEditor {...props} editorRef={ref} />;
    }
}

function ContentEditorInitialAppRender<Content extends ContentWithReferences>({
    withMobileLayout,
    isCompact,
    isExtraCompact,
    state,
    placeholder,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    containerClassName: customContainerClassName,
    editorRef,
}: ContentEditorProps<Content> & {editorRef: Ref<ContentEditorRef<Content>>}) {
    useImperativeHandle(
        editorRef,
        () => ({
            getState: () => state,
            isFocused: () => false,
            focus: () => {
                throw new UnimplementedError(
                    "Focusing content editor on initial render is not implemented",
                );
            },
            blur: () => {
                // Nothing to blur
            },
            contains: () => {
                throw new UnimplementedError(
                    "Content editor contains on initial render is not implemented",
                );
            },
            selectAll: () => {
                throw new UnimplementedError(
                    "Selecting all text in content editor on initial render is not implemented",
                );
            },
            coordsAtPos: () => {
                throw new UnimplementedError(
                    "Getting coordinates for position in content editor on initial render is not implemented",
                );
            },
            dispatchCommand: () => {
                throw new UnimplementedError(
                    "Dispatching a content editor command on initial render is not implemented",
                );
            },
            openMobileKeyboardToolbarCommentInputIfPossible: () => {
                throw new UnimplementedError(
                    "Opening the content editor's mobile keyboard toolbar comment input on initial render is not implemented",
                );
            },
            _getInternalView: () => {
                throw new UnimplementedError(
                    "Getting internal ProseMirror view on initial render is not implemented",
                );
            },
        }),
        [state],
    );

    return (
        <div className={classNames(containerClassName, customContainerClassName)}>
            <ContentView
                isEditorInitialAppRender={true}
                withMobileLayout={withMobileLayout}
                isCompact={isCompact}
                isExtraCompact={isExtraCompact}
                content={state.getContent()}
                placeholder={placeholder}
                className={className}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                // Highlight all comments on initial render of `<ContentEditor>` since we'll
                // highlight them all when we re-render.
                shouldHighlightComment={useCallback(() => true, [])}
            />
        </div>
    );
}

/**
 * A rich text collaborative editor powered by [ProseMirror][1].
 *
 * ProseMirror fits well with the React component model as its state is fully
 * immutable. This means we can fully manage the state in React as we would with
 * any other component.
 *
 * [1]: https://prosemirror.net
 */
function ContentEditor<Content extends ContentWithReferences>(
    props: ContentEditorProps<Content> & {editorRef: Ref<ContentEditorRef<Content>>},
) {
    const {
        editorRef,
        state,
        placeholder,
        className,
        containerClassName: customContainerClassName,
        withMobileLayout: withMobileLayoutProp = false,
        isCompact = false,
        isExtraCompact = false,
        withoutMobileKeyboardToolbar,
        withoutMobileDualModality,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        onFocus,
        onFocusCapture,
        onBlur,
        phantomSelections,
    } = props;

    const context = useAppContextIfExists();
    const navigate = useNavigate();
    const reporter = useReporter();
    const isMobile = useIsMobile();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;
    const withMobileLayout = isMobile || withMobileLayoutProp;

    // We choose our interaction mode based on whether the device's primary input
    // can hover. This is true on a laptop (e.g. MacOS) and false on a phone (e.g.
    // iOS). Haven't tested this with an iPad. Ideally it's true when a hardware
    // trackpad is connected and false when it's not.
    //
    // The difference between `isMobile` and `isDualModality` can be a bit
    // confusing.
    //
    // - On desktop, `isDualModality` is always false. `isMobile` will be true if
    //   the window is small but usually will be false (since we don't recommend
    //   small windows on desktop).
    //
    // - On an iPhone, document content editors are `isMobile = true` and
    //   `isDualModality = true`. However, message inputs are `isMobile = true` and
    //   `isDualModality = false`. Message inputs disable dual modality editing
    //   with `withoutMobileDualModality = true`.
    //
    // - This isn't implemented yet but on an iPad we should have
    //   `isMobile = false` (since it's big enough for our desktop screen size) and
    //   should have `isDualModality = true` if there's no hardware keyboard but
    //   `isDualModality = false` if there is a hardware keyboard. If the user is
    //   primarily using the iPad via touch it should behave more like an iPhone
    //   than a laptop.
    const isDualModality = !canPrimaryInputHover && !withoutMobileDualModality;

    // The props for the current React commit. We are integrating with a stateful
    // component (ProseMirror's `EditorView`) so we need to be able to
    // imperatively access props.
    //
    // Importantly, we set this in a `useInsertionEffect` instead of render! If we
    // set in render and concurrent React cancels/rebases/retries the render then
    // there may be bugs.
    //
    // Please avoid using `propsRef` unless you can thoroughly reason through why
    // it's safe!
    const propsRef = useRef(props);
    const isMobileRef = useRef(isMobile);
    const withMobileLayoutRef = useRef(withMobileLayout);
    const canPrimaryInputHoverRef = useRef(canPrimaryInputHover);
    const isDualModalityRef = useRef(isDualModality);
    const navigateRef = useRef(navigate);
    const reporterRef = useRef(reporter);
    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    const spaceContext = useSpaceContextIfExists();
    const spaceContextRef = useRef(spaceContext);
    useInsertionEffect(() => {
        propsRef.current = props;
        isMobileRef.current = isMobile;
        withMobileLayoutRef.current = withMobileLayout;
        canPrimaryInputHoverRef.current = canPrimaryInputHover;
        isDualModalityRef.current = isDualModality;
        navigateRef.current = navigate;
        reporterRef.current = reporter;
        spaceContextRef.current = spaceContext;
    });

    const viewRef = useRef<EditorView | null>(null);

    useImperativeHandle(
        editorRef,
        () => ({
            getState: () => {
                return propsRef.current.state;
            },
            isFocused: () => {
                const view = assertExists(viewRef.current);
                return document.activeElement === view.dom;
            },
            focus: (options?: FocusOptions) => {
                // If we're in dual modality mode then we need to set our focused state before
                // the editor is focusable at all.
                //
                // This is a little strange. See the same line of code in our `touchstart`
                // handler (around `touchState`'s `finish` function) for a more thorough
                // explanation of what's happening here.
                if (isDualModalityRef.current) {
                    flushSync(() => setIsFocused(true));
                }

                const view = assertExists(viewRef.current);
                (view.dom as HTMLDivElement).focus(options);
            },
            blur: () => {
                const view = assertExists(viewRef.current);
                (view.dom as HTMLDivElement).blur();
            },
            contains: element => {
                const view = assertExists(viewRef.current);
                return view.dom.contains(element);
            },
            selectAll: () => {
                const view = assertExists(viewRef.current);
                view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
            },
            coordsAtPos: pos => {
                const view = assertExists(viewRef.current);
                return view.coordsAtPos(pos);
            },
            dispatchCommand: command => {
                const view = assertExists(viewRef.current);
                command(view.state, view.dispatch.bind(view), view);
            },
            openMobileKeyboardToolbarCommentInputIfPossible: () => {
                const view = assertExists(viewRef.current);

                if (
                    view.state.schema.marks.comment &&
                    view.state.selection.from !== view.state.selection.to
                ) {
                    setIsMobileCommentInputOpen(true);
                }
            },
            _getInternalView: () => {
                return assertExists(viewRef.current);
            },
        }),
        [],
    );

    const [isFocused, setIsFocused] = useState(false);

    const [
        {lastOptimisticTransactionTime, lastSelectionChangeTransactionTime},
        setTransactionTimes,
    ] = useState<{
        lastOptimisticTransactionTime: number | null;
        lastSelectionChangeTransactionTime: number | null;
    }>({
        lastOptimisticTransactionTime: null,
        lastSelectionChangeTransactionTime: null,
    });

    const onStateChange = (
        oldState: EditorState,
        newState: EditorState,
        transaction: Transaction | null,
    ) => {
        // Report any added undo/redo stack entries...
        if (propsRef.current.onUndoStackEntryPushed || propsRef.current.onRedoStackEntryPushed) {
            // Deriving this logic from here:
            // https://github.com/ProseMirror/prosemirror-history/blob/40d274a74d0fc0787aeca03634a64d0c78f18a50/src/history.ts#L270-L276
            const isRedo = transaction?.getMeta(historyPluginKey.get())?.redo;

            const oldUndoDepth = undoDepth(oldState);
            const newUndoDepth = undoDepth(newState);

            const oldRedoDepth = redoDepth(oldState);
            const newRedoDepth = redoDepth(newState);

            if (oldUndoDepth < newUndoDepth) {
                for (let i = oldUndoDepth; i < newUndoDepth; i++) {
                    if (isRedo) {
                        propsRef.current.onUndoStackEntryPushedFromRedo?.();
                    } else {
                        propsRef.current.onUndoStackEntryPushed?.();
                    }
                }
            }

            if (oldRedoDepth < newRedoDepth) {
                for (let i = oldRedoDepth; i < newRedoDepth; i++) {
                    propsRef.current.onRedoStackEntryPushed?.();
                }
            }
        }
    };

    // Huh? `useInsertionEffect()`? That's a React hook? Ok, [it is][1] but the
    // docs say only CSS-in-JS libraries should use it.
    //
    // Wait what?? A `rootElement` parameter??? That's not documented? What the what?
    //
    // Read the documentation comment on `<TaskRowTitleInput>`. This is how we
    // render the non-React ProseMirror `EditorView`. It's essential for
    // performance on `<TaskRowTitleInput>`, it's not essential for performance
    // here. But we use this pattern everywhere we render an `EditorView` for
    // consistency and since we believe this is the proper way to manually mutate
    // the DOM in React.
    useInsertionEffect((rootElement?: HTMLDivElement) => {
        assert(rootElement);

        const initialState = unwrap(propsRef.current.state);
        const schema = initialState.doc.type.schema;

        const initialIsDualModality = isDualModalityRef.current;

        let lastRemPx: number | null = null;
        let lastScrollMargin: {top: number; left: number; right: number; bottom: number} | null =
            null;

        const getScrollMargin = () => {
            const remPx = getRemPxWithoutListening();

            if (lastScrollMargin !== null && lastRemPx === remPx) return lastScrollMargin;

            const scrollMarginPx = textInputVisibilityMaintainerMarginYRem * remPx;

            lastRemPx = remPx;

            lastScrollMargin = {
                top: scrollMarginPx,
                left:
                    scrollMarginPx +
                    // This is the base width of code block line numbers. When scrolling left, to
                    // make sure the selection is visible we should scroll past line numbers which
                    // cover up content.
                    convertRemLengthToPx(
                        subtractRemLengths(
                            addRemLengths(
                                spacing[contentSchemaStyles.listItemIndentation],
                                spacing[contentSchemaStyles.blockPaddingX],
                            ),
                            propsRef.current.isCompact || propsRef.current.isExtraCompact
                                ? spacing[contentSchemaStyles.compactListItemOffset]
                                : spacing["0"],
                        ),
                        remPx,
                    ),
                right: scrollMarginPx,
                bottom: scrollMarginPx,
            };

            return lastScrollMargin;
        };

        const view = new EditorView(rootElement, {
            state: initialState,

            // On mobile devices we implement dual interaction modality. Before any
            // interaction the content is read-only. Tapping on links follows the link
            // instead of editing the content. Tapping on text switches to an editing
            // modality where tapping on a link instead edits the text.
            editable: () => !initialIsDualModality,

            attributes: {
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
                //
                // NOTE(calebmer, 2022-12-29): Someday in the future we should build our own
                // spellchecker.
                //
                // NOTE(calebmer, 2023-02-19): Re-enabling this is now even harder now that we
                // have custom right-click menus. On desktop you right click to see the correct
                // spellings. But if we have our own right-click menu we can't show the correct
                // spellings there so we only show a permanent red squiggle which is bad. I
                // think the best answer here is to build our own spellchecker eventually.
                ...(!isMobileWebKit ? {spellcheck: "false"} : undefined),
            },

            get scrollThreshold() {
                return getScrollMargin();
            },
            get scrollMargin() {
                return getScrollMargin();
            },

            domParser: ContentEditorDomParser.fromSchema(schema),
            clipboardSerializer:
                ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                    schema,
                    () => assertExists(spaceContextRef.current).space.id,
                    () => propsRef.current.state.getContent().references,
                ),
            clipboardTextSerializer: slice =>
                contentEditorTextClipboardSerializer(
                    slice,
                    () => assertExists(spaceContextRef.current).space.id,
                    () => propsRef.current.state.getContent().references,
                ),

            // IMPORTANT: If you have a custom view in `nodeViews` here you should also
            // have a matching custom renderer in `nodeRenderers` in
            // `renderContentToHtml()`.
            nodeViews: {
                orderedListItem: createContentEditorOrderedListItemNodeView,
                checkListItem: createContentEditorCheckListItemNodeView,
                codeBlock: createContentEditorCodeBlockNodeViewConstructor({
                    getReporter: () => reporterRef.current,
                    onCodeBlockLanguagePickerOpen: ({targetElement, languageId, getPos}) =>
                        setCodeBlockLanguagePickerState({
                            key: generateId(),
                            targetElement,
                            languageId,
                            getPos,
                            isVisible: true,
                        }),
                    onCodeBlockCopyButtonHoverStart: targetElement =>
                        setCodeBlockCopyButtonTooltipState({
                            key: generateId(),
                            targetElement,
                            wasPressed: false,
                        }),
                    onCodeBlockCopyButtonHoverEnd: () => {
                        // We intentionally do not remove our tooltip state when the hover ends. Since
                        // we need to wait until the tooltip fades out on its own.
                    },
                    onCodeBlockCopyButtonPress: targetElement => {
                        codeBlockCopyButtonTooltipRef.current?.skipTooltipHoverDelayAndAnimation();

                        setCodeBlockCopyButtonTooltipState(state =>
                            state?.targetElement === targetElement && !state?.wasPressed
                                ? {...state, wasPressed: true}
                                : state,
                        );
                    },
                }),
                mention: createContentEditorMentionNodeViewConstructor({
                    getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                    getCurrentAccountIfExists: () =>
                        spaceContextRef.current?.currentAccount ?? null,
                }),
            },

            // IMPORTANT: If you have a custom view in `markViews` here you should also
            // have a matching custom renderer in `markRenderers` in
            // `renderContentToHtml()`.
            markViews: {
                link: createContentEditorLinkMarkViewConstructor({
                    canPrimaryInputHover: () => canPrimaryInputHoverRef.current,

                    onPointerEnterAfterDelay: ({mark, range, wasPointerDown}) => {
                        // We don't want to open floaters on mobile.
                        if (isMobileRef.current) return;

                        // Don't open the pointer link floater if the pointer was down when it entered
                        // the link. Since the user is probably trying to drag to select some text.
                        if (wasPointerDown) return;

                        const floaterState = getContentEditorFloaterState(view.state);

                        // Don't open pointer link preview if the current floater is a comment
                        // input floater.
                        if (floaterState.type !== "CommentInput") {
                            view.dispatch(
                                setContentEditorFloaterState(view.state.tr, {
                                    type: "PointerLink",
                                    key: generateId(),
                                    mark,
                                    range,
                                    hasPointerLeftMark: false,
                                }),
                            );
                        }
                    },
                    onPointerEnter: mark => {
                        const floaterState = getContentEditorFloaterState(view.state);

                        if (floaterState.type === "PointerLink" && floaterState.mark.eq(mark)) {
                            view.dispatch(
                                setContentEditorFloaterState(view.state.tr, {
                                    ...floaterState,
                                    hasPointerLeftMark: false,
                                }),
                            );
                        }
                    },
                    onPointerLeave: mark => {
                        const floaterState = getContentEditorFloaterState(view.state);

                        if (floaterState.type === "PointerLink" && floaterState.mark.eq(mark)) {
                            view.dispatch(
                                setContentEditorFloaterState(view.state.tr, {
                                    ...floaterState,
                                    hasPointerLeftMark: true,
                                }),
                            );
                        }
                    },
                    onNavigate: to => navigateRef.current(to),
                }),

                // We don't have a `<ContentView>` implementation of this yet. Unclear how we
                // should support comments in `<ContentView>` at this moment.
                comment: createContentEditorCommentMarkViewConstructor({
                    withMobileLayout: () => withMobileLayoutRef.current,
                    canPrimaryInputHover: () => canPrimaryInputHoverRef.current,

                    openCommentThread: async commentThreadId => {
                        await propsRef.current.openCommentThread?.(commentThreadId);
                    },
                    onCommentThreadPressedChange: (commentThreadId, isHovered) => {
                        propsRef.current.onCommentThreadPressedChange?.(commentThreadId, isHovered);
                    },
                }),
            },

            handlePaste,

            handleKeyDown: (_view, event) => {
                const {isAppleDevice} = getClientInfoWithoutListening();

                // Implement keyboard shortcuts when the mention floater is open:
                const floaterState = getContentEditorFloaterState(view.state);
                if (floaterState.type === "Mention") {
                    floaterState.handleKeyDownRef.current?.(event);
                    if (event.defaultPrevented) return true;
                }

                if (
                    typeof propsRef.current.onModEnter === "function" &&
                    event.key === "Enter" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    // Cmd+Enter triggers this on MacOS and Ctrl+Enter triggers this elsewhere
                    (isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    propsRef.current.onModEnter(event);
                    if (event.defaultPrevented) return true;
                }

                if (
                    typeof propsRef.current.onEnterFromPhysicalKeyboard === "function" &&
                    event.key === "Enter" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    // Ctrl+Enter on non-MacOS platforms should trigger the callback
                    (!isAppleDevice || !event.ctrlKey) &&
                    // Cmd+Enter on MacOS platforms should trigger the callback
                    (isAppleDevice || !event.metaKey) &&
                    // On a physical keyboard where the user has access to Shift+Enter we sometimes
                    // want enter to send the message or otherwise save what's being edited. On a
                    // virtual, mobile, keyboard (like the iOS touchscreen keyboard) we want enter
                    // to insert a newline and have the user submit their message with a
                    // button press.
                    !isVirtualKeyboardEvent(event)
                ) {
                    propsRef.current.onEnterFromPhysicalKeyboard(event);
                    if (event.defaultPrevented) return true;
                }

                if (typeof propsRef.current.onEscape === "function" && event.key === "Escape") {
                    propsRef.current.onEscape(event);
                    if (event.defaultPrevented) return true;
                }

                if (typeof propsRef.current.onArrowUp === "function" && event.key === "ArrowUp") {
                    propsRef.current.onArrowUp(event);
                    if (event.defaultPrevented) return true;
                }

                return false;
            },

            handleDrop: (_view, event, slice) => {
                // Handle the user dropping files from their operating system. Not dragging
                // some slice of ProseMirror content around.
                if (
                    context !== null &&
                    spaceContext !== null &&
                    slice.size === 0 &&
                    event.dataTransfer &&
                    event.dataTransfer.files.length > 0
                ) {
                    // TODO(calebmer, #files): Proper implementation. This is a quick and dirty
                    // implementation for testing.
                    if (process.env.NODE_ENV === "development") {
                        runPromiseWithoutAwaiting(
                            runAllPromises(
                                Array.from(event.dataTransfer.items, async item => {
                                    if (item.kind !== "file") return;

                                    const file = assertExists(item.getAsFile());

                                    await fetchWithTracer(
                                        context.tracer.getTracer(),
                                        `/api/files/${spaceContext.space.id}/upload`,
                                        {
                                            serviceName: "FileUploadService",
                                            method: "POST",
                                            route: "/api/files/:spaceId/upload",
                                            headers: {
                                                // TODO(calebmer, #files): Validate content type. If
                                                // content type is unsupported we shouldn't prevent
                                                // default.
                                                "content-type": item.type,
                                                "content-length": String(file.size),
                                            },
                                            body: file,
                                        },
                                        async response => {
                                            // TODO(calebmer, #files): Parse incoming events.
                                            // eslint-disable-next-line no-console
                                            console.log(await response.text());

                                            if (!response.ok) {
                                                throw new InternalError("Upload failed");
                                            }
                                        },
                                    );
                                }),
                            ),
                        );
                    }

                    return true;
                }

                return false;
            },

            // We add this property to `EditorView` with a patch. By default, on
            // triple-click ProseMirror selects the node being clicked and calls
            // `event.preventDefault()`. Calling `event.preventDefault()` stops the
            // selection from moving when the user drags their mouse in Chrome. The native
            // triple-click selection behavior in Chrome works well. Since we want the
            // selection to keep moving as the user drags, turn off the default
            // ProseMirror behavior.
            //
            // For some node types we may need the ProseMirror behavior in the future.
            shouldDefaultTripleClickNotPreventDefault: () => true,

            dispatchTransaction(transaction) {
                const oldState = view.state;

                // By default, applying a transaction will clear the editor's stored
                // marks. We don't want that behavior! Instead we want to preserve stored marks
                // until a user either explicitly toggles them off or moves their selection
                // somewhere else in the document.
                const shouldResetStoredMarks = !transaction.docChanged && transaction.selectionSet;
                if (
                    !shouldResetStoredMarks &&
                    oldState.storedMarks &&
                    !transaction.storedMarksSet
                ) {
                    transaction.setStoredMarks(oldState.storedMarks);
                }

                const newState = oldState.apply(transaction);

                const shouldRunWithImmediatePriority =
                    // Run the update immediately if the content is going into an empty state so we
                    // can render the placeholders in the same frame.
                    isContentTitleEmpty(newState.doc) || isContentBodyEmpty(newState.doc);

                // Always call the change handler through a ref. By using a ref we can avoid
                // destroying and recreating an editor when the function changes.
                if (!shouldRunWithImmediatePriority) {
                    propsRef.current.onChange(wrap(newState), transaction);
                } else {
                    runWithImmediatePriority(() => {
                        propsRef.current.onChange(wrap(newState), transaction);
                    });
                }

                // Optimistically apply the next transaction to our editor view.
                // ProseMirror preserves local DOM state when we call `updateState()`
                // synchronously.
                //
                // See the "Efficient updating" section in the [editor view guide][1].
                // If we don't synchronously apply the transaction it is considered
                // cancelled. A quote from the guide:
                //
                // > When such a transaction is canceled or modified somehow, the view
                // > will undo the DOM change...
                //
                // We update the `lastOptimisticTransactionTime` state to re-run an effect
                // below which reconciles the editor view state with the state we get from
                // props. That way if our optimistic update is wrong we'll fix it when
                // React commits.
                //
                // [1]: https://prosemirror.net/docs/guide/#view
                view.updateState(newState);
                updateEditorEmptyClass(newState);
                onStateChange(oldState, newState, transaction);

                setTransactionTimes(transactionTimes => ({
                    lastOptimisticTransactionTime: transaction.time,
                    lastSelectionChangeTransactionTime: !oldState.selection.eq(newState.selection)
                        ? transaction.time
                        : transactionTimes.lastSelectionChangeTransactionTime,
                }));
            },
        });

        if (isMobileWebKit) {
            // NOTE(calebmer, #mobile-webkit-weirdness): This is a fix for what I consider
            // to be a Safari bug. In iOS the selection highlight and caret color is
            // controlled by the `caret-color` CSS property. On desktop the caret color
            // defaults to the current text color. On iOS the caret color defaults to
            // `WKWebView`'s `tintColor` property. On desktop, we want the caret color to
            // be `grey-100` even while in a link so the cursor color doesn't change as the
            // user moves it across different styles. So we set `caret-color` to `grey-100`
            // in `content_schema.css.ts`. However on iOS we want the caret/selection color
            // to be `WKWebView`'s `tintColor`. The problem is:
            //
            // 1. Setting [`caret-color: initial` in WebKit also sets the stored caret
            //    color (which initially is null) to the current text color][1]
            // 2. If the `WKWebView`'s `tintColor` is specifically `UIColor.systemBlue`
            //    (the default `tintColor`) [WebKit uses the stored caret color][2] if it's
            //    not null instead of `tintColor`
            //
            // 1 seems like the correct behavior on MacOS Safari but on iOS Safari when we
            // set `caret-color: initial` we want `WKWebView`'s `tintColor` even if it's
            // `UIColor.systemBlue`. Not the text color which is black. This seems like a
            // bug in iOS Safari but it's easy to workaround by manually setting caret
            // color back to `UIColor.systemBlue`.
            //
            // This will override `WKWebView`'s custom `tintColor` if `tintColor` not
            // system blue so we have to be a little careful. In our native mobile app we
            // set a non-system blue `tintColor` so we need to set `caret-color: initial`
            // when running in our native mobile app shell.
            //
            // [1]: https://github.com/WebKit/WebKit/blob/ccd45357bd2ad7e46bbf93b899234eeb1c62cca2/Source/WebCore/rendering/style/RenderStyleSetters.h#L171
            // [2]: https://github.com/WebKit/WebKit/blob/1a78cf12c8f5ff2e296f7eb25ff4bcbc86cfbfe8/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L4341-L4345
            view.dom.style.caretColor = NativeMobileBridge ? "initial" : "-apple-system-blue";
        }

        let touchState: {
            finish: (event: TouchEvent) => void;
            cancel: () => void;
        } | null = null;

        // NOTE(calebmer): The logic here also exists in a nearly identical form in
        // `<TaskRowTitleInput>` since that component supports dual modality on mobile
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

            // If there's a focused element this tap dismisses the focus. It doesn't make
            // the editor editable.
            if (document.activeElement && document.activeElement !== document.body) return;

            let isTargetInteractive = false;
            if (event.target instanceof HTMLElement && view.dom.contains(event.target)) {
                let element: HTMLElement | null = event.target;

                while (element !== null && element !== view.dom) {
                    if (
                        element.classList.contains(linkClassName) ||
                        element.classList.contains(commentClassName) ||
                        // Includes the language picker button and the copy code button.
                        element.classList.contains(codeBlockToolbarClassName)
                    ) {
                        isTargetInteractive = true;
                        break;
                    }

                    element = element.parentElement;
                }
            }

            // If the touch target is a link or image or comment or some other interactive
            // element, then they handle the touch event. The touch will not give our
            // editor focus.
            if (isTargetInteractive) return;

            // If there's a selection this tap dismisses the selection. It doesn't make the
            // editor editable.
            const selection = window.getSelection();
            const hasSelection =
                selection &&
                (selection.anchorNode !== selection.focusNode ||
                    selection.anchorOffset !== selection.focusOffset);
            if (hasSelection) return;

            // Long press touch selects text instead of starts editing. 0.5 seconds is the
            // default press duration used by iOS's long press gesture recognizer.
            // https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            const longPressTimeout = createTimeout(() => {
                touchState?.cancel();
                touchState = null;
            }, 500);

            touchState = {
                finish: event => {
                    longPressTimeout.clear();

                    const posResult = view.posAtCoords({left: touch.clientX, top: touch.clientY});
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

        // Stash the editor view instance on the DOM node for debugging and tests.
        (rootElement as any)[internalEditorViewKey] = view;

        viewRef.current = view;

        return () => {
            document.removeEventListener("selectionchange", handleSelectionChange);
            view.destroy();
        };

        // IMPORTANT: If the view ref ever changes I suspect things will start
        // breaking. (Though I'm not entirely sure.) Child components may be written
        // assuming a constant view. Make sure this is always an empty
        // dependency array.
    }, []);

    // Effect which reconciles our editor state prop with the imperative editor
    // view state.
    //
    // Layout effect because the visual layout depends on the editor state prop
    // which we need to set imperatively.
    useLayoutEffect(() => {
        // We don't do anything with `lastOptimisticTransactionTime` in this effect,
        // but we want the effect to re-run whenever it changes. We optimistically
        // update our `EditorView` state as an optimization. When React finishes
        // committing we reconcile the prop state with the `EditorView` state in
        // this effect.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lastOptimisticTransactionTime;

        const newState = unwrap(state);

        const view = assertExists(viewRef.current);
        const oldState = view.state;
        if (oldState !== newState) {
            view.updateState(newState);
            onStateChange(oldState, newState, null);
        }

        updateEditorEmptyClass(newState);
    }, [lastOptimisticTransactionTime, state]);

    const [decorationCallbacks, setDecorationCallbacks] = useState<
        ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
    >(() => new Set());

    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        view.setProps({
            editable: () => !isDualModality || isFocused,

            decorations: state => {
                let decorationSet = DecorationSet.empty;

                if (isMobileWebKit) {
                    decorationSet = addSelectionEndOfParagraphSentenceBreakMobileWebKitDecoration(
                        decorationSet,
                        state,
                    );
                }

                decorationSet = addEmojiDecorations(decorationSet, state.doc);

                for (const decorationCallback of decorationCallbacks) {
                    decorationSet = decorationCallback(decorationSet, state);
                }

                return decorationSet;
            },
        });
    }, [decorationCallbacks, isDualModality, isFocused]);

    // Apply `className`s from our `className` prop. Take care to make sure class
    // names added by ProseMirror or other effects continue to be applied.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);
        const viewElement = view.dom;

        const classList = classNames(
            docClassName,
            withMobileLayout ? withMobileLayoutDocClassName : undefined,
            isCompact || isExtraCompact ? compactDocClassName : undefined,
            isExtraCompact ? extraCompactDocClassName : undefined,
            className,
        ).split(" ");
        viewElement.classList.add(...classList);

        return () => {
            viewElement.classList.remove(...classList);
        };
    }, [className, isCompact, isExtraCompact, withMobileLayout]);

    // Adds the `emptyTitleClassName` class if the editor document is empty and
    // removes the class when the editor document is not empty.
    function updateEditorEmptyClass(state: EditorState) {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        const addEmptyTitleClassName = isContentTitleEmpty(state.doc);
        if (addEmptyTitleClassName && !viewElement.classList.contains(emptyTitleClassName)) {
            viewElement.classList.add(emptyTitleClassName);
        }
        if (!addEmptyTitleClassName && viewElement.classList.contains(emptyTitleClassName)) {
            viewElement.classList.remove(emptyTitleClassName);
        }

        const addEmptyBodyClassName = isContentBodyEmpty(state.doc);
        if (addEmptyBodyClassName && !viewElement.classList.contains(emptyBodyClassName)) {
            viewElement.classList.add(emptyBodyClassName);
        }
        if (!addEmptyBodyClassName && viewElement.classList.contains(emptyBodyClassName)) {
            viewElement.classList.remove(emptyBodyClassName);
        }
    }

    // Apply a class to the view element depending on whether the shift key is
    // down or not.
    useEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        let isShiftKeyOrAltKeyDown = false;

        const handleKeyDownOrUp = (event: KeyboardEvent) => {
            if (event.shiftKey || event.altKey) {
                if (!isShiftKeyOrAltKeyDown) {
                    isShiftKeyOrAltKeyDown = true;
                    viewElement.classList.add(shiftKeyOrAltKeyDownClassName);
                }
            } else {
                if (isShiftKeyOrAltKeyDown) {
                    isShiftKeyOrAltKeyDown = false;
                    viewElement.classList.remove(shiftKeyOrAltKeyDownClassName);
                }
            }
        };

        document.addEventListener("keydown", handleKeyDownOrUp, true);
        document.addEventListener("keyup", handleKeyDownOrUp, true);

        return () => {
            document.removeEventListener("keydown", handleKeyDownOrUp, true);
            document.removeEventListener("keyup", handleKeyDownOrUp, true);
        };
    }, []);

    // Keep various attributes on the editor element up to date.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        // Set the role for assistive technologies. For documentation see:
        // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
        viewElement.setAttribute("role", "textbox");
        viewElement.setAttribute("aria-multiline", "true");

        if (ariaLabel) {
            viewElement.setAttribute("aria-label", ariaLabel);
        } else {
            viewElement.removeAttribute("aria-label");
        }

        if (ariaLabelledBy) {
            viewElement.setAttribute("aria-labelledby", ariaLabelledBy);
        } else {
            viewElement.removeAttribute("aria-labelledby");
        }
    }, [ariaLabel, ariaLabelledBy]);

    const isTitleEmpty = isContentTitleEmpty(state.getDoc());
    const isBodyEmpty = isContentBodyEmpty(state.getDoc());

    // Set `aria-placeholder` on the editor for accessibility and then
    // `data-placeholder` on nodes which need to render placeholders.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        if (!placeholder) {
            viewElement.removeAttribute("aria-placeholder");
        } else {
            viewElement.setAttribute("aria-placeholder", placeholder);

            const placeholderDecorationCallbacks: Array<
                (decorationSet: DecorationSet, state: EditorState) => DecorationSet
            > = [];

            if (isTitleEmpty) {
                placeholderDecorationCallbacks.push((decorationSet, state) => {
                    return decorationSet.add(state.doc, [
                        Decoration.node(0, 2, {
                            "data-placeholder": documentFallbackTitle,
                            // For accessibility, if the title is empty add the fallback title as an
                            // `aria-label`. axe complains when we have an empty `<h1>`.
                            "aria-label": documentFallbackTitle,
                        }),
                    ]);
                });
            }

            if (isBodyEmpty) {
                placeholderDecorationCallbacks.push((decorationSet, state) => {
                    let from;
                    if (!state.doc.type.schema.nodes.title) {
                        from = 0;
                    } else {
                        from = state.doc.child(0).nodeSize;
                    }

                    return decorationSet.add(state.doc, [
                        Decoration.node(from, from + 2, {
                            "data-placeholder": placeholder,
                        }),
                    ]);
                });
            }

            if (placeholderDecorationCallbacks.length > 0) {
                setDecorationCallbacks(decorationCallbacks => {
                    const newDecorationCallbacks = new Set(decorationCallbacks);
                    for (const decorationCallback of placeholderDecorationCallbacks)
                        newDecorationCallbacks.add(decorationCallback);
                    return newDecorationCallbacks;
                });
            }

            return () => {
                if (placeholderDecorationCallbacks.length > 0) {
                    setDecorationCallbacks(decorationCallbacks => {
                        const newDecorationCallbacks = new Set(decorationCallbacks);
                        for (const decorationCallback of placeholderDecorationCallbacks)
                            newDecorationCallbacks.delete(decorationCallback);
                        return newDecorationCallbacks;
                    });
                }
            };
        }
    }, [isBodyEmpty, isTitleEmpty, placeholder]);

    // When the content editor is unfocused and there's a floater give the editor's
    // selection some style so the user knows what the floater is editing.
    //
    // This is important for the link and highlight floater which gives the user's
    // keyboard focus to another element that's still targeting the content editor.
    // So the user needs to see what content their link/highlight will apply to.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const view = viewRef.current;
        const viewElement = view.dom;

        const blurDecorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            const floaterState = getContentEditorFloaterState(state);

            switch (floaterState.type) {
                // While the comment input is open, optimistically add the highlight style so
                // the user doesn't lose track of the text they selected.
                case "CommentInput": {
                    return decorationSet.add(state.doc, [
                        Decoration.inline(state.selection.from, state.selection.to, {
                            class: contentSchemaStyles.commentClassName,
                        }),
                    ]);
                }
                // While the link input is open, optimistically add the link style so the user
                // doesn't lose track of the text they selected.
                case "KeyboardLink":
                case "PointerLink": {
                    return decorationSet.add(state.doc, [
                        Decoration.inline(state.selection.from, state.selection.to, {
                            class: contentSchemaStyles.linkClassName,
                        }),
                    ]);
                }
                default:
                    return decorationSet;
            }
        };

        const handleFocus = () => {
            setIsFocused(true);

            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };

        const handleBlur = () => {
            setIsFocused(false);

            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.add(blurDecorationCallback);
                return newDecorationCallbacks;
            });
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

            setDecorationCallbacks(decorationCallbacks => {
                if (!decorationCallbacks.has(blurDecorationCallback)) return decorationCallbacks;
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, []);

    const [selectedNodeElement, setSelectedNodeElement] = useState<HTMLElement | null>(null);

    useEffect(() => {
        // Rerun this effect whenever anything in the content editor changes. We depend
        // on `state` since that represents the latest official state and we depend on
        // `lastOptimisticTransactionTime` since that represents when content changes
        // optimistically.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lastOptimisticTransactionTime;

        const view = assertExists(viewRef.current);
        const viewElement = view.dom;

        // Keep track of the element ProseMirror marks as selected with the
        // `ProseMirror-selectednode` CSS class so that we can render our own custom
        // ring around it.
        const selectedNodeElement = viewElement.getElementsByClassName(
            "ProseMirror-selectednode",
        )[0];
        if (selectedNodeElement instanceof HTMLElement) {
            setSelectedNodeElement(selectedNodeElement);
        } else {
            setSelectedNodeElement(null);
        }
    }, [lastOptimisticTransactionTime, state]);

    // Highlights the selection of all our phantom text selections using the
    // ProseMirror decoration feature. We render `phantomSelections` in two
    // parts:
    //
    // 1. The phantom text selection (only if the selection is not empty)
    // 2. The text selection cursor head
    //
    // 1 is rendered using the PromiseMirror decoration feature. 2 is rendered as
    // standard React components since inserting an element into the DOM between
    // some characters breaks kerning. Which causes some jitter when user quickly
    // moves their phantom cursor around.
    useLayoutEffect(() => {
        if (!phantomSelections || phantomSelections.length === 0) return;

        const decorations: Array<(state: EditorState) => Array<Decoration>> = [];

        for (const phantomSelection of phantomSelections) {
            if (phantomSelection.anchor !== phantomSelection.head) {
                decorations.push(state => {
                    const from = Math.min(
                        Math.min(phantomSelection.anchor, phantomSelection.head),
                        state.doc.nodeSize - 2,
                    );
                    const to = Math.min(
                        Math.max(phantomSelection.anchor, phantomSelection.head),
                        state.doc.nodeSize - 2,
                    );

                    return createSelectionDecorations(
                        state.doc,
                        TextSelection.between(state.doc.resolve(from), state.doc.resolve(to)),
                        colorSchemeVars[`${phantomSelection.color}-selection`],
                    );
                });
            }
        }

        if (decorations.length === 0) return;

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(
                state.doc,
                // We need to copy the array since it looks like `DecorationSet.add()`
                // mutates it?
                decorations.flatMap(decoration => decoration(state)),
            );
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [phantomSelections]);

    const floaterState = state.getFloaterState();

    // If we have a mention floater, we also want to decorate the text the user is
    // typing in so they know the boundaries of the mention.
    useLayoutEffect(() => {
        if (floaterState.type !== "Mention") return;

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(state.doc, [
                Decoration.inline(floaterState.range.from, floaterState.range.to, {
                    class: inlineMentionInputClassName,
                }),
            ]);
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [floaterState]);

    // Watch all parent elements of our content editor for scroll events. When a
    // scroll event occurs we want to call `onParentScrollSymbol` on link mark
    // elements and comment mark elements.
    //
    // This replicates the behavior in `@react-aria/interactions` where a press is
    // cancelled when a parent element scrolls. This behavior is important for
    // mobile since the user must press somewhere on the screen to scroll. Normally
    // `pointercancel` should be dispatched when the user scrolls while pressing on
    // some element but when the CSS `touch-action: manipulation` is set the press
    // is not cancelled.
    //
    // We can't add listeners to parent scroll elements in our link/mark view code
    // because ProseMirror does not offer us a cleanup hook for mark views! So we
    // add listeners at this level and call into `onParentScrollSymbol`.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        let isPointerDownAndOverParentScrollReceiver = false;

        const handlePointerDown = (event: PointerEvent) => {
            let hasPointerDownAndOverParentScrollReceiverParent = false;

            {
                let parentElement: HTMLElement | null = event.target as HTMLElement;
                while (parentElement) {
                    if (
                        parentElement.classList.contains(
                            parentScrollWhenPointerDownAndOverReceiverClassName,
                        ) ||
                        parentElement.classList.contains(linkClassName) ||
                        parentElement.classList.contains(commentClassName)
                    ) {
                        hasPointerDownAndOverParentScrollReceiverParent = true;
                        break;
                    }

                    parentElement =
                        parentElement.parentElement !== view.dom
                            ? parentElement.parentElement
                            : null;
                }
            }

            isPointerDownAndOverParentScrollReceiver =
                hasPointerDownAndOverParentScrollReceiverParent;
        };

        const handlePointerUp = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        const handlePointerLeave = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        const handlePointerCancel = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        view.dom.addEventListener("pointerdown", handlePointerDown);
        view.dom.addEventListener("pointerup", handlePointerUp);
        view.dom.addEventListener("pointerleave", handlePointerLeave);
        view.dom.addEventListener("pointercancel", handlePointerCancel);

        const handleScroll = () => {
            if (!isPointerDownAndOverParentScrollReceiver) return;
            isPointerDownAndOverParentScrollReceiver = false;

            for (const element of view.dom.querySelectorAll(
                // `linkClassName` and `commentClassName` are inherently receivers of this
                // event.
                `.${parentScrollWhenPointerDownAndOverReceiverClassName}, .${linkClassName}, .${commentClassName}`,
            )) {
                dispatchParentScrollWhenPointerDownAndOverEvent(element);
            }
        };

        const scrollEventTargets: Array<EventTarget> = [window];

        {
            let parentElement = view.dom.parentElement;
            while (parentElement) {
                const {overflowX, overflowY} = getComputedStyle(parentElement);

                if (
                    overflowX === "auto" ||
                    overflowX === "scroll" ||
                    overflowY === "auto" ||
                    overflowY === "scroll"
                ) {
                    scrollEventTargets.push(parentElement);
                }

                parentElement =
                    parentElement.parentElement !== document.body
                        ? parentElement.parentElement
                        : null;
            }
        }

        for (const scrollEventTarget of scrollEventTargets) {
            scrollEventTarget.addEventListener("scroll", handleScroll, true);
        }

        return () => {
            view.dom.removeEventListener("pointerdown", handlePointerDown);
            view.dom.removeEventListener("pointerup", handlePointerUp);
            view.dom.removeEventListener("pointerleave", handlePointerLeave);
            view.dom.removeEventListener("pointercancel", handlePointerCancel);

            for (const scrollEventTarget of scrollEventTargets) {
                scrollEventTarget.removeEventListener("scroll", handleScroll, true);
            }
        };
    }, []);

    useContentEditorDebugTools(viewRef);

    const unwrappedState = unwrap(state);

    const [mobileLinkModalState, setMobileLinkModalState] =
        useState<ContentEditorMobileLinkModalState | null>(null);
    if (!(isMobile && !withoutMobileKeyboardToolbar) && mobileLinkModalState) {
        setMobileLinkModalState(null);
    }

    const [isMobileCommentInputOpen, setIsMobileCommentInputOpen] = useState(false);
    if (
        (!unwrappedState.schema.marks.comment || !(isMobile && !withoutMobileKeyboardToolbar)) &&
        isMobileCommentInputOpen
    ) {
        setIsMobileCommentInputOpen(false);
    }

    const setSelectionAfterCommentInputOpenRef = useRef<Selection | null>(null);

    useLayoutEffect(() => {
        if (!isMobileCommentInputOpen) return;

        const view = assertExists(viewRef.current);

        if (setSelectionAfterCommentInputOpenRef.current) {
            const selection = setSelectionAfterCommentInputOpenRef.current;
            setSelectionAfterCommentInputOpenRef.current = null;
            view.dispatch(view.state.tr.setSelection(selection));
        }

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(state.doc, [
                Decoration.inline(state.selection.from, state.selection.to, {
                    class: contentSchemaStyles.commentClassName,
                }),
            ]);
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [isMobileCommentInputOpen, setDecorationCallbacks, viewRef]);

    const [codeBlockLanguagePickerState, setCodeBlockLanguagePickerState] = useState<{
        readonly key: Id;
        readonly targetElement: HTMLElement;
        readonly languageId: ContentCodeBlockLanguageId;
        // Could return `undefined` if the node has been unmounted.
        readonly getPos: () => number | undefined;
        readonly isVisible: boolean;
    } | null>(null);

    // Whenever this component renders check that `targetElement` is still in the
    // DOM. If it's not (maybe `attr`s changed or another user removed it) then
    // reset our state to null.
    if (
        codeBlockLanguagePickerState &&
        !document.body.contains(codeBlockLanguagePickerState.targetElement)
    ) {
        setCodeBlockLanguagePickerState(null);
    }

    // Report whether the overlay is open or closed. If the overlay is open we want to
    // continue rendering our hover state.
    const lastCodeBlockLanguagePickerStateRef = useRef(codeBlockLanguagePickerState);
    useEffect(() => {
        const lastCodeBlockLanguagePickerState = lastCodeBlockLanguagePickerStateRef.current;
        lastCodeBlockLanguagePickerStateRef.current = codeBlockLanguagePickerState;
        if (lastCodeBlockLanguagePickerState === codeBlockLanguagePickerState) return;

        if (
            codeBlockLanguagePickerState &&
            lastCodeBlockLanguagePickerState?.key !== codeBlockLanguagePickerState.key
        ) {
            dispatchTriggeredOverlayOpenEvent(codeBlockLanguagePickerState.targetElement);
        }

        if (
            lastCodeBlockLanguagePickerState &&
            lastCodeBlockLanguagePickerState.key !== codeBlockLanguagePickerState?.key
        ) {
            dispatchTriggeredOverlayCloseEvent(lastCodeBlockLanguagePickerState.targetElement);
        }
    }, [codeBlockLanguagePickerState]);

    const codeBlockCopyButtonTooltipRef = useRef<TooltipRef>(null);

    const [codeBlockCopyButtonTooltipState, setCodeBlockCopyButtonTooltipState] = useState<{
        readonly key: Id;
        readonly targetElement: HTMLElement;
        readonly wasPressed: boolean;
    } | null>(null);

    // Whenever this component renders check that `targetElement` is still in the
    // DOM. If it's not (maybe `attr`s changed or another user removed it) then
    // reset our state to null.
    if (
        codeBlockCopyButtonTooltipState &&
        (isMobile || !document.body.contains(codeBlockCopyButtonTooltipState.targetElement))
    ) {
        setCodeBlockCopyButtonTooltipState(null);
    }

    return (
        <div
            className={classNames(
                containerClassName,
                !canPrimaryInputHover ? canNotPrimaryInputHoverContainerClassName : undefined,
                customContainerClassName,
            )}
            onFocus={onFocus}
            onFocusCapture={onFocusCapture}
            onBlur={onBlur}
        >
            <ContentEditorFloater
                isMobile={isMobile}
                withMobileLayout={withMobileLayout}
                state={unwrappedState}
                viewRef={viewRef}
                floaterState={floaterState}
                setFloaterState={floaterState => {
                    const view = assertExists(viewRef.current);
                    view.dispatch(setContentEditorFloaterState(view.state.tr, floaterState));
                }}
                isFocused={isFocused}
                lastSelectionChangeTransactionTime={lastSelectionChangeTransactionTime}
            />
            {selectedNodeElement && (
                // TODO(calebmer): If you type "foo" in the title, then "bar" in the body, then
                // put your cursor at the beginning of "bar" and hit backspace it selects the
                // title node and it looks weird. (Make sure there are no paragraphs
                // after "bar".)
                <FocusRing isVisible={true} targetElement={selectedNodeElement} />
            )}
            {phantomSelections?.map(phantomSelection => (
                <ContentEditorPhantomSelectionCursor
                    key={phantomSelection.key}
                    state={unwrappedState}
                    viewRef={viewRef}
                    phantomSelection={phantomSelection}
                />
            ))}
            {isMobile && !isInert && !withoutMobileKeyboardToolbar && (
                <ContentEditorMobileKeyboardToolbar
                    state={unwrappedState}
                    viewRef={viewRef}
                    isFocused={isFocused}
                    openCommentThread={props.openCommentThread}
                    onLinkModalOpen={setMobileLinkModalState}
                    onCommentInputOpen={setSelection => {
                        if (setSelection) {
                            setSelectionAfterCommentInputOpenRef.current = setSelection;
                        }

                        setIsMobileCommentInputOpen(true);
                    }}
                />
            )}
            {mobileLinkModalState && (
                // Needs to be rendered outside of `<ContentEditorMobileKeyboardToolbar>` so
                // that when we go inert this is still rendered.
                <MobileFullScreenModal onClose={() => setMobileLinkModalState(null)}>
                    {({onCloseWithAnimation}) => (
                        <ContentEditorMobileLinkModal
                            viewRef={viewRef}
                            initialText={mobileLinkModalState.initialText}
                            isTextEditable={mobileLinkModalState.isTextEditable}
                            initialUrl={mobileLinkModalState.initialUrl}
                            onCloseWithAnimation={onCloseWithAnimation}
                        />
                    )}
                </MobileFullScreenModal>
            )}
            {unwrappedState.schema.marks.comment && isMobileCommentInputOpen && (
                // Needs to be rendered outside of `<ContentEditorMobileKeyboardToolbar>` so
                // that when we go inert this is still rendered.
                <ContentEditorMobileCommentInputBottomBar
                    state={unwrappedState}
                    viewRef={viewRef}
                    onClose={() => setIsMobileCommentInputOpen(false)}
                />
            )}
            {codeBlockLanguagePickerState && (
                <ContentEditorCodeBlockLanguagePickerComboBox
                    targetElement={codeBlockLanguagePickerState.targetElement}
                    isVisible={codeBlockLanguagePickerState.isVisible}
                    onCloseWithAnimation={() => {
                        // NOTE(calebmer, #mobile-webkit-weirdness): Courtesy blur since WebKit doesn't
                        // like it when a focused element is removed from the DOM. We've observed
                        // sometimes that when this combobox closes and we don't call `blur()` WebKit
                        // will scroll us to the bottom of the parent document! It's unclear to me what
                        // causes this to happen but it's definitely the browser
                        // (`register_scroll_event_debugger.ts` doesn't report a scroll from
                        // JavaScript) and calling `blur()` beforehand helps.
                        //
                        // Since the language picker is a blocking overlay, while open the only focused
                        // element could be one inside the overlay.
                        if (document.activeElement instanceof HTMLElement) {
                            document.activeElement.blur();
                        }

                        setCodeBlockLanguagePickerState({
                            ...codeBlockLanguagePickerState,
                            isVisible: false,
                        });
                    }}
                    onCloseWithoutAnimation={() => {
                        // NOTE(calebmer, #mobile-webkit-weirdness): Courtesy blur since WebKit doesn't
                        // like it when a focused element is removed from the DOM. We've observed
                        // sometimes that when this combobox closes and we don't call `blur()` WebKit
                        // will scroll us to the bottom of the parent document! It's unclear to me what
                        // causes this to happen but it's definitely the browser
                        // (`register_scroll_event_debugger.ts` doesn't report a scroll from
                        // JavaScript) and calling `blur()` beforehand helps.
                        //
                        // Since the language picker is a blocking overlay, while open the only focused
                        // element could be one inside the overlay.
                        if (document.activeElement instanceof HTMLElement) {
                            document.activeElement.blur();
                        }

                        setCodeBlockLanguagePickerState(null);
                    }}
                    selectedLanguageId={codeBlockLanguagePickerState.languageId}
                    onSelectedLanguageChange={languageId => {
                        const pos = codeBlockLanguagePickerState.getPos();
                        if (pos === undefined) return;

                        const view = assertExists(viewRef.current);
                        view.dispatch(view.state.tr.setNodeAttribute(pos, "language", languageId));
                    }}
                />
            )}
            {codeBlockCopyButtonTooltipState && (
                <Tooltip
                    key={codeBlockCopyButtonTooltipState.key}
                    ref={codeBlockCopyButtonTooltipRef}
                    placement="bottom"
                    isInitiallyHovered={true}
                    isVisibleAfterPress={true}
                    targetElement={codeBlockCopyButtonTooltipState.targetElement}
                    content={
                        !codeBlockCopyButtonTooltipState.wasPressed ? (
                            "Copy"
                        ) : (
                            <Box display="inline" color="grey-60">
                                Copied
                            </Box>
                        )
                    }
                    onStateChange={state => {
                        // Once the tooltip completely disappears (after fade out completes) then we
                        // can remove our tooltip state.
                        if (
                            !state.isHovered &&
                            !state.isFocused &&
                            !state.isFadingIn &&
                            !state.isFadingOut
                        ) {
                            setCodeBlockCopyButtonTooltipState(null);
                        }
                    }}
                />
            )}
        </div>
    );
}

// Inspired by [React internal keys][1].
//
// [1]: https://github.com/facebook/react/blob/80c4dea0d1da0012977c6c4b2ac7a8bd37154d50/packages/react-dom/src/client/ReactDOMComponentTree.js#L34-L41
const internalEditorViewKey = `__prosemirrorEditorView$${Math.random().toString(36).slice(2)}`;

export function getEditorViewForTest(element: unknown): EditorView {
    assert(import.meta.jest);
    assert(typeof element === "object" && element !== null);

    const editorView =
        (element as any)[internalEditorViewKey] ??
        (element as any).parentNode?.[internalEditorViewKey];

    assert(editorView instanceof EditorView);
    return editorView;
}

function handlePaste(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
    if (handleLinkPasteWithSelection(view, event)) return true;
    if (handleLinkPasteWithoutSelection(view, event)) return true;

    // If we're pasting into an empty paragraph at the top level, then paste the
    // entire slice content instead of the content determined by `Slice.maxOpen()`.
    if (
        view.state.selection.$from.depth === 1 &&
        view.state.selection.$from.node().type.name === "paragraph" &&
        view.state.selection.$from.node().nodeSize === 2 &&
        view.state.selection.$from.pos === view.state.selection.$to.pos
    ) {
        view.dispatch(view.state.tr.replaceSelection(new Slice(slice.content, 0, 0)));
        return true;
    }

    // When pasting a `codeBlock` or a `codeBlockLine` if we're pasting in the
    // middle of a paragraph then the code block's content will be converted to
    // plain text. We want to style that text with the `code` mark so after we
    // paste, try adding the mark to the entire range of the pasted content. If
    // the range is a `codeBlock` adding the mark will be a noop. But if we
    // converted the code block to paragraph text then the mark will be added.
    if (
        slice.content.firstChild?.type.name === "codeBlock" ||
        slice.content.firstChild?.type.name === "codeBlockLine"
    ) {
        const {from, to} = view.state.selection;
        const transaction = view.state.tr.replaceSelection(slice);

        const mappedFrom = transaction.mapping.map(from, -1);
        const mappedTo = transaction.mapping.map(to, 1);

        transaction.addMark(
            mappedFrom,
            mappedTo,
            slice.content.firstChild.type.schema.mark("code"),
        );

        view.dispatch(transaction);
        return true;
    }

    return false;
}

/**
 * If the user has selected some text and they paste a link then we want to
 * convert the selected text to a link instead of replacing the text.
 */
function handleLinkPasteWithSelection(view: EditorView, event: ClipboardEvent): boolean {
    // 1. Only perform a link paste if we've selected some text.
    const {state} = view;
    if (state.selection.from === state.selection.to) {
        return false;
    }

    // 2. Make sure the URL starts with an allowed protocol.
    const url = event.clipboardData?.getData("text/plain");
    if (url && (!startsWithSafeUrlProtocol(url) || /\s/.test(url))) {
        return false;
    }

    // 3. Instead of replacing the selected text with the replaced text we instead
    // add a link mark to the selection.
    const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
    view.dispatch(state.tr.addMark(range.from, range.to, state.schema.mark("link", {url})));
    return true;
}

function handleLinkPasteWithoutSelection(view: EditorView, event: ClipboardEvent): boolean {
    const {state} = view;
    const {from} = state.selection;

    // 1. Check if current selection is empty
    if (!state.selection.empty) {
        return false;
    }

    // 2. Make sure the URL exists, starts with an allowed protocol and contains no whitespace.
    const url = event.clipboardData?.getData("text/plain");
    if (!url || !startsWithSafeUrlProtocol(url) || /\s/.test(url)) {
        return false;
    }

    // 3. Insert URL text and apply link mark
    const tr = state.tr;
    tr.insertText(url, from);
    tr.addMark(from, from + url.length, state.schema.mark("link", {url}));
    view.dispatch(tr);
    return true;
}

/**
 * Create decorations that carefully recreate browser text selection styles. So
 * far we've only tested this on Chrome for MacOS. May need tweaks to match
 * Windows styles.
 *
 * Some things to consider when creating selection styles in Chrome for MacOS:
 *
 * - The height of the selection should match the text's line height. Not
 *   content height. We can't find a CSS property to let us target an inline
 *   element's line height with a background color so we carefully add some
 *   padding.
 *
 * - Selection adds some extra space at the end of selected paragraphs to show
 *   that you are selecting a newline.
 */
function createSelectionDecorations(doc: Node, selection: Selection, color: string) {
    // Convert non-text selections into text selections. So the `from` and `to`
    // point to positions in text.
    if (!(selection instanceof TextSelection)) {
        selection = TextSelection.between(selection.$from, selection.$to);
    }

    const decorations = [
        Decoration.inline(selection.from, selection.to, {
            class: phantomSelectionClassName,
            style: `background-color:${color}`,
        }),
    ];

    // Add newline indicators to the end of selected paragraphs and headers like
    // browser selection styles.
    //
    // Particularly important to show we've selected an empty paragraph or header.
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!node.inlineContent) return;

        const newlineIndicatorPos = pos + node.content.size + 1;
        if (newlineIndicatorPos >= selection.to) return;

        decorations.push(
            Decoration.widget(newlineIndicatorPos, () => {
                const newlineIndicatorElement = document.createElement("span");
                newlineIndicatorElement.textContent = " ";
                newlineIndicatorElement.className = phantomSelectionClassName;
                newlineIndicatorElement.style.backgroundColor = color;
                newlineIndicatorElement.style.userSelect = "none";
                newlineIndicatorElement.ariaHidden = "true";
                return newlineIndicatorElement;
            }),
        );
    });

    return decorations;
}

/**
 * Add a decoration for every emoji in the editor that wraps the emoji in a
 * `<span>` and changes the font to `emojiFontFamily`. Otherwise we end up
 * using characters from our default font (Inter). For example, Inter has a
 * heart glyph but we don't want to use that glyph.
 *
 * Since traversing the entire doc can be expensive for large docs we have a
 * caching layer that takes advantage of structural sharing in the immutable
 * doc representation.
 */
const addEmojiDecorations = createProsemirrorIncrementalReducer<DecorationSet>(node => {
    if (!node.isText) return null;

    const text = node.text!;
    const emojis = Array.from(iterateEmojis(text));

    if (emojis.length === 0) return null;

    return (decorations, doc, offset) => {
        return decorations.add(
            doc,
            emojis.map(({index, emoji}) =>
                Decoration.inline(offset + index, offset + index + emoji.length, {
                    nodeName: "span",
                    class: emojiClassName,
                }),
            ),
        );
    };
});

// NOTE(calebmer, #mobile-webkit-weirdness): This is a hack to fix a bug in
// mobile WebKit (iOS). If you have the following in a content editor (e.g.
// post creator) where `|` is your cursor:
//
// ```
// Test.
// Test|
// Test.
// ```
//
// ... and you want to press space twice to insert a period (the double space
// period shortcut must be on in your device's settings) without this hack it
// won't work!
//
// If your cursor is at the very end of the doc then double space to insert a
// period will work. Like this:
//
// ```
// Test.
// Test|
// ```
//
// If your cursor is in the middle of a sentence then double space to insert a
// period will work. Like this:
//
// ```
// Test. Test| Test.
// Test.
// ```
//
// For some reason, WebKit frustratingly doesn't want to insert a period at the
// end of a paragraph that's not the last paragraph. However, since we observed
// WebKit will insert a period in the middle of a sentence we have a workaround.
//
// We insert a `<span>` with a zero width space (that's hidden with:
// `aria-hidden="true"` and `visibility: none`. `display: none` doesn't work)
// at the end of the paragraph your selection is in. This mimics the selection
// in middle of sentence use case and WebKit happily inserts a period after
// pressing double space. Ridiculous.
//
// If we ever fork WebKit someday can we fix this properly?
function addSelectionEndOfParagraphSentenceBreakMobileWebKitDecoration(
    decorations: DecorationSet,
    state: EditorState,
): DecorationSet {
    const $pos = state.selection.$from;

    let depth = $pos.depth;
    let node = $pos.node(depth);

    while (node.isInline) {
        depth -= 1;
        node = $pos.node(depth);
    }

    if (!node.isTextblock || node.type.name !== "paragraph" || node.content.size === 0)
        return decorations;

    return decorations.add(state.doc, [
        Decoration.widget(
            $pos.end(depth),
            () => {
                const sentenceBreakElement = document.createElement("span");
                sentenceBreakElement.ariaHidden = "true";
                sentenceBreakElement.style.visibility = "false";
                sentenceBreakElement.style.width = "0px";
                sentenceBreakElement.appendChild(
                    document.createTextNode(
                        // zero width space (https://graphemica.com/200B)
                        "\u200B",
                    ),
                );
                return sentenceBreakElement;
            },
            {key: "sentenceBreak"},
        ),
    ]);
}
