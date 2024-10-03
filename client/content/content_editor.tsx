import classNames from "classnames";
import {history, redoDepth, undoDepth} from "prosemirror-history";
import {Fragment, Node, Slice} from "prosemirror-model";
import {
    AllSelection,
    Command,
    EditorState,
    NodeSelection,
    PluginKey,
    Selection,
    TextSelection,
    Transaction,
} from "prosemirror-state";
import {Decoration, DecorationSet, DirectEditorProps, EditorView} from "prosemirror-view";
import {
    FocusEvent,
    Memo,
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
    ContentEditorReferencesSharedAction,
    ContentEditorState,
    getContentEditorFloaterState,
    getContentEditorReferences,
    rememberContentEditorSelectionWhileLoading,
    setContentEditorFloaterState,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {createContentEditorCheckListItemNodeView} from "~/client/content/internal/content_editor_check_list_item_node_view.js";
import {ContentEditorCodeBlockLanguagePickerComboBox} from "~/client/content/internal/content_editor_code_block_language_picker_combo_box.js";
import {createContentEditorCodeBlockNodeViewConstructor} from "~/client/content/internal/content_editor_code_block_node_view.js";
import {createContentEditorCommentMarkViewConstructor} from "~/client/content/internal/content_editor_comment_mark_view.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {createContentEditorFileFloatNodeViewConstructor} from "~/client/content/internal/content_editor_file_float_node_view.js";
import {createContentEditorFileNodeViewConstructor} from "~/client/content/internal/content_editor_file_node_view.js";
import {createContentEditorFileRowNodeViewConstructor} from "~/client/content/internal/content_editor_file_row_node_view.js";
import {ContentEditorFileToolbarController} from "~/client/content/internal/content_editor_file_toolbar.js";
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
import {
    ContentEditorFileDropTarget,
    getContentEditorFileDropTargets,
} from "~/client/content/internal/get_content_editor_file_drop_targets.js";
import {
    dispatchParentScrollWhenPointerDownAndOverEvent,
    parentScrollWhenPointerDownAndOverClassNames,
} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {ContentFilePreviewExpirationTimers} from "~/client/content/internal/render_content_file_preview.js";
import {
    UploadFileFromContentEditorInput,
    uploadFileFromContentEditor,
} from "~/client/content/internal/upload_file_from_content_editor.js";
import {useContentEditorDebugTools} from "~/client/content/internal/use_content_editor_debug_tools.js";
import {AppContext, useAppContextIfExists} from "~/client/context/app_context.js";
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
import {flushScrollbarResizeSync} from "~/client/design/scrollbar.js";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants.js";
import {Tooltip, TooltipRef} from "~/client/design/tooltip.js";
import {textInputVisibilityMaintainerMarginYRem} from "~/client/design/use_text_input_visibility_maintainer.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isVirtualKeyboardEvent} from "~/client/helpers/events/is_virtual_keyboard_event.js";
import {flushSyncIfNotRendering} from "~/client/helpers/flush_sync_if_not_rendering.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContextIfExists} from "~/client/spaces/space_context.js";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {colorSchemeVars, contentEditorStyles, contentStyles} from "~/client/styles/styles.js";
import {getSynchronizedSystemClock} from "~/client/tracer/synchronized_system_clock.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {getContentReferencedIdsForSlice} from "~/shared/content/content_referenced_ids.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {commentClassName, fileClassName, linkClassName} from "~/shared/content/content_styles.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {convertRemLengthToPx, spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {ThemeColor, defaultThemeColor} from "~/shared/design/theme_colors.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {
    FileAttachmentTarget,
    deserializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {generateChronologicalIdWithTime} from "~/shared/id/chronological_id.js";
import {Id, generateId, isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {getAccountsIfExist} from "~/shared/rpc/accounts_rpc_definitions.js";
import {
    attachFileFromAttachment,
    getFileFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";
import {Store} from "~/shared/store/store.js";

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
     * Scroll the content editor's selection into view.
     */
    scrollIntoView(): void;

    /**
     * Get the coordinates of the provided position. Directly calls
     * [`EditorView.coordsAtPos()`][1].
     *
     * [1]: https://prosemirror.net/docs/ref/#view.EditorView.coordsAtPos
     */
    coordsAtPos(pos: number): {left: number; right: number; top: number; bottom: number};

    /**
     * Get the node at the provided position. Directly calls
     * [`EditorView.nodeDOM()`][1].
     *
     * [1]: https://prosemirror.net/docs/ref/#view.EditorView.nodeDOM
     */
    nodeDom(pos: number): globalThis.Node | null;

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
     * If the content editor supports files then you must pass in
     * `FileAttachmentTarget`. This prop is used:
     *
     * 1. Before adding a file to content we need to call either
     *    `attachFileAsUploader()` or `attachFileFromAttachment()` to make sure
     *    everyone who has access to the attachment target has access to the file.
     *    We use the attachment target to create the correct link.
     *
     * 2. When refreshing expired signed preview URLs we need the attachment target
     *    so we can prove the current account has access to the file.
     *
     * An error will be thrown if your content supports files but doesn't provide
     * `fileAttachmentTarget`.
     */
    fileAttachmentTarget?: Memo<FileAttachmentTarget>;

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
    fileAttachmentTarget,
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
            scrollIntoView: () => {
                throw new UnimplementedError(
                    "Scrolling content editor selection into view on initial render is not implemented",
                );
            },
            coordsAtPos: () => {
                throw new UnimplementedError(
                    "Getting coordinates for position in content editor on initial render is not implemented",
                );
            },
            nodeDom: () => {
                throw new UnimplementedError(
                    "Getting DOM for position in content editor on initial render is not implemented",
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
        <div
            className={classNames(contentEditorStyles.containerClassName, customContainerClassName)}
        >
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
                fileAttachmentTarget={fileAttachmentTarget}
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
    /* ========================================================================== *\
     *                                   Props                                    *
    \* ========================================================================== */

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
        fileAttachmentTarget,
    } = props;

    /* ========================================================================== *\
     *                                  Context                                   *
    \* ========================================================================== */

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

    /* ========================================================================== *\
     *                                 Prop refs                                  *
    \* ========================================================================== */

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
    const contextRef = useRef(context);
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
        contextRef.current = context;
        spaceContextRef.current = spaceContext;
    });

    /* ========================================================================== *\
     *                                    Refs                                    *
    \* ========================================================================== */

    const viewRef = useRef<EditorView | null>(null);
    const lastTransactionRef = useRef<Transaction | null>(null);
    const referencesUpdateEmitterRef = useRef<EventEmitter | null>(null);
    const tripleClickSelectionDragRef = useRef<{
        selection: Selection | null;
        done: () => void;
    } | null>(null);

    /* ========================================================================== *\
     *                               Component ref                                *
    \* ========================================================================== */

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
            scrollIntoView: () => {
                const view = assertExists(viewRef.current);
                view.dispatch(view.state.tr.scrollIntoView());
            },
            coordsAtPos: pos => {
                const view = assertExists(viewRef.current);
                return view.coordsAtPos(pos);
            },
            nodeDom: pos => {
                const view = assertExists(viewRef.current);
                return view.nodeDOM(pos);
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

    /* ========================================================================== *\
     *                         ProseMirror initialization                         *
    \* ========================================================================== */

    const [fileDropTarget, setFileDropTarget] = useState<ContentEditorFileDropTarget | null>(null);

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

        const viewProps: DirectEditorProps = {
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

            domParser: ContentEditorDomParser.fromSchema(schema),
        };

        /* ========================================================================== *\
         *                               Scroll margin                                *
        \* ========================================================================== */

        let lastRemPx: number | null = null;
        let lastScrollMargin: {top: number; left: number; right: number; bottom: number} | null =
            null;

        const getScrollMargin = () => {
            const remPx = getRemPxWithoutListening();

            if (lastScrollMargin !== null && lastRemPx === remPx) return lastScrollMargin;

            const scrollMarginPx = textInputVisibilityMaintainerMarginYRem * remPx;

            lastRemPx = remPx;

            lastScrollMargin = {
                // If our schema has a title then use the title's padding top as our top
                // margin. This has two important effects:
                //
                // 1. Content with titles (documents) also typically have a navigation bar.
                //    Since the title padding is larger than our navigation bar height while
                //    moving up with arrow keys the selection won't be covered by the
                //    navigation bar.
                //
                // 2. Moving up through content with arrow keys and arriving at the title will
                //    have fully scrolled the editor to the top of the view.
                top: schema.nodes.title
                    ? convertRemLengthToPx(
                          isMobileRef.current
                              ? contentStyles.mobilePlatformTitlePaddingTop
                              : withMobileLayoutRef.current
                              ? contentStyles.mobileLayoutTitlePaddingTop
                              : contentStyles.desktopTitlePaddingTop,
                          remPx,
                      ) + 1
                    : scrollMarginPx,
                left:
                    scrollMarginPx +
                    // This is the base width of code block line numbers. When scrolling left, to
                    // make sure the selection is visible we should scroll past line numbers which
                    // cover up content.
                    convertRemLengthToPx(
                        subtractRemLengths(
                            spacing[contentStyles.listItemIndentation],
                            propsRef.current.isCompact || propsRef.current.isExtraCompact
                                ? spacing[contentStyles.compactListItemOffset]
                                : spacing["0"],
                        ),
                        remPx,
                    ),
                right: scrollMarginPx,
                bottom: scrollMarginPx,
            };

            return lastScrollMargin;
        };

        Object.defineProperty(viewProps, "scrollThreshold", {
            get: getScrollMargin,
        });

        Object.defineProperty(viewProps, "scrollMargin", {
            get: getScrollMargin,
        });

        /* ========================================================================== *\
         *                            Node and mark views                             *
        \* ========================================================================== */

        const filePreviewExpirationTimers = schema.nodes.file
            ? new ContentFilePreviewExpirationTimers()
            : undefined;
        filePreviewExpirationTimers?.play();

        // IMPORTANT: If you have a custom view in `nodeViews` here you should also
        // have a matching custom renderer in `nodeRenderers` in
        // `renderContentToHtml()`.
        viewProps.nodeViews = {
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
                getCurrentAccountIfExists: () => spaceContextRef.current?.currentAccount ?? null,
            }),
            fileRow: createContentEditorFileRowNodeViewConstructor({
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
            }),
            fileFloat: createContentEditorFileFloatNodeViewConstructor({
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
            }),
            file: createContentEditorFileNodeViewConstructor({
                getContext: () => assertExists(contextRef.current),
                getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                getAttachmentTarget: () => assertExists(propsRef.current.fileAttachmentTarget),
                getExpirationTimers: () => assertExists(filePreviewExpirationTimers),
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
                isOurEditorUploading: fileId => !!uploadingFileIds?.has(fileId),
            }),
        };

        // IMPORTANT: If you have a custom view in `markViews` here you should also
        // have a matching custom renderer in `markRenderers` in
        // `renderContentToHtml()`.
        viewProps.markViews = {
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
        };

        /* ========================================================================== *\
         *                                Click events                                *
        \* ========================================================================== */

        viewProps.handleClick = (view, pos, event) => {
            // Don't perform the default ProseMirror behavior when clicking a file.
            //
            // We have pointer event listeners in `content_editor_file_node_view.ts` that
            // implements selecting the file on shift click and opening the attachment
            // viewer otherwise.
            if (event.target instanceof Element && event.target.closest(`.${fileClassName}`)) {
                return true;
            }
        };

        // ProseMirror provides its own triple click selection support. This is good,
        // the browser's triple click support doesn't work well with
        // `contenteditable="false"` children. e.g. A mention in a paragraph (the
        // mention is `contenteditable="false"`). The browser default won't select the
        // whole paragraph on triple click. Or a paragraph followed by a `fileFloat` or
        // `fileRow` (which are also `contenteditable="false"`). A triple click for
        // paragraphs followed by files moves the cursor to the start of the paragraph
        // instead of selecting the paragraph.
        //
        // ProseMirror's triple click support works consistently unlike the browser.
        // However, ProseMirror doesn't implement dragging the mouse after a triple
        // click to move the selection like the browser does. And preventing the
        // browser default with `event.preventDefault()` means the browser won't move
        // the selection during a drag. So we reimplement dragging the selection after
        // a triple click here.
        viewProps.handleTripleClick = (view, pos, event) => {
            // Don't perform the default ProseMirror behavior when clicking a file.
            if (event.target instanceof Element && event.target.closest(`.${fileClassName}`)) {
                return true;
            }

            tripleClickSelectionDragRef.current?.done();
            tripleClickSelectionDragRef.current = null;

            const done = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", done);
                document.removeEventListener("dragstart", done);
            };

            // TODO(calebmer, #files): If the user's cursor is near the top or bottom of the
            // screen then we should start scrolling. I want to implement this at the same
            // time as I'm scrolling for file drags.
            const move = (event: MouseEvent) => {
                if (event.buttons === 0 || !tripleClickSelectionDragRef.current) {
                    done();
                    return;
                }

                // We expect the selection to be updated by ProseMirror's default triple click
                // support synchronously after `handleTripleClick` is called. So
                // `originalSelection` shouldn't be null. Silently ignore event if it is null.
                const {selection: originalSelection} = tripleClickSelectionDragRef.current;
                if (!originalSelection) return;

                const posResult = view.posAtCoords({
                    top: event.clientY,
                    left: event.clientX,
                });
                if (!posResult) return;

                const $pos = view.state.doc.resolve(posResult.pos);

                let selection: Selection;
                if ($pos.pos < originalSelection.from) {
                    selection = TextSelection.between(originalSelection.$to, $pos, -1);
                } else if ($pos.pos > originalSelection.to) {
                    selection = TextSelection.between(originalSelection.$from, $pos, 1);
                } else if (view.state.selection.$anchor === originalSelection.$from) {
                    selection = TextSelection.between(
                        originalSelection.$from,
                        originalSelection.$to,
                        -1,
                    );
                } else {
                    selection = TextSelection.between(
                        originalSelection.$to,
                        originalSelection.$from,
                        1,
                    );
                }

                if (!selection.eq(view.state.selection)) {
                    view.dispatch(view.state.tr.setSelection(selection));
                }
            };

            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", done);
            document.addEventListener("dragstart", done);

            tripleClickSelectionDragRef.current = {
                selection: null,
                done,
            };

            return false;
        };

        /* ========================================================================== *\
         *                                 Copy/paste                                 *
        \* ========================================================================== */

        let uploadingFileIds: Set<FileId> | undefined;

        let temporaryPastedFileInfoById:
            | Map<
                  FileId,
                  | {
                        type: "UploadFile";
                        input: UploadFileFromContentEditorInput;
                    }
                  | {
                        type: "AttachFile";
                        spaceId: SpaceId;
                        fileId: FileId;
                        target: FileAttachmentTarget;
                    }
              >
            | undefined;

        viewProps.clipboardSerializer =
            ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                schema,
                () => assertExists(spaceContextRef.current).space.id,
                () => propsRef.current.state.getContent().references,
                () => assertExists(propsRef.current.fileAttachmentTarget),
            );

        viewProps.clipboardTextSerializer = slice =>
            contentEditorTextClipboardSerializer(
                slice,
                () => assertExists(spaceContextRef.current).space.id,
                () => propsRef.current.state.getContent().references,
            );

        viewProps.transformPasted = slice => {
            // When pasting a slice that starts with a heading and has some other nodes,
            // make sure we always use an `openStart` of 0 so the heading doesn't merge
            // with the previous node.
            if (
                slice.content.firstChild?.type.name === "heading" &&
                slice.content.childCount > 1 &&
                slice.openStart !== 0
            ) {
                slice = new Slice(slice.content, 0, slice.openEnd);
            }

            // If the slice is a `codeBlock` with a single line then instead of trying to
            // paste a code block, instead paste the individual text nodes with code
            // styling.
            if (
                slice.content.childCount === 1 &&
                slice.content.firstChild!.type.name === "codeBlock" &&
                slice.content.firstChild!.childCount === 1
            ) {
                slice = new Slice(
                    Fragment.from(
                        slice.content.firstChild!.firstChild!.content.content.map(node =>
                            node.mark(schema.mark("code").addToSet(node.marks)),
                        ),
                    ),
                    0,
                    0,
                );
            }

            // If your slice starts (or ends) with a `codeBlock` then set `openStart` (or
            // `openEnd`) to 0 so we don't inline any of the code block's content (instead
            // maintaining the code block's structure) with whatever we're pasting against.
            {
                if (slice.content.firstChild?.type.name === "codeBlock" && slice.openStart !== 0) {
                    slice = new Slice(slice.content, 0, slice.openEnd);
                }

                if (slice.content.lastChild?.type.name === "codeBlock" && slice.openEnd !== 0) {
                    slice = new Slice(slice.content, slice.openStart, 0);
                }
            }

            return slice;
        };

        // When using a client generated `FileId` the server expects the `FileId` to be
        // within a 4 minute window of the current time. To prevent issues with clock
        // skew let's use our synchronized clock to generate the `FileId`.
        const generateFileIdWithSynchronizedClock = () => {
            const clock =
                getSynchronizedSystemClock().getStateWithoutListening().value ??
                unsynchronizedSystemClock;

            return generateChronologicalIdWithTime<FileId>(Math.round(clock.now()));
        };

        viewProps.transformPastedDOM = element => {
            let currentUrl: URL | undefined;

            // File copy/pasting is tricky. In the content itself a file is represented as
            // a node with only a `FileId`. Data about the file is available on the side
            // in `ContentReferences` and often needs to be loaded from the server.
            //
            // The format of pasted content is HTML. We generate HTML when copying files
            // that should be compatible with a broad range of applications. For example,
            // file nodes become `<img>` elements.
            //
            // We can be receiving pasted files that:
            //
            // 1. Was copied in Alpine; OR
            // 2. Was copied from a different application
            //
            // In case 1 we already have the file uploaded to our servers. What we want to
            // do here is create another file attachment link from wherever the file is
            // coming from (which we store in a `data-cy-attached` attribute) to the
            // `FileAttachmentTarget` of our content editor.
            //
            // In case 2 we want to download the file from its URL and upload it to our
            // servers. We also do this for files from different spaces since file storage
            // is scoped to a space.
            //
            // There's a bit of juggling we need to do in this code. `handlePaste` is where
            // we implement asynchronous pastes. However, `handlePaste` receives a
            // ProseMirror `Slice` that only contains file nodes with their `FileId`s.
            // Knowledge about whether we're in case 1 or case 2 and the source URL of
            // files we're pasting is available only in the HTML here in
            // `transformPastedDOM`. We bridge this gap with `temporaryPastedFileInfoById`.
            // `transformPastedDOM` adds additional information about each file we're
            // pasting in `temporaryPastedFileInfoById` and `handlePaste` reads from this
            // map for each `FileId` it found in the pasted ProseMirror `Slice`. Not very
            // elegant but it gets the job done.
            if (schema.nodes.file) {
                for (const fileElement of element.querySelectorAll("img, video, audio, object")) {
                    const urlString =
                        fileElement instanceof HTMLImageElement
                            ? fileElement.src || null
                            : fileElement instanceof HTMLVideoElement ||
                              fileElement instanceof HTMLAudioElement
                            ? fileElement.src ||
                              findMapIterable(fileElement.childNodes, fileChildElement =>
                                  fileChildElement instanceof HTMLSourceElement
                                      ? fileChildElement.src
                                      : undefined,
                              ) ||
                              null
                            : fileElement instanceof HTMLObjectElement
                            ? fileElement.data || null
                            : null;

                    if (urlString === null) {
                        const temporaryFileElement = fileElement.ownerDocument.createElement("div");
                        temporaryFileElement.setAttribute("data-cy-tmp-file", "null");
                        fileElement.parentNode?.replaceChild(temporaryFileElement, fileElement);
                        continue;
                    }

                    currentUrl ??= new URL(window.location.href);

                    let url: URL;
                    try {
                        url = new URL(urlString, currentUrl);
                    } catch {
                        // Ignore any URL parsing errors.
                        continue;
                    }

                    // Ignore non-HTTP protocols for now. It's probably reasonable to support
                    // `data://` URLs at some point.
                    if (url.protocol !== "http:" && url.protocol !== "https:") {
                        continue;
                    }

                    // If:
                    //
                    // 1. The file is hosted on the same domain we're currently on; AND
                    // 2. The file matches the route `/files/:spaceId/:fileId`; AND
                    // 3. The file is in the same space that we're in right now; AND
                    // 4. The file element has a valid `data-cy-attached` attribute
                    //
                    // Then the file already exists for this space. Instead of uploading a new file
                    // to our backend instead we can create a new attachment for the file that
                    // already exists.
                    if (currentUrl.host === url.host) {
                        const pathnameMatch = url.pathname.match(/^\/files\/([^/]+)\/([^/]+)$/);
                        if (
                            pathnameMatch &&
                            isId<SpaceId>(pathnameMatch[1]!) &&
                            isId<FileId>(pathnameMatch[2]!) &&
                            pathnameMatch[1] === spaceContextRef.current?.space.id
                        ) {
                            const spaceId = pathnameMatch[1];
                            const fileId = pathnameMatch[2];

                            const targetString = fileElement.getAttribute("data-cy-attached");
                            let target: FileAttachmentTarget | undefined;

                            try {
                                if (targetString) {
                                    target = deserializeFileAttachmentTargetString(targetString);
                                }
                            } catch (error) {
                                // This error is almost imperceivable to the user since we'll try
                                // downloading/uploading the file as a fallback. But it might be a sign that
                                // there's a bug somewhere in `data-cy-attached` generation so let's log it.
                                contextRef.current?.tracer
                                    .getRoot()
                                    .logUncaughtException(
                                        'Couldn\'t parse "data-cy-attached" attribute',
                                        error,
                                    );
                            }

                            if (target) {
                                // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will
                                // use this map synchronously after `transformPastedDOM`.
                                if (temporaryPastedFileInfoById === undefined) {
                                    temporaryPastedFileInfoById = new Map();
                                    scheduleMicrotask(() => {
                                        temporaryPastedFileInfoById = undefined;
                                    });
                                }

                                temporaryPastedFileInfoById.set(fileId, {
                                    type: "AttachFile",
                                    spaceId,
                                    fileId,
                                    target,
                                });

                                const temporaryFileElement =
                                    fileElement.ownerDocument.createElement("div");
                                temporaryFileElement.setAttribute("data-cy-tmp-file", fileId);
                                fileElement.parentNode?.replaceChild(
                                    temporaryFileElement,
                                    fileElement,
                                );
                                continue;
                            }
                        }
                    }

                    const fileId = generateFileIdWithSynchronizedClock();

                    // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will
                    // use this map synchronously after `transformPastedDOM`.
                    if (temporaryPastedFileInfoById === undefined) {
                        temporaryPastedFileInfoById = new Map();
                        scheduleMicrotask(() => {
                            temporaryPastedFileInfoById = undefined;
                        });
                    }

                    temporaryPastedFileInfoById.set(fileId, {
                        type: "UploadFile",
                        input: {type: "Url", url},
                    });

                    const temporaryFileElement = fileElement.ownerDocument.createElement("div");
                    temporaryFileElement.setAttribute("data-cy-tmp-file", fileId);
                    fileElement.parentNode?.replaceChild(temporaryFileElement, fileElement);
                }
            }
        };

        // TODO(calebmer, #files): I think we should be using basically the same code
        // for drag and drop.
        viewProps.handlePaste = (view, event, slice) => {
            // If we're pasting an empty slice that means ProseMirror couldn't parse the
            // data in `event.clipboardData`. If `event.clipboardData` has any files then
            // let's use `FileUploadService` to attach the file to our content.
            if (
                schema.nodes.file &&
                schema.nodes.fileRow &&
                slice.size === 0 &&
                event.clipboardData
            ) {
                for (const item of event.clipboardData.items) {
                    if (item.kind !== "file") continue;

                    // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will
                    // use this map synchronously.
                    if (temporaryPastedFileInfoById === undefined) {
                        temporaryPastedFileInfoById = new Map();
                        scheduleMicrotask(() => {
                            temporaryPastedFileInfoById = undefined;
                        });
                    }

                    const fileId = generateFileIdWithSynchronizedClock();

                    temporaryPastedFileInfoById.set(fileId, {
                        type: "UploadFile",
                        input: {type: "File", file: assertExists(item.getAsFile())},
                    });

                    slice = new Slice(
                        Fragment.from(schema.node("fileRow", {}, [schema.node("file", {fileId})])),
                        0,
                        0,
                    );
                    break;
                }
            }

            let selection = view.state.selection;

            // If the selection starts in our title, then shift the selection out of the
            // title. That way if we paste a paragraph in the title the paragraph doesn't
            // become the title. Making a 50 word paragraph the title just feels broken.
            //
            // If the first child we're pasting is a heading then leave the selection as it
            // is. We want headings to fill the title.
            if (selection.$from.parent.type.name === "title") {
                if (slice.content.firstChild?.type.name !== "heading") {
                    selection = TextSelection.between(
                        view.state.doc.resolve(selection.$from.after()),
                        selection.$to.parent.type.name === "title"
                            ? view.state.doc.resolve(selection.$to.after())
                            : selection.$to,
                    );
                } else {
                    // Make sure if we're pasting a `heading` node into a `title` node the
                    // `openStart` is always at least 1 so the heading can fill the title instead
                    // of creating a new block below.
                    if (slice.openStart < 1) {
                        slice = new Slice(slice.content, 1, slice.openEnd);
                    }

                    // If we're pasting a `heading` node into a `title` node and we have another
                    // block node besides the first `heading` node and the node after the `title`
                    // node is an empty paragraph then let's have our selection include the
                    // paragraph.
                    //
                    // This way if the user pastes into an empty document they won't have a
                    // trailing paragraph at the end.
                    if (
                        selection.$from.pos === selection.$to.pos &&
                        selection.$from.parentOffset === selection.$from.parent.content.size &&
                        iterableFind(sliceIterable(slice.content.content, 1), childNode =>
                            childNode.type.groups.includes("block"),
                        )
                    ) {
                        const nextNode = selection.$from
                            .node(selection.$from.depth - 1)
                            .maybeChild(selection.$from.indexAfter(selection.$from.depth - 1));

                        if (nextNode?.type.name === "paragraph" && nextNode.content.size === 0) {
                            selection = TextSelection.between(
                                selection.$from,
                                view.state.doc.resolve(selection.$from.after() + 2),
                            );
                        }
                    }
                }
            }

            const referencedIds = getContentReferencedIdsForSlice(slice);

            // Implement the same logic as ProseMirror's `doPaste` function. First we need
            // to call our synchronous `handlePaste` override and if that returns false
            // then we need to perform the same default paste handling that ProseMirror
            // implements.
            //
            // https://github.com/ProseMirror/prosemirror-view/blob/d27ff92999b2aedca18c34efaab8fa5e695dcc8f/src/input.ts#L592-L601
            const actuallyHandlePaste = (
                selection: Selection,
                createTransaction: () => Transaction,
            ) => {
                if (
                    handlePaste(
                        view.state.doc,
                        selection,
                        createTransaction,
                        transaction => view.dispatch(transaction),
                        event,
                        slice,
                    )
                ) {
                    return;
                }

                const transaction = createTransaction();

                const singleNode =
                    slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1
                        ? slice.content.firstChild
                        : null;

                if (singleNode) {
                    selection.replaceWith(transaction, singleNode);
                } else {
                    selection.replace(transaction, slice);
                }

                view.dispatch(
                    transaction.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"),
                );
            };

            // If there's some references in the paste then let's perform an asynchronous
            // paste where we load all requisite data first.
            if (referencedIds.accountIds.size === 0 && referencedIds.fileIds.size === 0) {
                actuallyHandlePaste(selection, () => view.state.tr);
                return true;
            }

            const context = assertExists(contextRef.current);
            const reporter = assertExists(reporterRef.current);
            const spaceId = assertExists(spaceContextRef.current).space.id;

            let rememberedSelection: {getSelection: () => Selection | null} = {
                getSelection: () => selection,
            };

            // TODO(calebmer, #global-loading-indicator): Show a "pasting" indicator if
            // we're waiting for a data fetch before applying a paste.
            const promise = context.tracer.withSpan(
                "Content editor paste with references",
                handlePasteWithReferences,
            );

            rememberedSelection = rememberContentEditorSelectionWhileLoading(
                view,
                selection,
                promise,
            );

            promise.catch(error => {
                reporter.displayError("Couldn’t paste", error);
            });

            return true;

            async function handlePasteWithReferences(context: AppContext) {
                let hasPasted = false;
                const promiseWaiter = new PromiseWaiter();

                const accountsPromise =
                    referencedIds.accountIds.size > 0
                        ? getAccountsIfExist(context, {
                              spaceId,
                              accountIds: referencedIds.accountIds,
                          }).then(({accounts}) => accounts)
                        : emptyArray;

                const pasteFile = async (fileId: FileId) => {
                    const temporaryPastedFileInfo = temporaryPastedFileInfoById?.get(fileId);
                    if (!temporaryPastedFileInfo) return null;

                    switch (temporaryPastedFileInfo.type) {
                        case "AttachFile": {
                            const fromTarget = temporaryPastedFileInfo.target;
                            const toTarget = assertExists(propsRef.current.fileAttachmentTarget);

                            // If the file is already in our view's references that means it's already
                            // been loaded and we have the requisite permissions for it. No file loading
                            // needed.
                            if (
                                getContentEditorReferences(view.state).references.fileById.has(
                                    fileId,
                                )
                            ) {
                                return null;
                            }
                            // If we're trying to attach the file to the same attachment target it's from
                            // then we don't need to perform another attach mutation. Instead, all we need
                            // to do is load the file (since it's not in our references).
                            else if (isDeepEqual(fromTarget, toTarget)) {
                                return getFileFromAttachment(context, {
                                    spaceId: temporaryPastedFileInfo.spaceId,
                                    fileId: temporaryPastedFileInfo.fileId,
                                    target: toTarget,
                                });
                            }
                            // Otherwise, let's attach the file to its new attachment target.
                            else {
                                return attachFileFromAttachment(context, {
                                    spaceId: temporaryPastedFileInfo.spaceId,
                                    fileId: temporaryPastedFileInfo.fileId,
                                    fromTarget,
                                    toTarget,
                                });
                            }
                        }
                        case "UploadFile": {
                            const fileReferencePromiseResolver = createPromiseResolver<{
                                signedUrlSearch: string;
                                fileStore: Store<FileModel>;
                            }>();

                            promiseWaiter.waitUntil(async () => {
                                let uploadingFileId: FileId | undefined;
                                let unsubscribeFromFileStore: (() => void) | undefined;

                                // TODO(calebmer, #files): Error handling
                                try {
                                    await uploadFileFromContentEditor(context, {
                                        spaceId,
                                        // Use the `FileId` generated by the client and used in the pasted `Slice`
                                        // instead of generating a new `FileId` on the server.
                                        fileId,
                                        attachmentTarget: assertExists(
                                            propsRef.current.fileAttachmentTarget,
                                        ),
                                        input: temporaryPastedFileInfo.input,
                                        onAttach: ({signedUrlSearch, fileStore}) => {
                                            const initialFile = fileStore.getSnapshot();
                                            uploadingFileId = initialFile.id;
                                            (uploadingFileIds ??= new Set()).add(initialFile.id);

                                            // Whenever the file changes during the upload, make sure to update it in
                                            // our content references. We unsubscribe once the upload has finished since
                                            // after that the file should be immutable.
                                            unsubscribeFromFileStore = fileStore.subscribe(() => {
                                                // Before we paste the file won't exist in our content so there's no point in
                                                // updating content editor references.
                                                if (!hasPasted) return;

                                                view.dispatch(
                                                    updateContentEditorReferences(view.state.tr, {
                                                        type: "SetFile",
                                                        signedUrlSearch,
                                                        file: fileStore.getSnapshot(),
                                                    }),
                                                );
                                            });

                                            fileReferencePromiseResolver.resolve({
                                                signedUrlSearch,
                                                fileStore,
                                            });
                                        },
                                    });
                                } finally {
                                    if (uploadingFileId) uploadingFileIds?.delete(uploadingFileId);
                                    unsubscribeFromFileStore?.();
                                }
                            });

                            const {signedUrlSearch, fileStore} =
                                await fileReferencePromiseResolver.promise;

                            return () => ({
                                signedUrlSearch,
                                file: fileStore.getSnapshot(),
                            });
                        }
                        default:
                            throw exhaustive(temporaryPastedFileInfo);
                    }
                };

                const [accounts, fileReferences] = await runAllPromises([
                    accountsPromise,
                    runAllPromises(mapIterable(referencedIds.fileIds, pasteFile)),
                ]);

                // Get the selection remembered by our editor state. Not the view's current
                // selection. The view selection might have moved while we were pasting.
                const selection = rememberedSelection.getSelection();
                if (!selection) return;

                // Any new paste transaction should start by updating content references with
                // the data we just asynchronously fetched.
                const createTransaction = () =>
                    updateContentEditorReferences(
                        view.state.tr,
                        Array.from(
                            concatIterables<ContentEditorReferencesSharedAction>(
                                filterMapIterable(accounts, account => {
                                    if (!account) return;
                                    return {type: "SetAccount", account};
                                }),
                                filterMapIterable(fileReferences, fileReference => {
                                    if (!fileReference) return;

                                    if (typeof fileReference === "function")
                                        fileReference = fileReference();

                                    return {
                                        type: "SetFile",
                                        signedUrlSearch: fileReference.signedUrlSearch,
                                        file: fileReference.file,
                                    };
                                }),
                            ),
                        ),
                    );

                actuallyHandlePaste(selection, createTransaction);
                hasPasted = true;

                await promiseWaiter.wait();
            }
        };

        /* ========================================================================== *\
         *                       Drag and drop events (part 1)                        *
        \* ========================================================================== */

        viewProps.handleDrop = (_view, event, slice) => {
            const context = contextRef.current;
            const spaceContext = spaceContextRef.current;

            // Handle the user dropping files from their operating system. Not dragging
            // some slice of ProseMirror content around.
            if (
                schema.nodes.file &&
                schema.nodes.fileRow &&
                context !== null &&
                spaceContext !== null &&
                slice.size === 0 &&
                event.dataTransfer &&
                iterableSome(event.dataTransfer.items, item => item.kind === "file")
            ) {
                const dropTarget = getMouseEventFileDropTarget(event);

                // TODO(calebmer, #files): Support dropping multiple files at once.
                const fileItem = iterableFind(
                    event.dataTransfer.items,
                    item => item.kind === "file",
                );

                if (
                    dropTarget &&
                    fileItem &&
                    // TODO(calebmer, #files): Remove this when ready to deploy to production.
                    process.env.NODE_ENV === "development"
                ) {
                    runPromiseWithoutAwaiting(async () => {
                        let uploadingFileId: FileId | undefined;
                        let unsubscribeFromFileStore: (() => void) | undefined;

                        // TODO(calebmer, #files): Error handling
                        try {
                            await uploadFileFromContentEditor(context, {
                                spaceId: spaceContext.space.id,
                                attachmentTarget: assertExists(
                                    propsRef.current.fileAttachmentTarget,
                                ),
                                input: {
                                    type: "File",
                                    file: assertExists(fileItem.getAsFile()),
                                },
                                onAttach: ({signedUrlSearch, fileStore}) => {
                                    const initialFile = fileStore.getSnapshot();
                                    uploadingFileId = initialFile.id;
                                    (uploadingFileIds ??= new Set()).add(initialFile.id);

                                    // Whenever the file changes during the upload, make sure to update it in
                                    // our content references. We unsubscribe once the upload has finished since
                                    // after that the file should be immutable.
                                    unsubscribeFromFileStore = fileStore.subscribe(() => {
                                        view.dispatch(
                                            updateContentEditorReferences(view.state.tr, {
                                                type: "SetFile",
                                                signedUrlSearch,
                                                file: fileStore.getSnapshot(),
                                            }),
                                        );
                                    });

                                    const transaction = view.state.tr;

                                    switch (dropTarget.action.type) {
                                        case "InsertFileRow": {
                                            const fileRowNode = schema.nodes.fileRow!.create(null, [
                                                schema.nodes.file!.create({
                                                    fileId: initialFile.id,
                                                }),
                                            ]);

                                            const $pos = transaction.doc.resolve(
                                                dropTarget.action.pos,
                                            );

                                            if (
                                                $pos.nodeAfter?.type.name === "paragraph" &&
                                                $pos.nodeAfter.content.size === 0
                                            ) {
                                                transaction.replace(
                                                    dropTarget.action.pos,
                                                    dropTarget.action.pos + 2,
                                                    new Slice(Fragment.from(fileRowNode), 0, 0),
                                                );

                                                transaction.setSelection(
                                                    new NodeSelection(
                                                        transaction.doc.resolve(
                                                            dropTarget.action.pos + 1,
                                                        ),
                                                    ),
                                                );
                                            } else if (
                                                $pos.nodeBefore?.type.name === "paragraph" &&
                                                $pos.nodeBefore.content.size === 0
                                            ) {
                                                transaction.replace(
                                                    dropTarget.action.pos - 2,
                                                    dropTarget.action.pos,
                                                    new Slice(Fragment.from(fileRowNode), 0, 0),
                                                );

                                                transaction.setSelection(
                                                    new NodeSelection(
                                                        transaction.doc.resolve(
                                                            dropTarget.action.pos - 1,
                                                        ),
                                                    ),
                                                );
                                            } else {
                                                transaction.insert(
                                                    dropTarget.action.pos,
                                                    fileRowNode,
                                                );

                                                transaction.setSelection(
                                                    new NodeSelection(
                                                        transaction.doc.resolve(
                                                            dropTarget.action.pos + 1,
                                                        ),
                                                    ),
                                                );
                                            }
                                            break;
                                        }
                                        case "InsertFileIntoRow": {
                                            transaction.insert(
                                                dropTarget.action.pos,
                                                schema.nodes.file!.create({
                                                    fileId: initialFile.id,
                                                }),
                                            );

                                            transaction.setSelection(
                                                new NodeSelection(
                                                    transaction.doc.resolve(dropTarget.action.pos),
                                                ),
                                            );
                                            break;
                                        }
                                        default:
                                            throw exhaustive(dropTarget.action);
                                    }

                                    updateContentEditorReferences(transaction, {
                                        type: "SetFile",
                                        signedUrlSearch,
                                        file: initialFile,
                                    });

                                    view.dispatch(transaction);
                                },
                            });
                        } finally {
                            if (uploadingFileId) uploadingFileIds?.delete(uploadingFileId);
                            unsubscribeFromFileStore?.();
                        }
                    });
                }

                return true;
            }

            return false;
        };

        /* ========================================================================== *\
         *                                Misc events                                 *
        \* ========================================================================== */

        viewProps.handleKeyDown = (_view, event) => {
            const {isAppleDevice} = getClientInfo();

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
        };

        viewProps.handleScrollToSelection = () => {
            // Before scrolling to selection, synchronously flush scrollbar resizes. When
            // the user is deleting content, our custom scrollbar from `scrollbar.tsx`'s
            // height will shrink once `ResizeObserver` or `MutationObserver` call their
            // callbacks. However, ProseMirror will call its `scrollRectIntoView()`
            // function BEFORE these callbacks are called. Leading to an incorrect scroll
            // because the parent element's scroll height is larger than it should be given
            // our custom scrollbar from `scrollbar.tsx` hasn't updated its height yet.
            //
            // The fix is to make sure we synchronously flush scrollbar resizes before
            // `scrollRectIntoView()` is called.
            //
            // You can see a bug this fixes [here][1]. Notice how in the bad example when
            // deleting the document underneath scrolls! Which shouldn't happen.
            //
            // [1]: https://gist.github.com/calebmer/7ac49a81c466b14cf3bac987e7bb65a9
            flushScrollbarResizeSync(view.dom);

            return false;
        };

        /* ========================================================================== *\
         *                 ProseMirror/React reconciliation (part 1)                  *
        \* ========================================================================== */

        viewProps.dispatchTransaction = transaction => {
            const oldState = view.state;

            // By default, applying a transaction will clear the editor's stored
            // marks. We don't want that behavior! Instead we want to preserve stored marks
            // until a user either explicitly toggles them off or moves their selection
            // somewhere else in the document.
            const shouldResetStoredMarks = !transaction.docChanged && transaction.selectionSet;
            if (!shouldResetStoredMarks && oldState.storedMarks && !transaction.storedMarksSet) {
                transaction.setStoredMarks(oldState.storedMarks);
            }

            const newState = oldState.apply(transaction);

            lastTransactionRef.current = transaction;

            // Always call the change handler through a ref. By using a ref we can avoid
            // destroying and recreating an editor when the function changes.
            //
            // We also must flush synchronously. Since ProseMirror preserves local DOM
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
                propsRef.current.onChange(wrap(newState), transaction);
            });
        };

        const view = new EditorView(rootElement, viewProps);

        /* ========================================================================== *\
         *                         Dual input modality events                         *
        \* ========================================================================== */

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

        // Manage content editor's dual input modality on mobile devices. Content
        // editor starts in a read only state where elements are interactive and after
        // a tap becomes editable.
        //
        // NOTE(calebmer): The logic here also exists in a nearly identical form in
        // `<TaskRowTitleInput>` since that component supports dual modality on mobile
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
                                element.classList.contains(contentStyles.codeBlockToolbarClassName)
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

        /* ========================================================================== *\
         *                       Drag and drop events (part 2)                        *
        \* ========================================================================== */

        // Manage the file drag interaction. While the user is dragging we'll update
        // our `fileDropTarget` state with the rendered drop target. When the user
        // drops we process the drop in `handleDrop` above.
        let getMouseEventFileDropTarget: (event: MouseEvent) => ContentEditorFileDropTarget | null;
        {
            let isDragging = false;

            let lastDropTargets: {
                viewWidth: number;
                viewHeight: number;
                state: EditorState;
                topBlockIndex: number;
                dropTargets: Array<ContentEditorFileDropTarget>;
            } | null = null;

            let lastDropTarget: {
                viewWidth: number;
                viewHeight: number;
                state: EditorState;
                time: number;
                dropTarget: ContentEditorFileDropTarget;
            } | null = null;

            getMouseEventFileDropTarget = (event: MouseEvent) => {
                // TODO(calebmer, #files): Remove this when ready to deploy to production.
                if (process.env.NODE_ENV !== "development") return null;

                const posResult = view.posAtCoords({left: event.clientX, top: event.clientY});
                if (!posResult) return null;

                const {width: viewWidth, height: viewHeight} = view.dom.getBoundingClientRect();
                const $pos = view.state.doc.resolve(posResult.pos);
                const topBlockIndex = $pos.index(0);
                const remPx = getRemPxWithoutListening();

                // Recompute drop targets if the mouse moved over a new top block or anything
                // changed that may have updated the layout of our content (e.g. `viewWidth`
                // resizing changes how text flows).
                if (
                    viewWidth !== lastDropTargets?.viewWidth ||
                    viewHeight !== lastDropTargets.viewHeight ||
                    view.state !== lastDropTargets?.state ||
                    topBlockIndex !== lastDropTargets?.topBlockIndex
                ) {
                    lastDropTargets = {
                        viewWidth,
                        viewHeight,
                        state: view.state,
                        topBlockIndex,
                        dropTargets: getContentEditorFileDropTargets(view, topBlockIndex),
                    };
                }

                // User experience win: Wait 100ms to update the drop target we display. That
                // way if the user is quickly moving their cursor over the document they don't
                // see drop indicators flashing in and out everywhere. This is especially
                // distracting when dragging horizontally across a file row with 2 items since
                // a drop indicator between the two images flashes in and in doing so hides the
                // vertical drop indicator that used to be there. This is distracting but by
                // reusing the last drop target for 100ms we improve the UX in this case.
                //
                // This function is called continuously during a drag by the `dragover` event
                // so we don't need to schedule a timeout to call `setFileDropTarget()` after
                // 100ms.
                if (
                    viewWidth === lastDropTarget?.viewWidth &&
                    viewHeight === lastDropTarget.viewHeight &&
                    view.state === lastDropTarget.state &&
                    Date.now() - lastDropTarget.time < perceivedAsInstantLimitMs
                ) {
                    return lastDropTarget.dropTarget;
                }

                let lastOffsetParent: Element | null = null;
                let lastOffsetParentRect: DOMRect | null = null;
                let nearestCollision: {
                    distance: number;
                    dropTarget: ContentEditorFileDropTarget;
                } | null = null;

                for (const dropTarget of lastDropTargets.dropTargets) {
                    // If all our drop targets have the same `offsetParent` then we only need to
                    // call `getBoundingClientRect()` once.
                    const offsetParentRect: DOMRect | null =
                        lastOffsetParent !== dropTarget.offsetParent
                            ? dropTarget.offsetParent?.getBoundingClientRect() ?? null
                            : lastOffsetParentRect;
                    lastOffsetParent = dropTarget.offsetParent;
                    lastOffsetParentRect = offsetParentRect;

                    const mouseX = event.clientX - (offsetParentRect?.left ?? 0);
                    const mouseY = event.clientY - (offsetParentRect?.top ?? 0);

                    // Calculate the distance between the pointer and the droppable bounding box.
                    // https://stackoverflow.com/a/18157551/1568890
                    let dx = Math.max(
                        dropTarget.rect.left - mouseX,
                        0,
                        mouseX - dropTarget.rect.right,
                    );

                    // We want our chosen drop target to be the nearest target vertically unless
                    // we're right on top of a horizontal target. This creates the effect of as
                    // you're dragging a file into a document you're only seeing the vertical drop
                    // indicators flash in/out. However, if you drag to the left or right edge of an
                    // existing file (or into the document margins) then you'll see horizontal drop
                    // indicators which will let you create a gallery.
                    //
                    // What this code is doing is it penalizes horizontal distance (compared to
                    // vertical distance) when you're out of a narrow range right on top of the drop
                    // target.
                    //
                    // We choose `spacing["5"]` as the margin in which horizontal drop targets will
                    // apply since that's the smallest size of an `<IconButton>`. Since we consider
                    // an `xs` `<IconButton>` to have a sufficient hit target we consider the hit
                    // target sufficient here too.
                    if (dx > convertRemLengthToPx(spacing["5"], remPx)) {
                        dx += viewWidth;
                    }

                    const dy = Math.max(
                        dropTarget.rect.top - mouseY,
                        0,
                        mouseY - dropTarget.rect.bottom,
                    );
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (!nearestCollision || nearestCollision.distance > distance) {
                        nearestCollision = {distance, dropTarget};
                    }
                }

                const dropTarget = nearestCollision?.dropTarget ?? null;

                if (!dropTarget) {
                    lastDropTarget = null;
                } else {
                    lastDropTarget = {
                        viewWidth,
                        viewHeight,
                        state: view.state,
                        time: Date.now(),
                        dropTarget,
                    };
                }

                return dropTarget;
            };

            view.dom.addEventListener("dragenter", event => {
                if (isDragging) return;
                const wasDragging = isDragging;
                isDragging = event.target instanceof Element && view.dom.contains(event.target);
                if (wasDragging === isDragging) return;

                if (
                    event.dataTransfer &&
                    iterableSome(event.dataTransfer.items, item => item.kind === "file")
                ) {
                    setFileDropTarget(getMouseEventFileDropTarget(event));
                } else {
                    lastDropTargets = null;
                    lastDropTarget = null;
                    setFileDropTarget(null);
                }
            });

            view.dom.addEventListener("dragleave", event => {
                if (!isDragging) return;
                const wasDragging = isDragging;
                isDragging =
                    event.relatedTarget instanceof Element &&
                    view.dom.contains(event.relatedTarget);
                if (wasDragging === isDragging) return;

                lastDropTargets = null;
                lastDropTarget = null;
                setFileDropTarget(null);
            });

            // Processing the drop happens in `handleDrop` above so we don't conflict with
            // ProseMirror's drop handling. Only clear drop state here.
            view.dom.addEventListener("drop", () => {
                if (!isDragging) return;
                isDragging = false;

                lastDropTargets = null;
                lastDropTarget = null;
                setFileDropTarget(null);
            });

            view.dom.addEventListener("dragover", event => {
                if (!isDragging) return;

                if (
                    event.dataTransfer &&
                    iterableSome(event.dataTransfer.items, item => item.kind === "file")
                ) {
                    setFileDropTarget(getMouseEventFileDropTarget(event));
                } else {
                    lastDropTargets = null;
                    lastDropTarget = null;
                    setFileDropTarget(null);
                }
            });
        }

        // Stash the editor view instance on the DOM node for debugging and tests.
        (rootElement as any)[internalEditorViewKey] = view;

        viewRef.current = view;

        return () => {
            document.removeEventListener("selectionchange", handleDocumentSelectionChange);
            filePreviewExpirationTimers?.pause();
            view.destroy();
        };

        // IMPORTANT: If the view ref ever changes I suspect things will start
        // breaking. (Though I'm not entirely sure.) Child components may be written
        // assuming a constant view. Make sure this is always an empty
        // dependency array.
        //
        // Don't ignore `react-hooks/exhaustive-deps` ESLint warnings! Instead remove
        // whatever's causing the warning.
    }, []);

    /* ========================================================================== *\
     *                 ProseMirror/React reconciliation (part 2)                  *
    \* ========================================================================== */

    const [selectedNodeElement, setSelectedNodeElement] = useState<HTMLElement | null>(null);

    // Reconcile our imperative `EditorView` state with state from React. If this
    // is run by `dispatchTransaction()` (which updates state in `flushSync()`)
    // then this should be flushed synchronously given this is a layout effect.
    useLayoutEffect(() => {
        const newState = unwrap(state);

        const view = assertExists(viewRef.current);
        const viewElement = view.dom;
        const oldState = view.state;

        // Get the transaction that produced `newState`.
        let transaction = lastTransactionRef.current;
        lastTransactionRef.current = null;
        if (transaction?.doc !== newState.doc) transaction = null;

        view.updateState(newState);

        // If the document changes then map our triple click selection based on the
        // document changes.
        if (tripleClickSelectionDragRef.current) {
            if (!tripleClickSelectionDragRef.current.selection) {
                tripleClickSelectionDragRef.current.selection = newState.selection;
            } else if (!transaction) {
                tripleClickSelectionDragRef.current.done();
                tripleClickSelectionDragRef.current = null;
            } else if (transaction.docChanged) {
                tripleClickSelectionDragRef.current.selection =
                    tripleClickSelectionDragRef.current.selection.map(
                        newState.doc,
                        transaction.mapping,
                    );
            }
        }

        // Adds the `emptyTitleClassName` class if the editor document is empty and
        // removes the class when the editor document is not empty.
        {
            const addEmptyTitleClassName = isContentTitleEmpty(newState.doc);
            if (
                addEmptyTitleClassName &&
                !viewElement.classList.contains(contentStyles.emptyTitleClassName)
            ) {
                viewElement.classList.add(contentStyles.emptyTitleClassName);
            }
            if (
                !addEmptyTitleClassName &&
                viewElement.classList.contains(contentStyles.emptyTitleClassName)
            ) {
                viewElement.classList.remove(contentStyles.emptyTitleClassName);
            }

            const addEmptyBodyClassName = isContentBodyEmpty(newState.doc);
            if (
                addEmptyBodyClassName &&
                !viewElement.classList.contains(contentStyles.emptyBodyClassName)
            ) {
                viewElement.classList.add(contentStyles.emptyBodyClassName);
            }
            if (
                !addEmptyBodyClassName &&
                viewElement.classList.contains(contentStyles.emptyBodyClassName)
            ) {
                viewElement.classList.remove(contentStyles.emptyBodyClassName);
            }
        }

        // Keep track of the element ProseMirror marks as selected with the
        // `ProseMirror-selectednode` CSS class so that we can render our own custom
        // ring around it.
        if (!(state.getSelection() instanceof NodeSelection)) {
            setSelectedNodeElement(null);
        } else {
            const selectedNodeElement = viewElement.getElementsByClassName(
                "ProseMirror-selectednode",
            )[0];
            if (selectedNodeElement instanceof HTMLElement) {
                setSelectedNodeElement(selectedNodeElement);
            } else {
                setSelectedNodeElement(null);
            }
        }

        // Emit a content references change for any subscribers (typically node views
        // which depend on content references).
        if (
            referencesUpdateEmitterRef.current &&
            getContentEditorReferences(oldState).references !==
                getContentEditorReferences(newState).references
        ) {
            referencesUpdateEmitterRef.current.emit();
        }

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
    }, [state]);

    /* ========================================================================== *\
     *               Decorations setup + dual input modality setup                *
    \* ========================================================================== */

    const [isFocused, setIsFocused] = useState(false);

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

    /* ========================================================================== *\
     *                              View attributes                               *
    \* ========================================================================== */

    // Apply `className`s from our `className` prop. Take care to make sure class
    // names added by ProseMirror or other effects continue to be applied.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);
        const viewElement = view.dom;

        const classList = classNames(
            contentStyles.docClassName,
            withMobileLayout ? contentStyles.withMobileLayoutDocClassName : undefined,
            isCompact || isExtraCompact ? contentStyles.compactDocClassName : undefined,
            isExtraCompact ? contentStyles.extraCompactDocClassName : undefined,
            className,
        ).split(" ");
        viewElement.classList.add(...classList);

        return () => {
            viewElement.classList.remove(...classList);
        };
    }, [className, isCompact, isExtraCompact, withMobileLayout]);

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

    /* ========================================================================== *\
     *                         Shift or alt keydown class                         *
    \* ========================================================================== */

    // Apply a class to the view element depending on whether the shift key is
    // down or not.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        let isShiftKeyDown = false;
        let isAltKeyDown = false;
        let isShiftKeyOrAltKeyDown = false;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Shift") {
                isShiftKeyDown = true;
            }

            if (event.key === "Alt") {
                isAltKeyDown = true;
            }

            if ((isShiftKeyDown || isAltKeyDown) && !isShiftKeyOrAltKeyDown) {
                isShiftKeyOrAltKeyDown = true;
                viewElement.classList.add(contentEditorStyles.shiftKeyOrAltKeyDownClassName);
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Shift") {
                isShiftKeyDown = false;
            }

            if (event.key === "Alt") {
                isAltKeyDown = false;
            }

            if (!isShiftKeyDown && !isAltKeyDown && isShiftKeyOrAltKeyDown) {
                isShiftKeyOrAltKeyDown = false;
                viewElement.classList.remove(contentEditorStyles.shiftKeyOrAltKeyDownClassName);
            }
        };

        // If we shift-right click to open the native context menu it appears that in
        // Chrome we won't get a shift `keyup` event. So cancel our shift/alt keydown
        // state when the context menu opens.
        const handleContextMenu = () => {
            isShiftKeyDown = false;
            isAltKeyDown = false;

            if (!isShiftKeyDown && !isAltKeyDown && isShiftKeyOrAltKeyDown) {
                isShiftKeyOrAltKeyDown = false;
                viewElement.classList.remove(contentEditorStyles.shiftKeyOrAltKeyDownClassName);
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("contextmenu", handleContextMenu, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("contextmenu", handleContextMenu, true);
        };
    }, []);

    /* ========================================================================== *\
     *                          Selection dragging class                          *
    \* ========================================================================== */

    // Apply a class to the content editor/view while the user is dragging from a text
    // element. This way we can change cursor styles like a file's cursor. Normally
    // files have a pointer cursor but while dragging to select text we want files
    // elements in the editor/view to inherit the text cursor. Otherwise a user may be
    // confused as to why while they're dragging the file appears to be clickable.
    //
    // IMPORTANT: The same effect (more or less) exists in `<ContentEditor>`. If you
    // make an update here you'll need to make an update there as well.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        let isPointerDownFromSelectableElement = false;
        let isPointerDownFromSelectableElementAndMoved = false;

        const handlePointerDown = (event: PointerEvent) => {
            const wasPointerDownFromSelectableElementAndMoved =
                isPointerDownFromSelectableElementAndMoved;

            isPointerDownFromSelectableElement =
                event.target instanceof Element &&
                getComputedStyle(event.target).userSelect !== "none";
            isPointerDownFromSelectableElementAndMoved = false;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    view.dom.classList.add(contentStyles.selectionChangeDraggingClassName);
                } else {
                    view.dom.classList.remove(contentStyles.selectionChangeDraggingClassName);
                }
            }
        };

        const handlePointerMove = () => {
            const wasPointerDownFromSelectableElementAndMoved =
                isPointerDownFromSelectableElementAndMoved;

            isPointerDownFromSelectableElementAndMoved = isPointerDownFromSelectableElement;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    view.dom.classList.add(contentStyles.selectionChangeDraggingClassName);
                } else {
                    view.dom.classList.remove(contentStyles.selectionChangeDraggingClassName);
                }
            }
        };

        const handleResetState = () => {
            const wasPointerDownFromSelectableElementAndMoved =
                isPointerDownFromSelectableElementAndMoved;

            isPointerDownFromSelectableElement = false;
            isPointerDownFromSelectableElementAndMoved = false;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    view.dom.classList.add(contentStyles.selectionChangeDraggingClassName);
                } else {
                    view.dom.classList.remove(contentStyles.selectionChangeDraggingClassName);
                }
            }
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("pointermove", handlePointerMove, true);
        document.addEventListener("pointerup", handleResetState, true);
        document.addEventListener("pointercancel", handleResetState, true);
        document.addEventListener("dragstart", handleResetState, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("pointermove", handlePointerMove, true);
            document.removeEventListener("pointerup", handleResetState, true);
            document.removeEventListener("pointercancel", handleResetState, true);
            document.removeEventListener("dragstart", handleResetState, true);
        };
    }, []);

    /* ========================================================================== *\
     *                  Unfocused floater selection decorations                   *
    \* ========================================================================== */

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

        const focusDecorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            // Highlight any selected files.
            //
            // We have similar code in `<ContentView>` that watches for the
            // `selectionchange` event and applies the class to elements within
            // `document.getSelection()`.
            if (!(state.selection instanceof NodeSelection)) {
                state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
                    if (node.type.name === "file") {
                        decorationSet = decorationSet.add(state.doc, [
                            Decoration.node(pos, pos + 1, {
                                // TODO(calebmer): When theme is configurable we should use the configured
                                // theme here instead of `defaultThemeColor`.
                                class: contentStyles.selectionFileClassNameByColor[
                                    defaultThemeColor
                                ],
                            }),
                        ]);
                    }
                });
            }

            return decorationSet;
        };

        const blurDecorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            const floaterState = getContentEditorFloaterState(state);

            switch (floaterState.type) {
                // While the comment input is open, optimistically add the highlight style so
                // the user doesn't lose track of the text they selected.
                case "CommentInput": {
                    return decorationSet.add(state.doc, [
                        Decoration.inline(state.selection.from, state.selection.to, {
                            class: commentClassName,
                        }),
                    ]);
                }
                // While the link input is open, optimistically add the link style so the user
                // doesn't lose track of the text they selected.
                case "KeyboardLink": {
                    return decorationSet.add(state.doc, [
                        Decoration.inline(state.selection.from, state.selection.to, {
                            class: linkClassName,
                        }),
                    ]);
                }
                default:
                    return decorationSet;
            }
        };

        // Don't use `flushSync()` within our effect since it won't have any effect and
        // React will log a warning.
        let withoutFlushSync = true;

        const handleFocus = () => {
            const run: (action: () => void) => void = withoutFlushSync
                ? action => action()
                : // We frequently call `focus()` in a `useEffect()`. It's fine if we don't
                  // immediately flush our `isFocused` update in this context.
                  flushSyncIfNotRendering;

            run(() => {
                setIsFocused(true);

                setDecorationCallbacks(decorationCallbacks => {
                    const newDecorationCallbacks = new Set(decorationCallbacks);
                    newDecorationCallbacks.add(focusDecorationCallback);
                    newDecorationCallbacks.delete(blurDecorationCallback);
                    return newDecorationCallbacks;
                });
            });
        };

        const handleBlur = () => {
            const run: (action: () => void) => void = withoutFlushSync
                ? action => action()
                : // We frequently call `focus()` in a `useEffect()`. It's fine if we don't
                  // immediately flush our `isFocused` update in this context.
                  flushSyncIfNotRendering;

            run(() => {
                setIsFocused(false);

                setDecorationCallbacks(decorationCallbacks => {
                    const newDecorationCallbacks = new Set(decorationCallbacks);
                    newDecorationCallbacks.delete(focusDecorationCallback);
                    newDecorationCallbacks.add(blurDecorationCallback);
                    return newDecorationCallbacks;
                });
            });
        };

        if (document.activeElement === viewElement) {
            handleFocus();
        } else {
            handleBlur();
        }

        withoutFlushSync = false;

        viewElement.addEventListener("focus", handleFocus);
        viewElement.addEventListener("blur", handleBlur);
        return () => {
            viewElement.addEventListener("focus", handleFocus);
            viewElement.addEventListener("blur", handleBlur);

            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(focusDecorationCallback);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, []);

    /* ========================================================================== *\
     *                       Phantom selection decorations                        *
    \* ========================================================================== */

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

                    return createPhantomSelectionDecorations(
                        state.doc,
                        TextSelection.between(state.doc.resolve(from), state.doc.resolve(to)),
                        phantomSelection.color,
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

    /* ========================================================================== *\
     *                          Scroll press cancelling                           *
    \* ========================================================================== */

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
    // add listeners at this level and call
    // `dispatchParentScrollWhenPointerDownAndOverEvent()`.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        let isPointerDownAndOverParentScrollReceiver = false;

        const handlePointerDown = (event: PointerEvent) => {
            let hasPointerDownAndOverParentScrollReceiverParent = false;

            {
                let parentElement: HTMLElement | null = event.target as HTMLElement;
                while (parentElement) {
                    if (
                        parentScrollWhenPointerDownAndOverClassNames.some(className =>
                            parentElement!.classList.contains(className),
                        )
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

        const handleDragStart = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        view.dom.addEventListener("pointerdown", handlePointerDown);
        view.dom.addEventListener("pointerup", handlePointerUp);
        view.dom.addEventListener("pointerleave", handlePointerLeave);
        view.dom.addEventListener("pointercancel", handlePointerCancel);
        view.dom.addEventListener("dragstart", handleDragStart);

        const handleScroll = () => {
            if (!isPointerDownAndOverParentScrollReceiver) return;
            isPointerDownAndOverParentScrollReceiver = false;

            for (const element of view.dom.querySelectorAll(
                parentScrollWhenPointerDownAndOverClassNames
                    .map(className => `.${className}`)
                    .join(", "),
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
            view.dom.removeEventListener("dragstart", handleDragStart);

            for (const scrollEventTarget of scrollEventTargets) {
                scrollEventTarget.removeEventListener("scroll", handleScroll, true);
            }
        };
    }, []);

    /* ========================================================================== *\
     *                           Misc render variables                            *
    \* ========================================================================== */

    useContentEditorDebugTools(viewRef);

    const unwrappedState = unwrap(state);

    assert(
        !unwrappedState.schema.nodes.file || fileAttachmentTarget,
        "ProseMirror schema supports files but `fileAttachmentTarget` prop isn't provided",
    );

    const floaterState = state.getFloaterState();

    /* ========================================================================== *\
     *                          Mobile link modal state                           *
    \* ========================================================================== */

    const [mobileLinkModalState, setMobileLinkModalState] =
        useState<ContentEditorMobileLinkModalState | null>(null);
    if (!(isMobile && !withoutMobileKeyboardToolbar) && mobileLinkModalState) {
        setMobileLinkModalState(null);
    }

    /* ========================================================================== *\
     *                         Mobile comment input state                         *
    \* ========================================================================== */

    const [isMobileCommentInputOpen, setIsMobileCommentInputOpen] = useState(false);
    if (
        (!unwrappedState.schema.marks.comment || !(isMobile && !withoutMobileKeyboardToolbar)) &&
        isMobileCommentInputOpen
    ) {
        setIsMobileCommentInputOpen(false);
    }

    const setSelectionAfterMobileCommentInputOpenRef = useRef<Selection | null>(null);

    useLayoutEffect(() => {
        if (!isMobileCommentInputOpen) return;

        const view = assertExists(viewRef.current);

        if (setSelectionAfterMobileCommentInputOpenRef.current) {
            const selection = setSelectionAfterMobileCommentInputOpenRef.current;
            setSelectionAfterMobileCommentInputOpenRef.current = null;

            // Can't call `view.dispatch()` in an effect since it'll call `flushSync()`. So
            // schedule a microtask.
            scheduleMicrotask(() => {
                view.dispatch(view.state.tr.setSelection(selection));
            });
        }

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(state.doc, [
                Decoration.inline(state.selection.from, state.selection.to, {
                    class: commentClassName,
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

    /* ========================================================================== *\
     *                          Code block toolbar state                          *
    \* ========================================================================== */

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

    /* ========================================================================== *\
     *                                   Render                                   *
    \* ========================================================================== */

    return (
        <div
            className={classNames(
                contentEditorStyles.containerClassName,
                !canPrimaryInputHover
                    ? contentEditorStyles.canNotPrimaryInputHoverContainerClassName
                    : undefined,
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
                setDecorationCallbacks={setDecorationCallbacks}
            />
            <ContentEditorFileToolbarController
                state={unwrappedState}
                viewRef={viewRef}
                floaterState={floaterState}
                selectedNodeElement={selectedNodeElement}
                hasFileDropTarget={!!fileDropTarget}
            />
            {!fileDropTarget && selectedNodeElement && (
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
                            setSelectionAfterMobileCommentInputOpenRef.current = setSelection;
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
            {fileDropTarget &&
                (fileDropTarget.indicator === "Top" ? (
                    <Box
                        data-testid={
                            process.env.NODE_ENV !== "production"
                                ? `ContentEditorFileDropTargetIndicator:${fileDropTarget.action.type}:${fileDropTarget.action.pos}`
                                : undefined
                        }
                        position="absolute"
                        left="0"
                        right="0"
                        pointerEvents="none"
                        backgroundColor="theme-40-const"
                        borderRadius="full"
                        style={{
                            left: fileDropTarget.rect.left,
                            right: `calc(100% - ${fileDropTarget.rect.right}px)`,
                            top: fileDropTarget.rect.top - 1,
                            height: 2,
                        }}
                    />
                ) : (
                    <Box
                        data-testid={
                            process.env.NODE_ENV !== "production"
                                ? `ContentEditorFileDropTargetIndicator:${fileDropTarget.action.type}:${fileDropTarget.action.pos}`
                                : undefined
                        }
                        position="absolute"
                        pointerEvents="none"
                        backgroundColor="theme-40-const"
                        borderRadius="full"
                        style={{
                            top: fileDropTarget.rect.top,
                            bottom: `calc(100% - ${fileDropTarget.rect.bottom}px)`,
                            left:
                                fileDropTarget.indicator === "Left"
                                    ? fileDropTarget.rect.left - 1
                                    : fileDropTarget.rect.right - 1,
                            width: 2,
                        }}
                    />
                ))}
        </div>
    );
}

// Inspired by [React internal keys][1].
//
// [1]: https://github.com/facebook/react/blob/80c4dea0d1da0012977c6c4b2ac7a8bd37154d50/packages/react-dom/src/client/ReactDOMComponentTree.js#L34-L41
const internalEditorViewKey = `__prosemirrorEditorView$${Math.random().toString(36).slice(2)}`;

// We export null outside of Jest to avoid breaking fast refresh for
// `<ContentEditor>`.
export const getEditorViewForTest = import.meta.jest
    ? (element: unknown): EditorView => {
          assert(import.meta.jest);
          assert(typeof element === "object" && element !== null);

          const editorView =
              (element as any)[internalEditorViewKey] ??
              (element as any).parentNode?.[internalEditorViewKey];

          assert(editorView instanceof EditorView);
          return editorView;
      }
    : null;

// You shouldn't use `EditorState.selection` or `Transaction.replaceSelection`
// (which implicitly uses `EditorState.selection`) in this function. If we're
// performing an asynchronous paste then the selection we're pasting on top of
// (the `selection` argument) may be different than the user's current
// selection (what's in `EditorState.selection`). Which is why we decompose
// `EditorView` here into just the bits we need.
function handlePaste(
    doc: Node,
    selection: Selection,
    createTransaction: () => Transaction,
    dispatch: (transaction: Transaction) => void,
    event: ClipboardEvent,
    slice: Slice,
): boolean {
    if (handleLinkPasteWithSelection(doc, selection, createTransaction, dispatch, event))
        return true;
    if (handleLinkPasteWithoutSelection(doc, selection, createTransaction, dispatch, event))
        return true;

    // If we're pasting into an empty paragraph at the top level, then paste the
    // entire slice content instead of the content determined by `Slice.maxOpen()`.
    if (
        selection.$from.depth === 1 &&
        selection.$from.parent.type.name === "paragraph" &&
        selection.$from.parent.nodeSize === 2 &&
        selection.$from.pos === selection.$to.pos
    ) {
        const transaction = createTransaction();
        selection.replace(transaction, new Slice(slice.content, 0, slice.openEnd));
        dispatch(transaction);
        return true;
    }

    return false;
}

/**
 * If the user has selected some text and they paste a link then we want to
 * convert the selected text to a link instead of replacing the text.
 */
function handleLinkPasteWithSelection(
    doc: Node,
    selection: Selection,
    createTransaction: () => Transaction,
    dispatch: (transaction: Transaction) => void,
    event: ClipboardEvent,
): boolean {
    // 1. Only perform a link paste if we've selected some text.
    if (selection.from === selection.to) {
        return false;
    }

    // 2. Make sure the URL starts with an allowed protocol.
    const url = event.clipboardData?.getData("text/plain");
    if (!url || !startsWithSafeUrlProtocol(url) || /\s/.test(url)) {
        return false;
    }

    // 3. Instead of replacing the selected text with the replaced text we instead
    // add a link mark to the selection.
    const range = trimSpacesFromProsemirrorRange(doc, selection);
    dispatch(
        createTransaction().addMark(range.from, range.to, doc.type.schema.mark("link", {url})),
    );
    return true;
}

function handleLinkPasteWithoutSelection(
    doc: Node,
    selection: Selection,
    createTransaction: () => Transaction,
    dispatch: (transaction: Transaction) => void,
    event: ClipboardEvent,
): boolean {
    const {from} = selection;

    // 1. Check if current selection is empty
    if (!selection.empty) {
        return false;
    }

    // 2. Make sure the URL exists, starts with an allowed protocol and contains no whitespace.
    const url = event.clipboardData?.getData("text/plain");
    if (!url || !startsWithSafeUrlProtocol(url) || /\s/.test(url)) {
        return false;
    }

    // 3. Insert URL text and apply link mark
    const transaction = createTransaction();
    transaction.insertText(url, from);
    transaction.addMark(from, from + url.length, doc.type.schema.mark("link", {url}));
    dispatch(transaction);
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
function createPhantomSelectionDecorations(doc: Node, selection: Selection, color: ThemeColor) {
    // Convert non-text selections into text selections. So the `from` and `to`
    // point to positions in text.
    if (!(selection instanceof TextSelection)) {
        selection = TextSelection.between(selection.$from, selection.$to);
    }

    const decorations = [
        Decoration.inline(selection.from, selection.to, {
            class: contentStyles.phantomSelectionClassName,
            style: `background-color:${colorSchemeVars[`${color}-selection`]}`,
        }),
    ];

    // Add newline indicators to the end of selected paragraphs and headers like
    // browser selection styles.
    //
    // Particularly important to show we've selected an empty paragraph or header.
    //
    // Also give selected files a tint so other users know when they're selected.
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (node.type.name === "file") {
            decorations.push(
                Decoration.node(pos, pos + 1, {
                    class: contentStyles.selectionFileClassNameByColor[color],
                }),
            );
            return;
        }

        if (!node.inlineContent) return;

        const newlineIndicatorPos = pos + node.content.size + 1;
        if (newlineIndicatorPos >= selection.to) return;

        decorations.push(
            Decoration.widget(newlineIndicatorPos, () => {
                const newlineIndicatorElement = document.createElement("span");
                newlineIndicatorElement.textContent = " ";
                newlineIndicatorElement.className = contentStyles.phantomSelectionClassName;
                newlineIndicatorElement.style.backgroundColor =
                    colorSchemeVars[`${color}-selection`];
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
                    class: contentStyles.emojiClassName,
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
