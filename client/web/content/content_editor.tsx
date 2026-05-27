import classNames from "classnames";
import {closeHistory, history, redo, redoDepth, undo, undoDepth} from "prosemirror-history";
import {Fragment, Node, Schema as ProsemirrorSchema, ResolvedPos, Slice} from "prosemirror-model";
import {
    AllSelection,
    EditorState,
    NodeSelection,
    PluginKey,
    Selection,
    TextSelection,
    Transaction,
} from "prosemirror-state";
import {ReplaceAroundStep, ReplaceStep, dropPoint} from "prosemirror-transform";
import {
    Decoration,
    DecorationSet,
    DirectEditorProps,
    EditorView,
    __scrollRectIntoView as scrollRectIntoView,
    __serializeForClipboard as serializeForClipboard,
} from "prosemirror-view";
import {
    FocusEvent,
    Key,
    Memo,
    PropsWithoutRef,
    ReactElement,
    Ref,
    RefAttributes,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {useContentBlockWidth} from "~/client/web/content/content_block_width.js";
import {
    ContentFileEntityRenderers,
    ContentFileEntityRenderersContext,
} from "~/client/web/content/content_file_entity_renderers_context.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {createContentEditorCheckListItemNodeViewConstructor} from "~/client/web/content/internal/content_editor_check_list_item_node_view.js";
import {ContentEditorCodeBlockLanguagePickerComboBox} from "~/client/web/content/internal/content_editor_code_block_language_picker_combo_box.js";
import {createContentEditorCodeBlockNodeViewConstructor} from "~/client/web/content/internal/content_editor_code_block_node_view.js";
import {createContentEditorCommentMarkViewConstructor} from "~/client/web/content/internal/content_editor_comment_mark_view.js";
import {ContentEditorDatePickerOverlay} from "~/client/web/content/internal/content_editor_date_picker_overlay.js";
import {ContentEditorDomClipboardSerializer} from "~/client/web/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/web/content/internal/content_editor_dom_parser.js";
import {createContentEditorFileFloatNodeViewConstructor} from "~/client/web/content/internal/content_editor_file_float_node_view.js";
import {createContentEditorFileNodeViewConstructor} from "~/client/web/content/internal/content_editor_file_node_view.js";
import {createContentEditorFileRowLikeNodeViewConstructor} from "~/client/web/content/internal/content_editor_file_row_like_node_view.js";
import {ContentEditorFileToolbarController} from "~/client/web/content/internal/content_editor_file_toolbar.js";
import {ContentEditorFloater} from "~/client/web/content/internal/content_editor_floater.js";
import {
    findInsertedNodeAfterReplaceRangeWith,
    insertContentCheckListItem,
    insertContentCodeBlock,
    insertContentDivider,
    insertContentFiles,
    insertContentHeading,
    insertContentOrderedListItem,
    insertContentQuoteBlock,
    insertContentTable,
    insertContentUnorderedListItem,
    isContentTableBlockNode,
} from "~/client/web/content/internal/content_editor_insert.js";
import {createContentEditorLinkMarkViewConstructor} from "~/client/web/content/internal/content_editor_link_mark_view.js";
import {ContentEditorMentionFloaterSectionOrder} from "~/client/web/content/internal/content_editor_mention_floater.js";
import {createContentEditorMentionNodeViewConstructor} from "~/client/web/content/internal/content_editor_mention_node_view.js";
import {ContentEditorMobileCommentInputBottomBar} from "~/client/web/content/internal/content_editor_mobile_comment_input_bottom_bar.js";
import {ContentEditorMobileKeyboardToolbar} from "~/client/web/content/internal/content_editor_mobile_keyboard_toolbar.js";
import {
    ContentEditorMobileLinkModal,
    ContentEditorMobileLinkModalState,
} from "~/client/web/content/internal/content_editor_mobile_link_modal.js";
import {createContentEditorOrderedListItemNodeView} from "~/client/web/content/internal/content_editor_ordered_list_item_node_view.js";
import {ContentEditorPhantomSelectionCursor} from "~/client/web/content/internal/content_editor_phantom_selection_cursor.js";
import {ContentEditorSpellChecker} from "~/client/web/content/internal/content_editor_spell_checker.js";
import {contentEditorTextClipboardSerializer} from "~/client/web/content/internal/content_editor_text_clipboard_serializer.js";
import {handleCopyContentFile} from "~/client/web/content/internal/content_file_preview.js";
import {
    ContentEditorFileDropTarget,
    getContentEditorFileDropTargets,
} from "~/client/web/content/internal/get_content_editor_file_drop_targets.js";
import {getContentEditorInsertMenuActions} from "~/client/web/content/internal/get_content_editor_insert_menu_actions.js";
import {isGiphyEnabled, preloadGiphyTrending} from "~/client/web/content/internal/giphy_fetch.js";
import {
    FileInfo,
    FileInfoWithEntity,
    iterateFileInfosInElement,
} from "~/client/web/content/internal/iterate_file_infos_in_element.js";
import {createContentEditorTableNodeView} from "~/client/web/content/internal/table/content_editor_table_node_view.js";
import {uploadFile} from "~/client/web/content/internal/upload_file.js";
import {useContentEditorDebugTools} from "~/client/web/content/internal/use_content_editor_debug_tools.js";
import {
    ContentEditorDateDecorationMatch,
    getContentEditorDateMatchAtPos,
} from "~/client/web/content/state/content_editor_date_decoration_plugin.js";
import {openContentEditorCommentInputFloaterMetaKey} from "~/client/web/content/state/content_editor_meta_keys.js";
import {ContentSpellCheckSuggestion} from "~/client/web/content/state/content_editor_spell_checker_configuration.js";
import {getContentEditorSpellCheckerLints} from "~/client/web/content/state/content_editor_spell_checker_plugin.js";
import {
    ContentEditorReferencesSharedAction,
    ContentEditorState,
    getContentEditorFloaterState,
    getContentEditorReferences,
    rememberContentEditorPosWhileLoading,
    rememberContentEditorSelectionWhileLoading,
    setContentEditorFloaterState,
    updateContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {
    dispatchParentScrollWhenPointerDownAndOverEvent,
    parentScrollWhenPointerDownAndOverClassNames,
} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {
    isPosInContentTable,
    isSelectionInContentTable,
} from "~/client/web/content/state/table/content_table_client_util.js";
import {handleContentTablePaste} from "~/client/web/content/state/table/content_table_input.js";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/web/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {AppContext, useAppContextIfExists} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {addContextMenuActions} from "~/client/web/design/context_menu.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuActionsSection} from "~/client/web/design/menu.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {
    dispatchTriggeredOverlayCloseEvent,
    dispatchTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {getElementSafeAreaInsetTopPx} from "~/client/web/design/safe_area_inset.js";
import {flushScrollbarResizeSync} from "~/client/web/design/scrollbar.js";
import {Tooltip, TooltipRef} from "~/client/web/design/tooltip.js";
import {useIsBehindMobileFullScreenModal} from "~/client/web/design/use_is_behind_mobile_full_screen_modal.js";
import {textInputVisibilityMaintainerMarginYRem} from "~/client/web/design/use_text_input_visibility_maintainer.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {isVirtualKeyboardEvent} from "~/client/web/helpers/events/is_virtual_keyboard_event.js";
import {flushSyncIfNotRendering} from "~/client/web/helpers/flush_sync_if_not_rendering.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";

import {getClientInfo, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {
    getPlatformWithoutListening,
    useCanPrimaryInputHover,
    usePlatform,
} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/web/remix/use_is_inert_native_mobile_route.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useIdlyPreloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContextIfExists} from "~/client/web/spaces/space_context.js";
import {
    contentEditorStyles,
    contentStyles,
    selectionColorSchemeVars,
} from "~/client/web/styles/styles.js";
import {getSynchronizedSystemClock} from "~/client/web/tracer/synchronized_system_clock.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {formatDateInOriginalFormat} from "~/shared/content/content_editor_date_format.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    getContentReferencedIdsForSlice,
    isEmptyContentReferencedIds,
} from "~/shared/content/content_referenced_ids.js";
import {
    ContentWithReferences,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {
    commentClassName,
    fileClassName,
    linkClassName,
} from "~/shared/design/core/constant_class_names.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModel} from "~/shared/files/file_model.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {getUrlRegExp} from "~/shared/helpers/string/url_reg_exp.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {generateChronologicalIdWithTime} from "~/shared/id/chronological_id.js";
import {Id, generateId, isId} from "~/shared/id/id.js";
import {AccountId, DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {getContentReferencesWithoutFiles} from "~/shared/rpc/content_rpc_definitions.js";
import {
    attachFileAsUploader,
    attachFileFromAttachment,
    getFileFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";
import {isSearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {hasDatePickerFeature} from "~/shared/spaces/has_date_picker_feature.js";
import {hasGifPickerFeature} from "~/shared/spaces/has_gif_picker_feature.js";
import {ValueStore} from "~/shared/store/value_store.js";

// TODO(calebmer, #mobile-webkit-weirdness): Safari doesn't support
// `ascent-override` and `descent-override` which means our phantom selection or
// comment highlights an emoji the top looks ragged instead of straight.
// https://bugs.webkit.org/show_bug.cgi?id=219735

// TODO(calebmer): We set `spellcheck="false"` but if you tap on a word that Safari
// would have put a red squiggle under then replacement words appear. This is
// confusing to users since it's unclear why this list would appear.
// `autocorrect="false"` turns this off but it also turns off typing correction
// which we don't want.
// https://stackoverflow.com/questions/78022279/ios-safari-when-contenteditable-true-and-spellcheck-false-clicking-on-a-word-tha
//
// After much debugging I've narrowed the issue down to
// `UITextInputTraits.autocorrectionType`. If I manually set
// `UITextInputTraits.autocorrectionType = .no` (with swizzling, see
// `swizzleWKWebView()`) it turns off both predictive input on the keyboard and the
// tap to show corrections behavior I don't like. So looks like these two behaviors
// are tied together in Apple's private text input code. Unfortunate.
// https://developer.apple.com/documentation/uikit/uitextinputtraits/1624453-autocorrectiontype
//
// I know it should be possible to get the behavior I want since Google Docs has
// figured it out. (Though I don't think they use `WKWebView`.)
//
// Arguably this behavior is good and should be left in. I don't think so since
// users may accidentally click on a word that makes sense to them and get this
// menu which could be frustrating. Long term we also plan on implementing our own
// spell checking. So the conflicting spell checking is unfortunate.

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
    getContainerElement(): HTMLDivElement;
    getEditorElement(): HTMLDivElement;
    getState(): ContentEditorState<Content>;
    isFocused(): boolean;
    focus(options?: FocusOptions): void;
    blur(): void;

    /**
     * Does the editor contain the provided element? Only checks for children of the
     * `contenteditable` editor. Doesn't check siblings of the editor.
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
     * Execute the ProseMirror undo command.
     */
    undo(): void;

    /**
     * Execute the ProseMirror redo command.
     */
    redo(): void;

    /**
     * Insert an unordered list item node.
     */
    insertUnorderedListItem(): void;

    /**
     * Insert an ordered list node.
     */
    insertOrderedListItem(): void;

    /**
     * Insert a check list node.
     */
    insertCheckListItem(): void;

    /**
     * Insert a heading node.
     */
    insertHeading(level: 1 | 2 | 3): void;

    /**
     * Insert a divider node.
     */
    insertDivider(): void;

    /**
     * Insert a quote block node.
     */
    insertQuoteBlock(): void;

    /**
     * Insert a code block node.
     */
    insertCodeBlock(): void;

    /**
     * Insert some files into the document as file row nodes. Generally these files are
     * generally taken from an `<input type="file">` element.
     */
    insertFiles(files: ReadonlyArray<File>): void;

    /**
     * Insert a file from a URL. The server downloads the file from the URL instead of
     * requiring a client-side upload.
     */
    insertFileFromUrl(url: URL): void;

    /**
     * Insert a table node.
     */
    insertTable(): void;

    /**
     * Set the `hasPresentShortcut` attribute.
     */
    setHasPresentShortcut(hasPresentShortcut: boolean): void;

    /**
     * Set the `cover` attribute.
     */
    setCover(cover: DocumentContentCover | null): void;

    /**
     * If we're in a mobile environment and `withoutMobileKeyboardToolbar` is false
     * then calling this function opens the comment input for the current selection. If
     * the selection is empty nothing happens.
     */
    openMobileKeyboardToolbarCommentInputIfPossible(): void;

    /**
     * Open the GIF picker floater. Only works when `onSelectGif` is provided.
     */
    openGifPicker(): void;

    /**
     * Get the internal ProseMirror editor view object. Prefer the public methods on
     * this ref that provide a constrained, safe, interface. But this escape hatch is
     * available if necessary.
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
     * The current state of our content editor.
     *
     * Mostly the content editor state is a wrapper around ProseMirror's immutable
     * `EditorState` with some type safety and helper functions.
     */
    state: ContentEditorState<Content>;

    /**
     * Fired whenever the content editor's state changes.
     *
     * Every state change will be optimistically synchronously applied to the DOM. If
     * you don't re-render with the new state then that optimistic update will be
     * reverted.
     */
    onChange: (
        state: ContentEditorState<Content>,
        // We send the transaction on change in case the parent wants to respond to some
        // specific action taken in the transaction.
        transaction: Transaction,
    ) => void;

    /**
     * Placeholder text to render in the editor when there is no other content.
     */
    placeholder?: string;

    /**
     * The class name we'll apply to the content editable `<div>`.
     */
    className?: string;

    /**
     * A subset of `React.CSSProperties` we'll apply to the content editable `<div>`.
     */
    style?: {
        minHeight?: RemLength | number;
        paddingTop?: RemLength | number;
        paddingBottom?: RemLength | number;
        paddingLeft?: RemLength | number;
        paddingRight?: RemLength | number;
        borderRadius?: RemLength | number;
    };

    /**
     * The class name we'll apply to the `<div>` containing the content editable
     * `<div>`. We need a container `<div>` (unfortunately) to have an element to mount
     * ProseMirror editor within given the ProseMirror editor is not a React component.
     */
    containerClassName?: string;

    /**
     * The access level to use for this content editor. If "View" then the editor will
     * be in readonly mode and not allow changes. In "Comment" mode, we also won't
     * allow changes except to add new comment threads.
     *
     * If undefined then we assume you have the highest access level possible.
     */
    accessLevel?: AccessLevel;

    /**
     * Don't render the mobile keyboard toolbar with this content editor. Use this if
     * you render your own toolbar outside the `<ContentEditor>`. `<MessageInput>` is a
     * component that does this.
     */
    withoutMobileKeyboardToolbar?: boolean;

    /**
     * Disable dual modality editing on devices that don't have a primary input that
     * can hover (our mobile apps). The content editor will always be in our mobile
     * editing state and never our mobile interactive state. e.g. So links won't be
     * pressable.
     */
    withoutMobileDualModality?: boolean;

    /**
     * The order of sections in the mention menu when there's no search query.
     *
     * - `PeopleSuggestedInsert`: People section first, then Suggested, then Insert.
     *   This is the default, use for message inputs, post inputs, etc.
     * - `InsertSuggestedPeople`: Insert section first, then Suggested, then People.
     *   Use this for document content editors.
     * - `SuggestedInsertPeople`: Suggested section first, then Insert, then People.
     *   Use this for task notes content editors.
     *
     * When there is a search query, the order is always: Insert, People, Other.
     *
     * Defaults to `PeopleSuggestedInsert`.
     */
    mentionFloaterSectionOrder?: ContentEditorMentionFloaterSectionOrder;

    /**
     * If the content editor supports files then you must pass in
     * `FileAttachmentTarget`. This prop is used:
     *
     * 1. Before adding a file to content we need to call either
     *    `attachFileAsUploader()` or `attachFileFromAttachment()` to make sure
     *    everyone who has access to the attachment target has access to the file. We
     *    use the attachment target to create the correct link.
     *
     * 2. When refreshing expired signed preview URLs we need the attachment target so
     *    we can prove the current account has access to the file.
     *
     * An error will be thrown if your content supports files but doesn't provide
     * `fileAttachmentTarget`.
     */
    fileAttachmentTarget?: Memo<FileAttachmentTarget>;

    /**
     * If the content editor supports comments then you must pass in
     * `FileAttachmentTarget` for its comments. This prop is used in a similar way to
     * the `fileAttachmentTarget` prop but just for comments.
     */
    commentFileAttachmentTarget?: Memo<FileAttachmentTarget>;

    /**
     * Sometimes, we'll pass in an optimistic `fileAttachmentTarget` that hasn't been
     * created yet. For example, when you click "Create document" we open a blank
     * document but the document isn't actually created until you start typing in it.
     *
     * Call this function to ensure the `fileAttachmentTarget` exists so you can
     * properly attach files to it.
     */
    onEnsureFileAttachmentTarget?: () => Promise<void>;

    /**
     * Phantom text selections decorations that render on top of the editor and
     * represent the cursor position of other users.
     */
    phantomSelections?: ReadonlyArray<ContentEditorPhantomSelection>;

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
     * Called when the selection enters the content editor. This works regardless of
     * the `accessLevel`. If the `accessLevel` is `View` then we'll still call this
     * function even though the editor isn't editable.
     */
    onSelectionEnter?: () => void;

    /**
     * Called when the selection leaves the content editor. This works regardless of
     * the `accessLevel`. If the `accessLevel` is `View` then we'll still call this
     * function even though the editor isn't editable.
     */
    onSelectionLeave?: () => void;

    /**
     * Fired when the user presses enter in a content editor.
     *
     * Providing an `onEnterKeyDownFromPhysicalKeyboard` callback will prevent the
     * default enter behavior. It will also switch our editor out of multiline mode for
     * assistive technologies.
     *
     * Pressing shift+enter has the same behavior as pressing enter as a workaround.
     * Pressing alt+enter will insert a hard line break and won't trigger this
     * callback. Pasting in content with multiple paragraphs also allows you to add
     * multiple lines. So providing `onEnterKeyDownFromPhysicalKeyboard` doesn't make
     * our editor fully single lined.
     */
    onEnterKeyDownFromPhysicalKeyboard?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user press cmd-enter (or ctrl-enter on non MacOS platforms) in a
     * content editor.
     *
     * Providing an `onModEnterKeyDown` callback will prevent the default enter
     * behavior.
     */
    onModEnterKeyDown?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user presses the escape key.
     */
    onEscapeKeyDown?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user presses the up arrow key.
     */
    onArrowUpKeyDown?: (event: KeyboardEvent) => void;

    /**
     * Opens a comment thread when clicked. If your schema supports comment marks you
     * must provide this function to open them. `<ContentEditor>` knows almost nothing
     * about how comments are implemented, only how they are styled.
     */
    openCommentThread?: (commentThreadId: DocumentCommentThreadId) => Promise<void>;

    /**
     * When a pointer presses down on a comment thread this function is called.
     * `openCommentThread` is called when a press is considered a click. (So pointer up
     * and the pointer hasn't moved off.) Our parent component is responsible for
     * updating the styles of all marks for this comment thread using
     * `commentActiveDynamicCssTemplate`.
     */
    onCommentThreadPressedChange?: (
        commentThreadId: DocumentCommentThreadId,
        isHovered: boolean,
    ) => void;

    /**
     * Called when an undo stack entry is added. If you're managing undo/redo keyboard
     * shortcuts you'll need to push to our own stack when this is called.
     */
    onUndoStackEntryPushed?: () => void;

    /**
     * Called when an undo stack entry is added during a redo command. This needs to
     * behave a bit differently than `onUndoStackEntryPushed()` since it shouldn't
     * reset the redo stack.
     *
     * If you're managing undo/redo keyboard shortcuts you'll need to push to our own
     * stack when this is called.
     */
    onUndoStackEntryPushedFromRedo?: () => void;

    /**
     * Called when a redo stack entry is added. If you're managing undo/redo keyboard
     * shortcuts you'll need to push to our own stack when this is called.
     */
    onRedoStackEntryPushed?: () => void;

    /**
     * If the content schema used by this `<ContentEditor>` doesn't support files then
     * we'll call this callback on a paste or drop that includes files to let the
     * parent component handle files however it wants.
     *
     * For example `MessageContent` doesn't support files but `<MessageInput>` does
     * allow attaching files to a message.
     *
     * This is also called when selecting a file entity mention on an empty line in
     * content that doesn't support file nodes.
     */
    onPasteOrDropFiles?: (
        fileInfos: ReadonlyArray<FileInfoWithEntity>,
    ) => SafeFloatingPromise<void>;

    /**
     * Called when the user selects a GIF from the picker. When provided, the GIF
     * insert action appears in menus.
     */
    onSelectGif?: (url: URL) => void;

    /**
     * Custom `isBodyEmpty` prop. We'll consider the body empty if
     * `isContentBodyEmpty()` is true or this function is true.
     */
    isBodyEmpty?: boolean;

    /**
     * This is a required prop on any content editor that can have spell checks
     * ignored. If that is not needed, do not provide this prop.
     */
    spellCheckIgnoredLints?: Iterable<{
        key: string;
        kind: string;
    }>;

    /**
     * This is a required prop on any content editor that can have spell checks
     * ignored. If that is not needed, do not provide this prop.
     */
    onSpellCheckIgnoreLint?: (lint: {key: string; kind: string}) => Promise<void>;

    /**
     * If the user `mousedown`s at the end of the content editor (below the last item)
     * should we create a new paragraph and move the selection there? False by default.
     * Only true for `<DocumentContentEditor>` right now.
     */
    withMouseDownAtEndCreatesParagraph?: boolean;

    /**
     * By default when we scroll content into view we include enough space at the top
     * of the scroll view to fit a navigation bar in case we're in a route with
     * `useNavigationBar()`. However, if you're building a message input (or any input
     * with internal scrolling) then if you're scrolling to show some content then
     * there's no navigation bar to avoid.
     *
     * Use this if you have a `<ContentEditor>` in an input with its own scroll area
     * (like a message input). If the `<ContentEditor>` is a part of some parent scroll
     * area (generally the route scroll area) then leaving this as `false` is probably
     * the best idea.
     */
    withoutNavigationBarScrollMarginTop?: boolean;
} & (
    | {
          /**
           * A label exposed to assistive technology (through `aria-label`) when there is no
           * visible label for the element.
           */
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          /**
           * A reference to another element (through `aria-labelledby`) with a visible label
           * for this element.
           */
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
);

export type ContentEditorPhantomSelection = {
    readonly key: string;
    readonly color: ThemeColor;
    readonly $anchor: ResolvedPos;
    readonly $head: ResolvedPos;
    readonly isTextSelection: boolean;
};

// When server-side rendering (initial app render), we render as a `<ContentView>`
// then once React hydrates on the client we switch out the non-editable
// `<ContentView>` for an editable `<ContentEditor>` component.
function ContentEditorWrapper<Content extends ContentWithReferences>(
    props: ContentEditorProps<Content>,
    ref: Ref<ContentEditorRef<Content>>,
) {
    const isInitialAppRender = useIsInitialAppRender();
    const spaceContext = useSpaceContextIfExists();

    // Preload space accounts and search affinity items so when the user tries to
    // mention one they are available.
    //
    // Only preload outside of Jest unit tests! That way we don't depend on space
    // context in unit tests.
    if (!import.meta.jest) {
        // eslint-disable-next-line react-compiler/react-compiler
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useIdlyPreloadRpc(
            expensivelyGetAllSpaceAccounts,
            // If the actor doesn't have space access then don't preload all space accounts
            // since we'll get a `PermissionDeniedError` anyway.
            spaceContext?.currentAccount ? {spaceId: spaceContext.space.id} : null,
        );

        // eslint-disable-next-line react-compiler/react-compiler
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useIdlyPreloadRpc(
            searchByAffinity,
            // If the actor doesn't have space access then don't preload the affinity list
            // since we'll get a `PermissionDeniedError` anyway.
            spaceContext?.currentAccount ? {spaceId: spaceContext.space.id} : null,
        );
    }

    if (isInitialAppRender) {
        return <ContentEditorInitialAppRender {...props} editorRef={ref} />;
    } else {
        return <ContentEditor {...props} editorRef={ref} />;
    }
}

function ContentEditorInitialAppRender<Content extends ContentWithReferences>({
    state,
    placeholder,
    className,
    style,
    accessLevel = "Manage",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    containerClassName: customContainerClassName,
    fileAttachmentTarget,
    editorRef,
}: ContentEditorProps<Content> & {editorRef: Ref<ContentEditorRef<Content>>}) {
    const canPrimaryInputHover = useCanPrimaryInputHover();

    const containerRef = useRef<HTMLDivElement>(null);

    const hasEditAccessLevel = hasAccessLevel(accessLevel, "Edit");

    useImperativeHandle(editorRef, () => {
        const unimplementedDispatchCommand = () => {
            throw new UnimplementedError(
                "Dispatching a content editor command on initial render is not implemented",
            );
        };

        return {
            getContainerElement: () => assertExists(containerRef.current),
            getEditorElement: () =>
                assertExists(containerRef.current?.firstElementChild) as HTMLDivElement,
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
            undo: unimplementedDispatchCommand,
            redo: unimplementedDispatchCommand,
            insertUnorderedListItem: unimplementedDispatchCommand,
            insertOrderedListItem: unimplementedDispatchCommand,
            insertCheckListItem: unimplementedDispatchCommand,
            insertHeading: unimplementedDispatchCommand,
            insertDivider: unimplementedDispatchCommand,
            insertQuoteBlock: unimplementedDispatchCommand,
            insertCodeBlock: unimplementedDispatchCommand,
            insertFiles: unimplementedDispatchCommand,
            insertFileFromUrl: unimplementedDispatchCommand,
            insertTable: unimplementedDispatchCommand,
            setHasPresentShortcut: unimplementedDispatchCommand,
            setCover: unimplementedDispatchCommand,
            openMobileKeyboardToolbarCommentInputIfPossible: () => {
                throw new UnimplementedError(
                    "Opening the content editor\u2019s mobile keyboard toolbar comment input on initial render is not implemented",
                );
            },
            openGifPicker: () => {
                throw new UnimplementedError(
                    "Opening the GIF picker on initial render is not implemented",
                );
            },
            _getInternalView: () => {
                throw new UnimplementedError(
                    "Getting internal ProseMirror view on initial render is not implemented",
                );
            },
        };
    }, [state]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                contentEditorStyles.containerClassName,
                !canPrimaryInputHover
                    ? contentEditorStyles.canNotPrimaryInputHoverContainerClassName
                    : undefined,
                !hasEditAccessLevel ? contentEditorStyles.hasNoEditAccessClassName : undefined,
                customContainerClassName,
            )}
        >
            <ContentView
                content={state.getContent()}
                placeholder={placeholder}
                className={className}
                style={style}
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
        style,
        containerClassName: customContainerClassName,
        accessLevel = "Manage",
        withoutMobileKeyboardToolbar,
        withoutMobileDualModality,
        mentionFloaterSectionOrder = "PeopleSuggestedInsert",
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        onFocus,
        onFocusCapture,
        onBlur,
        phantomSelections,
        fileAttachmentTarget,
        commentFileAttachmentTarget,
        onPasteOrDropFiles,
        onSelectGif,
        isBodyEmpty: isBodyEmptyFromProps,
        onSpellCheckIgnoreLint,
        spellCheckIgnoredLints,
    } = props;

    assert(
        (onSpellCheckIgnoreLint === undefined && spellCheckIgnoredLints === undefined) ||
            (onSpellCheckIgnoreLint !== undefined && spellCheckIgnoredLints !== undefined),
        "When providing `onSpellCheckIgnoreLint` you must also provide `spellCheckIgnoredLints` and vice versa.",
    );

    const hasEditAccessLevel = hasAccessLevel(accessLevel, "Edit");

    /* ========================================================================== *\
     *                                  Context                                   *
    \* ========================================================================== */

    const context = useAppContextIfExists();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const reporter = useReporter();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const clientInfo = useClientInfo();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const spaceContext = useSpaceContextIfExists();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;
    const fileEntityRenderers = useContext(ContentFileEntityRenderersContext);
    const blockWidth = useContentBlockWidth();
    const isGifPickerEnabled =
        !!onSelectGif &&
        !!spaceContext &&
        hasGifPickerFeature(spaceContext.space.id) &&
        isGiphyEnabled();

    const isDatePickerDisabled =
        typeof window !== "undefined" && localStorage.getItem("disableDatePicker") === "true";
    const hasDatePickerUiFeature =
        spaceContext !== null && !isDatePickerDisabled
            ? hasDatePickerFeature(spaceContext.space.id)
            : false;

    // We choose our interaction mode based on whether the device's primary input can
    // hover. This is true on a laptop (e.g. MacOS) and false on a phone (e.g. iOS).
    // Haven't tested this with an iPad. Ideally it's true when a hardware trackpad is
    // connected and false when it's not.
    //
    // The difference between `platform` and `isDualModality` can be a bit confusing.
    //
    // - On desktop, `isDualModality` is always false. `platform` will be true if the
    //   window is small but usually will be false (since we don't recommend small
    //   windows on desktop).
    //
    // - On an iPhone, document content editors are `platform = "mobile"` and
    //   `isDualModality = true`. However, message inputs are `platform = "mobile"` and
    //   `isDualModality = false`. Message inputs disable dual modality editing with
    //   `withoutMobileDualModality = true`.
    //
    // - This isn't implemented yet but on an iPad we should have
    //   `platform = "desktop"` (since it's big enough for our desktop screen size) and
    //   should have `isDualModality = true` if there's no hardware keyboard but
    //   `isDualModality = false` if there is a hardware keyboard. If the user is
    //   primarily using the iPad via touch it should behave more like an iPhone than a
    //   laptop.
    const isDualModality = !canPrimaryInputHover && !withoutMobileDualModality;

    /* ========================================================================== *\
     *                                 Prop refs                                  *
    \* ========================================================================== */

    // The props for the current React commit. We are integrating with a stateful
    // component (ProseMirror's `EditorView`) so we need to be able to imperatively
    // access props.
    //
    // Importantly, we set this in a `useInsertionEffect` instead of render! If we set
    // in render and concurrent React cancels/rebases/retries the render then there may
    // be bugs.
    //
    // Please avoid using `propsRef` unless you can thoroughly reason through why it's
    // safe!
    const propsRef = useRef(props);
    const routeLayoutRef = useRef(routeLayout);
    const canPrimaryInputHoverRef = useRef(canPrimaryInputHover);
    const isDualModalityRef = useRef(isDualModality);
    const rootNavigateRef = useRef(rootNavigate);
    const navigateRef = useRef(navigate);
    const reporterRef = useRef(reporter);
    const contextRef = useRef(context);
    const addGlobalLoadingIndicatorRef = useRef(addGlobalLoadingIndicator);
    const spaceContextRef = useRef(spaceContext);
    const blockWidthRef = useRef(blockWidth);

    const fileEntityRenderersRef = useRef<
        ContentFileEntityRenderers | null | ValueStore<ContentFileEntityRenderers | null>
    >(fileEntityRenderers);

    // If we're in a hot reloading environment then `fileEntityRenderersRef` should be
    // a store so that when it changes any files are re-rendered. In production, the
    // file renderers object is a constant that never changes.
    if (
        import.meta.hot &&
        !(fileEntityRenderersRef.current !== null && "set" in fileEntityRenderersRef.current)
    ) {
        fileEntityRenderersRef.current = new ValueStore(fileEntityRenderersRef.current);
    }

    useInsertionEffect(() => {
        propsRef.current = props;
        routeLayoutRef.current = routeLayout;
        canPrimaryInputHoverRef.current = canPrimaryInputHover;
        isDualModalityRef.current = isDualModality;
        rootNavigateRef.current = rootNavigate;
        navigateRef.current = navigate;
        reporterRef.current = reporter;
        contextRef.current = context;
        addGlobalLoadingIndicatorRef.current = addGlobalLoadingIndicator;
        spaceContextRef.current = spaceContext;
        blockWidthRef.current = blockWidth;

        if (
            import.meta.hot &&
            fileEntityRenderersRef.current !== null &&
            "set" in fileEntityRenderersRef.current
        ) {
            fileEntityRenderersRef.current.set(fileEntityRenderers);
        } else {
            fileEntityRenderersRef.current = fileEntityRenderers;
        }
    });

    /* ========================================================================== *\
     *                                    Refs                                    *
    \* ========================================================================== */

    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
              insertFileFromUrl: (url: URL) => void;
          })
        | null
    >(null);
    const lastTransactionRef = useRef<Transaction | null>(null);
    const referencesUpdateEmitterRef = useRef<EventEmitter | null>(null);
    const tripleClickDragStateRef = useRef<ContentEditorTripleClickDragState | null>(null);
    const draggingFileRef = useRef<{getPos: () => number | null} | null>(null);

    /* ========================================================================== *\
     *                               Component ref                                *
    \* ========================================================================== */

    const openGifPicker = useCallback(() => {
        if (!isGifPickerEnabled) return;
        const view = assertExists(viewRef.current);
        view.dispatch(setContentEditorFloaterState(view.state.tr, {type: "GifPicker"}));
    }, [isGifPickerEnabled]);

    useImperativeHandle(
        editorRef,
        () => ({
            getContainerElement: () => {
                return assertExists(containerRef.current);
            },
            getEditorElement: () => {
                return assertExists(viewRef.current).dom as HTMLDivElement;
            },
            getState: () => {
                return propsRef.current.state;
            },
            isFocused: () => {
                const view = assertExists(viewRef.current);
                return document.activeElement === view.dom;
            },
            focus: (options?: FocusOptions) => {
                // If we're in dual modality mode then we need to set our focused state before the
                // editor is focusable at all.
                //
                // This is a little strange. See the same line of code in our `touchstart` handler
                // (around `touchState`'s `finish` function) for a more thorough explanation of
                // what's happening here.
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
            undo: () => {
                const view = assertExists(viewRef.current);
                undo(view.state, view.dispatch, view);
            },
            redo: () => {
                const view = assertExists(viewRef.current);
                redo(view.state, view.dispatch, view);
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
            openGifPicker,
            insertUnorderedListItem: () =>
                insertContentUnorderedListItem(assertExists(viewRef.current)),
            insertOrderedListItem: () =>
                insertContentOrderedListItem(assertExists(viewRef.current)),
            insertCheckListItem: () => insertContentCheckListItem(assertExists(viewRef.current)),
            insertHeading: level => insertContentHeading(assertExists(viewRef.current), level),
            insertDivider: () => insertContentDivider(assertExists(viewRef.current)),
            insertQuoteBlock: () => insertContentQuoteBlock(assertExists(viewRef.current)),
            insertCodeBlock: () => insertContentCodeBlock(assertExists(viewRef.current)),
            insertFiles: files => insertContentFiles(assertExists(viewRef.current), files),
            insertFileFromUrl: url => assertExists(viewRef.current).insertFileFromUrl(url),
            insertTable: () => insertContentTable(assertExists(viewRef.current)),
            setHasPresentShortcut: hasPresentShortcut => {
                const view = assertExists(viewRef.current);
                view.dispatch(
                    view.state.tr.setDocAttribute("hasPresentShortcut", hasPresentShortcut),
                );
            },
            setCover: cover => {
                const view = assertExists(viewRef.current);
                view.dispatch(view.state.tr.setDocAttribute("cover", cover));
            },
            _getInternalView: () => {
                return assertExists(viewRef.current);
            },
        }),
        [openGifPicker],
    );

    // Preload trending GIFs on mount so the picker opens instantly.
    const hasPreloadedGiphyRef = useRef(false);
    useEffect(() => {
        if (hasPreloadedGiphyRef.current) return;
        hasPreloadedGiphyRef.current = true;
        if (isGifPickerEnabled && context) {
            preloadGiphyTrending(context);
        }
    }, [context, isGifPickerEnabled]);

    /* ========================================================================== *\
     *                         ProseMirror initialization                         *
    \* ========================================================================== */

    const [fileDropTarget, setFileDropTarget] = useState<ContentEditorFileDropTarget | null>(null);

    // Huh? `useInsertionEffect()`? That's a React hook? Ok, [it is][1] but the docs
    // say only CSS-in-JS libraries should use it.
    //
    // Wait what?? A `rootElement` parameter??? That's not documented? What the what?
    //
    // Read the documentation comment on `<TaskRowTitleInput>`. This is how we render
    // the non-React ProseMirror `EditorView`. It's essential for performance on
    // `<TaskRowTitleInput>`, it's not essential for performance here. But we use this
    // pattern everywhere we render an `EditorView` for consistency and since we
    // believe this is the proper way to manually mutate the DOM in React.
    useInsertionEffect((rootElement?: HTMLDivElement) => {
        assert(rootElement);

        const initialState = unwrap(propsRef.current.state);
        const schema = initialState.doc.type.schema;
        // This editor view is initialized once and remounts when the space changes, so
        // it's safe to capture the date picker feature flag at mount time.
        const hasDatePickerUiFeatureForEditorView =
            spaceContextRef.current !== null
                ? hasDatePickerFeature(spaceContextRef.current.space.id)
                : false;

        const initialIsDualModality = isDualModalityRef.current;
        const initialAccessLevel = propsRef.current.accessLevel ?? "Manage";
        const initialHasEditAccessLevel = hasAccessLevel(initialAccessLevel, "Edit");

        const viewProps: DirectEditorProps = {
            state: initialState,

            editable: () =>
                initialHasEditAccessLevel &&
                // On mobile devices we implement dual interaction modality. Before any interaction
                // the content is read-only. Tapping on links follows the link instead of editing
                // the content. Tapping on text switches to an editing modality and now while in an
                // editing modality tapping on a link edits the link's text.
                !initialIsDualModality,

            attributes: {
                // Native spellcheck is often more distracting then it's worth. It puts a red
                // squiggly under names, nouns, industry terms, and oddly sometimes contractions
                // (like "they're", maybe has to do with curly quotes?).
                //
                // It's also inconsistent with `<input>`s which don't have spellcheck on by
                // default.
                //
                // In iOS, however, the native spellchecker is _essential_ for proper document
                // editing. Since typos abound on mobile keyboards. Unlike on web, iOS spell check
                // results show up inline instead of requiring a right click (which we override).
                ...(!isMobileWebKit ? {spellcheck: "false"} : undefined),
            },

            domParser: ContentEditorDomParser.fromSchema(schema),

            get scrollThreshold() {
                return getScrollMargin();
            },
            get scrollMargin() {
                return getScrollMargin();
            },

            // NOTE(imjoshin): Don't cause rerendered when doc attributes change
            ignoreDocAttrsForUpdate: true,
        };

        /* ========================================================================== *\
         *                               Scroll margin                                *
        \* ========================================================================== */

        let lastSpacingScale: SpacingScale | null = null;
        let lastWithoutNavigationBarScrollMarginTop: boolean | null = null;
        let lastScrollMargin: {top: number; left: number; right: number; bottom: number} | null =
            null;

        function getScrollMargin() {
            const spacingScale = getSpacingScaleWithoutListening();
            const withoutNavigationBarScrollMarginTop =
                propsRef.current.withoutNavigationBarScrollMarginTop ?? false;

            if (
                lastScrollMargin !== null &&
                lastSpacingScale === spacingScale &&
                lastWithoutNavigationBarScrollMarginTop === withoutNavigationBarScrollMarginTop
            ) {
                return lastScrollMargin;
            }

            const scrollMarginPx =
                textInputVisibilityMaintainerMarginYRem * remPxBySpacingScale[spacingScale];

            lastSpacingScale = spacingScale;
            lastWithoutNavigationBarScrollMarginTop = withoutNavigationBarScrollMarginTop;

            let scrollMarginTop = scrollMarginPx;

            if (schema.nodes.title) {
                // If our schema has a title then use the title's padding top as our top margin.
                // This has two important effects:
                //
                // 1. Content with titles (documents) also typically have a navigation bar. Since
                //    the title padding is larger than our navigation bar height while moving up
                //    with arrow keys the selection won't be covered by the navigation bar.
                //
                // 2. Moving up through content with arrow keys and arriving at the title will have
                //    fully scrolled the editor to the top of the view.
                scrollMarginTop =
                    getElementSafeAreaInsetTopPx(view.dom) +
                    convertRemLengthToPx(
                        contentStyles.titlePaddingTop[
                            getPlatformRouteLayout(
                                getPlatformWithoutListening(),
                                routeLayoutRef.current,
                            )
                        ],
                        spacingScale,
                    ) +
                    1;
            } else if (!withoutNavigationBarScrollMarginTop) {
                // Always allow enough space for the navigation bar in top scroll margin. For
                // example, task notes in a peek view need to scroll the peek enough to show where
                // you're typing when the cursor is underneath the navigation bar.
                //
                // NOTE(calebmer): This behavior is a bit strange in message inputs where
                scrollMarginTop =
                    getElementSafeAreaInsetTopPx(view.dom) +
                    convertRemLengthToPx(navigationBarHeight, spacingScale) +
                    scrollMarginPx;
            }

            lastScrollMargin = {
                top: scrollMarginTop,
                left:
                    scrollMarginPx +
                    // This is the base width of code block line numbers. When scrolling left, to make
                    // sure the selection is visible we should scroll past line numbers which cover up
                    // content.
                    convertRemLengthToPx(contentStyles.listItemIndentation, spacingScale),
                right: scrollMarginPx,
                bottom: scrollMarginPx,
            };

            return lastScrollMargin;
        }

        /* ========================================================================== *\
         *                            Node and mark views                             *
        \* ========================================================================== */

        // IMPORTANT: If you have a custom view in `nodeViews` here you should also have a
        // matching custom renderer in `nodeRenderers` in `renderContentToHtml()`.
        viewProps.nodeViews = {
            orderedListItem: createContentEditorOrderedListItemNodeView,
            checkListItem: createContentEditorCheckListItemNodeViewConstructor({
                getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
            }),
            codeBlock: createContentEditorCodeBlockNodeViewConstructor({
                getReporter: () => reporterRef.current,
                getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
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
                    // We intentionally do not remove our tooltip state when the hover ends. Since we
                    // need to wait until the tooltip fades out on its own.
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
                getRouteLayout: () => routeLayoutRef.current,
                getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                getCurrentAccountIfExists: () => spaceContextRef.current?.currentAccount ?? null,
                getContext: () => assertExists(contextRef.current),
                getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
                onNavigate: to => navigateRef.current(to),
            }),
            fileRow: createContentEditorFileRowLikeNodeViewConstructor({
                getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                getBlockWidth: () => blockWidthRef.current,
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
            }),
            fileRowTable: createContentEditorFileRowLikeNodeViewConstructor({
                getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                getBlockWidth: () => blockWidthRef.current,
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
            }),
            fileFloat: createContentEditorFileFloatNodeViewConstructor({
                getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                getBlockWidth: () => blockWidthRef.current,
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
            }),
            file: createContentEditorFileNodeViewConstructor({
                rootNavigate: (...args) => (rootNavigateRef as any).current(...args),
                navigate: (...args) => (navigateRef as any).current(...args),
                getContext: () => assertExists(contextRef.current),
                getReporter: () => reporterRef.current,
                getRouteLayout: () => routeLayoutRef.current,
                getSpaceId: () => assertExists(spaceContextRef.current).space.id,
                getCurrentAccount: () => assertExists(spaceContextRef.current).currentAccount,
                getBlockWidth: () => blockWidthRef.current,
                getAttachmentTarget: () => assertExists(propsRef.current.fileAttachmentTarget),
                getFileEntityRenderers: () => fileEntityRenderersRef.current,
                getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
                subscribeToReferencesUpdate: listener => {
                    referencesUpdateEmitterRef.current ??= new EventEmitter();
                    return referencesUpdateEmitterRef.current.subscribe(listener);
                },
                draggingFileRef,
            }),
            table: createContentEditorTableNodeView({
                getBlockWidth: () => blockWidthRef.current,
                getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
            }),
        };

        // IMPORTANT: If you have a custom view in `markViews` here you should also have a
        // matching custom renderer in `markRenderers` in `renderContentToHtml()`.
        viewProps.markViews = {
            link: createContentEditorLinkMarkViewConstructor({
                canPrimaryInputHover: () => canPrimaryInputHoverRef.current,

                onPointerEnterAfterDelay: ({mark, range, wasPointerDown}) => {
                    // We don't want to open floaters on mobile.
                    if (getPlatformWithoutListening() === "mobile") return;

                    // Don't open the pointer link floater if the pointer was down when it entered the
                    // link. Since the user is probably trying to drag to select some text.
                    if (wasPointerDown) return;

                    const floaterState = getContentEditorFloaterState(view.state);

                    // Don't open pointer link preview if the current floater is a comment input
                    // floater.
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
                getRouteLayout: () => routeLayoutRef.current,
                canPrimaryInputHover: () => canPrimaryInputHoverRef.current,
                openCommentThread: async commentThreadId => {
                    await propsRef.current.openCommentThread?.(commentThreadId);
                },
                onCommentThreadPressedChange: (commentThreadId, isHovered) => {
                    propsRef.current.onCommentThreadPressedChange?.(commentThreadId, isHovered);
                },
            }),
        };

        function openDatePicker(
            view: EditorView,
            dateMatch: ContentEditorDateDecorationMatch,
            autoFocus: boolean,
        ) {
            if (!hasDatePickerUiFeatureForEditorView) return;

            const savedSelection = view.state.selection;
            const tr = view.state.tr.setSelection(
                TextSelection.create(view.state.doc, dateMatch.from, dateMatch.to),
            );
            view.dispatch(tr);
            setDatePickerState({
                key: generateId(),
                match: dateMatch,
                isVisible: true,
                autoFocus,
                savedSelection,
            });
        }

        /* ========================================================================== *\
         *                                Click events                                *
        \* ========================================================================== */

        viewProps.handleClick = (view, pos, event) => {
            // Open date picker when clicking a detected date decoration.
            if (hasDatePickerUiFeatureForEditorView) {
                const dateMatch = getContentEditorDateMatchAtPos(view.state, pos);
                if (dateMatch && pos > dateMatch.from && pos < dateMatch.to) {
                    openDatePicker(view, dateMatch, false);
                    return true;
                }
            }

            // Don't perform the default ProseMirror behavior when clicking a file.
            //
            // We have pointer event listeners in `content_editor_file_node_view.ts` that
            // implements selecting the file on shift click and opening the attachment viewer
            // otherwise.
            if (event.target instanceof Element && event.target.closest(`.${fileClassName}`)) {
                return true;
            }
        };

        // ProseMirror provides its own triple click selection support. This is good, the
        // browser's triple click support doesn't work well with `contenteditable="false"`
        // children. e.g. A mention in a paragraph (the mention is
        // `contenteditable="false"`). The browser default won't select the whole paragraph
        // on triple click. Or a paragraph followed by a `fileFloat` or `fileRow` (which
        // are also `contenteditable="false"`). A triple click for paragraphs followed by
        // files moves the cursor to the start of the paragraph instead of selecting the
        // paragraph.
        //
        // ProseMirror's triple click support works consistently unlike the browser.
        // However, ProseMirror doesn't implement dragging the mouse after a triple click
        // to move the selection like the browser does. And preventing the browser default
        // with `event.preventDefault()` means the browser won't move the selection during
        // a drag. So we reimplement dragging the selection after a triple click here.
        viewProps.handleTripleClick = (view, pos, event) => {
            // Don't perform the default ProseMirror behavior when clicking a file.
            if (event.target instanceof Element && event.target.closest(`.${fileClassName}`)) {
                return true;
            }

            tripleClickDragStateRef.current?.dispose();

            const state = ContentEditorTripleClickDragState.onTripleClick(event, view, {
                onDispose: () => {
                    if (tripleClickDragStateRef.current === state)
                        tripleClickDragStateRef.current = null;
                },
            });

            tripleClickDragStateRef.current = state;

            return false;
        };

        /* ========================================================================== *\
         *                                 Copy/paste                                 *
        \* ========================================================================== */

        let temporaryPastedFileInfoById: Map<FileId, FileInfo> | undefined;
        let temporaryPastedFileInfosForParent: Array<FileInfoWithEntity> | undefined;

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

        // This function is called when the user copies content from the editor.
        viewProps.transformCopied = slice => {
            const isCellSelection = view.state.selection instanceof ContentTableCellSelection;

            const isExclusivelyTableSingleCellContent =
                slice.content.childCount === 1 &&
                slice.content.firstChild &&
                ((slice.content.firstChild.type.name === "table" &&
                    slice.content.firstChild.content.childCount === 1 &&
                    slice.content.firstChild.content.firstChild!.content.childCount === 1) ||
                    (slice.content.firstChild.type.name === "tableRow" &&
                        slice.content.firstChild.content.childCount === 1) ||
                    slice.content.firstChild.type.name === "tableCell");

            // NOTE(rohit): Override ProseMirror's default copy behavior for table content.
            //
            // Problem: When copying some content from a table cell, ProseMirror includes the
            // entire table structure in the slice, even when the user only selected content
            // within a cell (not using CellSelection).
            //
            // Solution: If table nodes appear in the slice without an explicit CellSelection,
            // extract just the cell's content and remove the table structure.
            //
            // Apply this custom copy logic only for slices which have single cell content from
            // the table. For other cases, we use ProseMirror's default copy behavior.
            //
            // `extractedDepth` is used to adjust the `openStart` and `openEnd` of the slice to
            // account for the depth of the table nodes in the slice.
            if (isExclusivelyTableSingleCellContent && !isCellSelection) {
                let extractedDepth = 0;
                // recursive function to get the content from `tableCell` node
                const extractCellContent = (node: Node): Fragment | null => {
                    if (node.type.name === "table" || node.type.name === "tableRow") {
                        extractedDepth++;
                        return node.content.firstChild
                            ? extractCellContent(node.content.firstChild)
                            : null;
                    } else if (node.type.name === "tableCell") {
                        extractedDepth++;
                        return node.content;
                    }
                    return node.content;
                };

                const cellContent = extractCellContent(slice.content.firstChild);

                if (cellContent) {
                    return new Slice(
                        cellContent,
                        Math.max(0, slice.openStart - extractedDepth),
                        Math.max(0, slice.openEnd - extractedDepth),
                    );
                }
            }

            return slice;
        };

        viewProps.transformPasted = slice => {
            // When pasting a slice that starts with a heading and has some other nodes, make
            // sure we always use an `openStart` of 0 so the heading doesn't merge with the
            // previous node.
            if (
                slice.content.firstChild?.type.name === "heading" &&
                slice.content.childCount > 1 &&
                slice.openStart !== 0
            ) {
                slice = new Slice(slice.content, 0, slice.openEnd);
            }

            // If the slice is a `codeBlock` with a single line then instead of trying to paste
            // a code block, instead paste the individual text nodes with code styling.
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
            // maintaining the code block's structure) with whatever we're pasting into.
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
        // within a 4 minute window of the current time. To prevent issues with clock skew
        // let's use our synchronized clock to generate the `FileId`.
        const generateFileIdWithSynchronizedClock = () => {
            const clock =
                getSynchronizedSystemClock().getStateWithoutListening().value ??
                unsynchronizedSystemClock;

            return generateChronologicalIdWithTime<FileId>(Math.round(clock.now()));
        };

        viewProps.transformPastedDOM = element => {
            // File copy/pasting is tricky. In the content itself a file is represented as a
            // node with only a `FileId`. Data about the file is available on the side in
            // `ContentReferences` and often needs to be loaded from the server.
            //
            // The format of pasted content is HTML. We generate HTML when copying files that
            // should be compatible with a broad range of applications. For example, file nodes
            // become `<img>` elements.
            //
            // We can be receiving pasted files that:
            //
            // 1. Was copied in Alpine; OR
            // 2. Was copied from a different application
            //
            // In case 1 we already have the file uploaded to our servers. What we want to do
            // here is create another file attachment link from wherever the file is coming
            // from (which we store in a `data-cy-attached` attribute) to the
            // `FileAttachmentTarget` of our content editor.
            //
            // In case 2 we want to download the file from its URL and upload it to our
            // servers. We also do this for files from different spaces since file storage is
            // scoped to a space.
            //
            // There's a bit of juggling we need to do in this code. `handlePaste` is where we
            // implement asynchronous pastes. However, `handlePaste` receives a ProseMirror
            // `Slice` that only contains file nodes with their `FileId`s. Knowledge about
            // whether we're in case 1 or case 2 and the source URL of files we're pasting is
            // available only in the HTML here in `transformPastedDOM`. We bridge this gap with
            // `temporaryPastedFileInfoById`. `transformPastedDOM` adds additional information
            // about each file we're pasting in `temporaryPastedFileInfoById` and `handlePaste`
            // reads from this map for each `FileId` it found in the pasted ProseMirror
            // `Slice`. Not very elegant but it gets the job done.
            //
            // `handleDrop` also uses paste logic for parsing dropped content. So we need to
            // use `temporaryPastedFileInfoById` in `handleDrop` as well!
            if (schema.nodes.file) {
                for (const {element: fileElement, info: fileInfo} of iterateFileInfosInElement(
                    element,
                    () => assertExists(spaceContextRef.current).space.id,
                )) {
                    if (fileInfo === null) {
                        const temporaryFileElement = fileElement.ownerDocument.createElement("div");
                        temporaryFileElement.setAttribute("data-cy-tmp-file", "null");
                        fileElement.parentNode?.replaceChild(temporaryFileElement, fileElement);
                        continue;
                    }

                    switch (fileInfo.type) {
                        case "AttachFileEntity": {
                            // Ignore file entities. The ProseMirror schema will be able to successfully parse
                            // a file entity node from an `<iframe>` element. We don't need to preserve any
                            // additional state from the DOM.
                            break;
                        }
                        case "AttachFile": {
                            // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will use
                            // this map synchronously after `transformPastedDOM`.
                            if (temporaryPastedFileInfoById === undefined) {
                                temporaryPastedFileInfoById = new Map();
                                scheduleMicrotask(() => {
                                    temporaryPastedFileInfoById = undefined;
                                });
                            }

                            temporaryPastedFileInfoById.set(fileInfo.fileId, fileInfo);

                            const temporaryFileElement =
                                fileElement.ownerDocument.createElement("div");
                            temporaryFileElement.setAttribute("data-cy-tmp-file", fileInfo.fileId);
                            fileElement.parentNode?.replaceChild(temporaryFileElement, fileElement);
                            break;
                        }
                        case "UploadFile": {
                            const fileId = generateFileIdWithSynchronizedClock();

                            // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will use
                            // this map synchronously after `transformPastedDOM`.
                            if (temporaryPastedFileInfoById === undefined) {
                                temporaryPastedFileInfoById = new Map();
                                scheduleMicrotask(() => {
                                    temporaryPastedFileInfoById = undefined;
                                });
                            }

                            temporaryPastedFileInfoById.set(fileId, fileInfo);

                            const temporaryFileElement =
                                fileElement.ownerDocument.createElement("div");
                            temporaryFileElement.setAttribute("data-cy-tmp-file", fileId);
                            fileElement.parentNode?.replaceChild(temporaryFileElement, fileElement);
                            break;
                        }
                        default:
                            throw exhaustive(fileInfo);
                    }
                }
            }
            // If this `<ContentEditor>` doesn't support files then we completely remove file
            // elements from pasted content. We don't want to leave whitespace where there used
            // to be files.
            //
            // We'll call `onPasteOrDropFiles` later in `handlePaste` or `handleDrop` to let
            // our parent choose to handle files separately. (e.g. `<MessageInput>` will attach
            // the files to the message.)
            else {
                for (const {element: fileElement, info: fileInfo} of iterateFileInfosInElement(
                    element,
                    () => assertExists(spaceContextRef.current).space.id,
                )) {
                    if (fileInfo !== null) {
                        // Cleanup `temporaryPastedFileInfosForParent` after a microtask. `handlePaste`
                        // will use this array synchronously after `transformPastedDOM`.
                        if (temporaryPastedFileInfosForParent === undefined) {
                            temporaryPastedFileInfosForParent = [];
                            scheduleMicrotask(() => {
                                temporaryPastedFileInfosForParent = undefined;
                            });
                        }

                        temporaryPastedFileInfosForParent.push(fileInfo);
                    }

                    // Remove the file element and if that empties the file's parent then remove the
                    // file's parent as well (recursively).
                    let element: Element | null = fileElement;
                    while (element !== null) {
                        const parentElement: Element | null = element.parentElement;
                        element.remove();

                        if (
                            parentElement !== null &&
                            !iterableSome(
                                parentElement.childNodes,
                                childNode =>
                                    childNode.nodeType === globalThis.Node.ELEMENT_NODE ||
                                    childNode.nodeType === globalThis.Node.TEXT_NODE,
                            )
                        ) {
                            element = parentElement;
                        } else {
                            break;
                        }
                    }
                }
            }

            // Go through all entity mentions and remove the `data-cy-mention` attribute for
            // any that come from a different space then the one we're currently in. By
            // removing the `data-cy-mention` attribute, mentions from a different space will
            // be parsed as links instead of mentions.
            for (const mentionElement of element.querySelectorAll("a[data-cy-mention]")) {
                const href = mentionElement.getAttribute("href");
                if (!href) {
                    mentionElement.removeAttribute("data-cy-mention");
                    continue;
                }

                const spaceIdMatch = href.match(/\/s\/([^/]+)/);
                if (!spaceIdMatch) {
                    mentionElement.removeAttribute("data-cy-mention");
                    continue;
                }

                if (
                    !spaceContextRef.current ||
                    spaceIdMatch[1] !== spaceContextRef.current.space.id
                ) {
                    mentionElement.removeAttribute("data-cy-mention");
                    continue;
                }
            }
        };

        /**
         * Shared function for handling paste and drop events. Paste and drop events have
         * the following in common we want to keep consistent:
         *
         * - If `slice` is empty (ProseMirror couldn't parse content from `text/html`) then
         *   we want to look in `dataTransfer` for files and paste those.
         *
         * - If `slice` has content references then we need to load those content
         *   references into our editor. If some of those content references are files then
         *   we need to attach the files to our attachment target and maybe upload the
         *   files.
         */
        function handleInsertSlice<
            const Remember extends ReadonlyArray<number | Selection | null>,
        >({
            asyncSpanName,
            remember: initialRemember,
            slice,
            dataTransfer,
            action,
        }: {
            asyncSpanName: string;
            remember: Remember;
            slice: Slice;
            dataTransfer: DataTransfer | null;
            action: (
                remember: Remember,
                slice: Slice,
                createTransaction: () => Transaction,
            ) => void;
        }) {
            // If we're dropping or pasting an empty slice that means ProseMirror couldn't
            // parse the data in `dataTransfer`. If `dataTransfer` has any files then let's use
            // `FileProcessorService` to attach the file to our content.
            if (
                !schema.nodes.file &&
                dataTransfer?.items &&
                // If `transformPastedDOM` already parsed some files from HTML then ignore any
                // files in `dataTransfer`. We assume all files were included as `<img>` or other
                // supported tags in the HTML so any additional files in `dataTransfer` must be
                // redundant.
                //
                // This case happens if you right-click to copy an image in Alpine. The resulting
                // `dataTransfer` will have an `image/png` file and `text/html`. We should prefer
                // the `text/html` data since it includes a link to the full resolution image
                // whereas `image/png` will have reduced resolution.
                (!temporaryPastedFileInfosForParent ||
                    temporaryPastedFileInfosForParent.length === 0)
            ) {
                for (const item of dataTransfer.items) {
                    if (item.kind !== "file") continue;

                    // Cleanup `temporaryPastedFileInfosForParent` after a microtask. `handlePaste`
                    // will use this map synchronously.
                    if (temporaryPastedFileInfosForParent === undefined) {
                        temporaryPastedFileInfosForParent = [];
                        scheduleMicrotask(() => {
                            temporaryPastedFileInfosForParent = undefined;
                        });
                    }

                    temporaryPastedFileInfosForParent.push({
                        type: "UploadFile",
                        input: {type: "File", file: assertExists(item.getAsFile())},
                    });
                }
            } else if (
                schema.nodes.file &&
                schema.nodes.fileRow &&
                slice.size === 0 &&
                dataTransfer?.items &&
                // If `transformPastedDOM` already parsed some files from HTML then ignore any
                // files in `dataTransfer`. We assume all files were included as `<img>` or other
                // supported tags in the HTML so any additional files in `dataTransfer` must be
                // redundant.
                //
                // NOTE(calebmer): This is to match the above behavior when there is no file in the
                // schema. I believe checking `slice.size === 0` also has a similar effect: if
                // there was a file in the parsed DOM then it should now be in the inserted
                // `slice`. This may be unnecessary but including it anyway for consistency.
                (!temporaryPastedFileInfoById || temporaryPastedFileInfoById.size === 0)
            ) {
                const fileIds: Array<FileId> = [];

                for (const item of dataTransfer.items) {
                    if (item.kind !== "file") continue;

                    // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will use
                    // this map synchronously.
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

                    fileIds.push(fileId);
                }

                if (fileIds.length > 0) {
                    const fileIdsByRow: Array<Array<FileId>> = [[]];

                    for (const fileId of fileIds) {
                        if (fileIdsByRow[fileIdsByRow.length - 1]!.length < 3) {
                            fileIdsByRow[fileIdsByRow.length - 1]!.push(fileId);
                        } else {
                            fileIdsByRow.push([fileId]);
                        }
                    }

                    slice = new Slice(
                        Fragment.from(
                            fileIdsByRow.map(fileIds =>
                                schema.node(
                                    "fileRow",
                                    {},
                                    fileIds.map(fileId => schema.node("file", {fileId})),
                                ),
                            ),
                        ),
                        0,
                        0,
                    );
                }
            }

            const referencedIds = getContentReferencedIdsForSlice(slice);

            // If there's some references in the paste then let's perform an asynchronous paste
            // where we load all requisite data first.
            if (isEmptyContentReferencedIds(referencedIds)) {
                action(initialRemember, slice, () => view.state.tr);
                return;
            }

            const context = assertExists(contextRef.current);
            const reporter = assertExists(reporterRef.current);
            const spaceId = assertExists(spaceContextRef.current).space.id;

            let hasUploadFileError = false;

            let rememberGetters: Array<() => number | Selection | null> = initialRemember.map(
                item => () => item,
            );

            const promise = context.tracer.withSpan(asyncSpanName, run);

            rememberGetters = initialRemember.map(item => {
                if (item === null) return () => null;

                if (typeof item === "number") {
                    const {getPos} = rememberContentEditorPosWhileLoading(view, item, promise);
                    return getPos;
                } else {
                    const {getSelection} = rememberContentEditorSelectionWhileLoading(
                        view,
                        item,
                        promise,
                    );
                    return getSelection;
                }
            });

            // While performing an asynchronous paste or drop we show a "Pasting" loading
            // indicator. We intentionally show a loading indicator that says "Pasting" for
            // both asynchronous pastes and asynchronous drops. I feel like the copy "Dropping"
            // might confuse the user since they might not associate the word "drop" with their
            // drag operation.
            addGlobalLoadingIndicatorRef.current(promise, {type: "Pasting"});

            promise.catch(error => {
                reporter.displayError(
                    hasUploadFileError ? "Couldn\u2019t upload file" : "Couldn\u2019t paste",
                    error,
                );
            });

            async function run(context: AppContext) {
                const promiseWaiter = new PromiseWaiter();

                // Load all non-file references. To load files we need to know the origin
                // `fileAttachmentTarget` which may be different for each file.
                const referencedIdsWithoutFiles = {...referencedIds, fileIds: emptySet};
                const referencesPromise = !isEmptyContentReferencedIds(referencedIdsWithoutFiles)
                    ? getContentReferencesWithoutFiles(context, {
                          spaceId,
                          referencedIds: referencedIdsWithoutFiles,
                      }).then(({references}) => references)
                    : emptyContentReferences;

                let ensureFileAttachmentTargetPromise: Promise<void> | null = null;

                const processFile = async (fileId: FileId) => {
                    const temporaryPastedFileInfo = temporaryPastedFileInfoById?.get(fileId);
                    if (!temporaryPastedFileInfo) return null;

                    // Make sure `fileAttachmentTarget` actually exists before trying to attach files.
                    // Otherwise we'll get a "Document not found" error or similar.
                    if (propsRef.current.onEnsureFileAttachmentTarget) {
                        ensureFileAttachmentTargetPromise ??=
                            propsRef.current.onEnsureFileAttachmentTarget();
                        await ensureFileAttachmentTargetPromise;
                    }

                    const toTarget = assertExists(propsRef.current.fileAttachmentTarget);

                    switch (temporaryPastedFileInfo.type) {
                        case "AttachFile": {
                            const fromTarget = temporaryPastedFileInfo.target;

                            // If the file is already in our view's references that means it's already been
                            // loaded and we have the requisite permissions for it. No file loading needed.
                            if (
                                getContentEditorReferences(view.state).references.fileById?.has(
                                    fileId,
                                )
                            ) {
                                return null;
                            }
                            // If we're trying to attach the file to the same attachment target it's from then
                            // we don't need to perform another attach mutation. Instead, all we need to do is
                            // load the file (since it's not in our references).
                            else if (isDeepEqual(fromTarget, toTarget)) {
                                return await getFileFromAttachment(context, {
                                    spaceId: temporaryPastedFileInfo.spaceId,
                                    fileId: temporaryPastedFileInfo.fileId,
                                    target: toTarget,
                                });
                            }
                            // Otherwise, let's attach the file to its new attachment target.
                            else if (fromTarget === "Uploader") {
                                return await attachFileAsUploader(context, {
                                    spaceId: temporaryPastedFileInfo.spaceId,
                                    fileId: temporaryPastedFileInfo.fileId,
                                    target: toTarget,
                                });
                            } else {
                                return await attachFileFromAttachment(context, {
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
                                file: FileModel;
                            }>();

                            const actualPromise = uploadFile(context, {
                                spaceId,
                                // Use the `FileId` generated by the client and used in the pasted `Slice` instead
                                // of generating a new `FileId` on the server.
                                fileId,
                                attachmentTarget: toTarget,
                                input: temporaryPastedFileInfo.input,
                                onAttach: fileReferencePromiseResolver.resolve,
                            });

                            const promise = actualPromise.then(
                                () => {
                                    if (!fileReferencePromiseResolver.isSettled()) {
                                        fileReferencePromiseResolver.reject(
                                            new InternalError(
                                                "`onAttach()` was never called by `uploadFile()`",
                                            ),
                                        );
                                    }
                                },
                                error => {
                                    hasUploadFileError = true;
                                    fileReferencePromiseResolver.reject(error);
                                    throw error;
                                },
                            );

                            promiseWaiter.waitUntil(promise);

                            // While a file is uploading show an "Uploading" loading indicator with the
                            // progress percentage. If multiple files are uploading at once then the global
                            // loading indicator implementation is responsible for putting together an
                            // aggregated summary.
                            addGlobalLoadingIndicatorRef.current(promise, {
                                type: "Uploading",
                                progressStore: actualPromise.progressStore,
                            });

                            return await fileReferencePromiseResolver.promise;
                        }
                        default:
                            throw exhaustive(temporaryPastedFileInfo);
                    }
                };

                const [references, fileReferences] = await runAllPromises([
                    referencesPromise,
                    runAllPromises(mapIterable(referencedIds.fileIds, processFile)),
                ]);

                // Any new paste transaction should start by updating content references with the
                // data we just asynchronously fetched.
                const createTransaction = () =>
                    updateContentEditorReferences(
                        view.state.tr,
                        Array.from(
                            concatIterables<ContentEditorReferencesSharedAction>(
                                [{type: "MergeBase", references}],
                                filterMapIterable(fileReferences, fileReference => {
                                    if (!fileReference) return;

                                    return {
                                        type: "SetFile",
                                        signedUrlSearch: fileReference.signedUrlSearch,
                                        file: fileReference.file,
                                    };
                                }),
                            ),
                        ),
                    );

                action(
                    // Get the positions and selections remembered by our editor state. We'll have
                    // mapped these positions while waiting on our promises to resolve.
                    rememberGetters.map(getter => getter()) as any as Remember,
                    slice,
                    createTransaction,
                );

                await promiseWaiter.wait();
            }
        }

        viewProps.handlePaste = (view, event, slice) => {
            let selection = view.state.selection;

            // If the slice is empty, check if there's `text/uri-list` and parse that. On
            // mobile Safari if you open the share menu then click "Copy" the clipboard content
            // will only contain the URL in `text/uri-list`. So we must support this content
            // type to support pasting links from Safari's share menu.
            if (slice.size === 0 && event.clipboardData?.types.includes("text/uri-list")) {
                const uriListString = event.clipboardData.getData("text/uri-list");

                const uriListNodes = uriListString
                    .trim()
                    .split(/[\r\n]+/)
                    .map(uri =>
                        view.state.schema.text(uri, [view.state.schema.mark("link", {url: uri})]),
                    );

                slice = new Slice(Fragment.from(uriListNodes), 0, 0);
            }

            // If the selection starts in our title, then shift the selection out of the title.
            // That way if we paste a paragraph in the title the paragraph doesn't become the
            // title. Making a 50 word paragraph the title just feels broken.
            //
            // If the first child we're pasting is a heading then leave the selection as it is.
            // We want headings to fill the title.
            if (selection.$from.parent.type.name === "title") {
                if (slice.content.firstChild?.type.name !== "heading") {
                    selection = TextSelection.between(
                        view.state.doc.resolve(selection.$from.after()),
                        selection.$to.parent.type.name === "title"
                            ? view.state.doc.resolve(selection.$to.after())
                            : selection.$to,
                    );
                } else {
                    // Make sure if we're pasting a `heading` node into a `title` node the `openStart`
                    // is always at least 1 so the heading can fill the title instead of creating a new
                    // block below.
                    if (slice.openStart < 1) {
                        slice = new Slice(slice.content, 1, slice.openEnd);
                    }

                    // If we're pasting a `heading` node into a `title` node and we have another block
                    // node besides the first `heading` node and the node after the `title` node is an
                    // empty paragraph then let's have our selection include the paragraph.
                    //
                    // This way if the user pastes into an empty document they won't have a trailing
                    // paragraph at the end.
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

            // If we're pasting a URL for a `SearchEntityId` in an empty paragraph then instead
            // of pasting the URL text we want to paste a file node.
            if (spaceContextRef.current && selection.from === selection.to) {
                const entityId = parseSearchEntityIdFromUrl(
                    spaceContextRef.current.space.id,
                    event.clipboardData?.getData("text/plain") ?? "",
                );
                if (entityId !== null) {
                    const node = selection.$from.node();
                    const parentNode = selection.$from.node(-1);

                    const isEmptyParagraphInDoc =
                        node.type.name === "paragraph" &&
                        node.childCount === 0 &&
                        (parentNode.type.name === "doc" || parentNode.type.name === "tableCell");

                    // If the selection is in an empty paragraph directly in the `doc` node (or
                    // `tableCell`) then replace the paragraph with a file entity. Otherwise we insert
                    // a mention.
                    if (isEmptyParagraphInDoc && isFileEntityId(entityId)) {
                        if (schema.nodes.fileRow && schema.nodes.file) {
                            slice = new Slice(
                                Fragment.from(
                                    schema.nodes.fileRow.create(null, [
                                        schema.nodes.file.create({fileId: entityId}),
                                    ]),
                                ),
                                0,
                                0,
                            );
                        }
                        // If our parent component provided an `onPasteOrDropFiles` prop when we don't have
                        // `fileRow` or `file` nodes then empty `slice` (so the link isn't pasted) and add
                        // the file entity to the `onPasteOrDropFiles` call.
                        else if (propsRef.current.onPasteOrDropFiles) {
                            slice = Slice.empty;

                            // Cleanup `temporaryPastedFileInfosForParent` after a microtask. `handlePaste`
                            // will use this array synchronously after `handleInsertSlice()`.
                            if (temporaryPastedFileInfosForParent === undefined) {
                                temporaryPastedFileInfosForParent = [];
                                scheduleMicrotask(() => {
                                    temporaryPastedFileInfosForParent = undefined;
                                });
                            }

                            temporaryPastedFileInfosForParent.push({
                                type: "AttachFileEntity",
                                spaceId: spaceContextRef.current.space.id,
                                fileEntityId: entityId,
                            });
                        }
                    }
                    // If we're not in an empty paragraph then insert a mention when pasting a link.
                    else {
                        if (isSearchMentionEntityId(entityId)) {
                            const mention: ContentMention = {
                                type: "SearchEntity",
                                entityId,
                            };

                            slice = new Slice(
                                Fragment.from(schema.nodes.mention!.create({mention})),
                                0,
                                0,
                            );
                        } else {
                            const accountId = cast<`Account:${AccountId}`>(entityId).slice(
                                "Account:".length,
                            );
                            assert(isId<AccountId>(accountId));

                            const mention: ContentMention = {
                                type: "Account",
                                accountId,
                                isShort: false,
                            };

                            slice = new Slice(
                                Fragment.from(schema.nodes.mention!.create({mention})),
                                0,
                                0,
                            );
                        }
                    }
                }
            }

            let isSync = true;

            handleInsertSlice({
                asyncSpanName: "<ContentEditor> paste",
                remember: [selection],
                slice,
                dataTransfer: event.clipboardData,
                action: ([selection], slice, createTransaction) => {
                    handlePasteAfterResolvingReferences(
                        view.state.doc,
                        selection,
                        () => {
                            const transaction = createTransaction();
                            if (isSync && selection !== view.state.selection) {
                                transaction.setSelection(selection);
                            }
                            return transaction;
                        },
                        transaction => view.dispatch(transaction),
                        event,
                        slice,
                    );
                },
            });

            isSync = false;

            // Pass any files from this paste or drop we didn't handle to our parent component.
            if (
                temporaryPastedFileInfosForParent &&
                temporaryPastedFileInfosForParent.length > 0 &&
                propsRef.current.onPasteOrDropFiles
            ) {
                propsRef.current.onPasteOrDropFiles(temporaryPastedFileInfosForParent);
            }

            // We completely override ProseMirror's paste logic and implement our own. Our
            // paste logic is derived from ProseMirror's paste logic.
            return true;
        };

        /* ========================================================================== *\
         *                       Drag and drop events (part 1)                        *
        \* ========================================================================== */

        viewProps.handleDrop = (_view, event, slice, move, $mouse) => {
            // If we detected that this is a file drag then we want to use the drop target we
            // rendered for the user instead of ProseMirror's default drop position
            // determination logic (the `$mouse` position and `dropPoint()` function).
            const initialFileDropTarget =
                fileDragState &&
                (slice.size === 0 ||
                    slice.content.content.every(
                        node =>
                            node.type.name === "fileRow" ||
                            node.type.name === "file" ||
                            node.type.name === "fileRowTable",
                    ))
                    ? fileDragState.getDropTarget()
                    : null;

            // Same logic as ProseMirror for copy key modifier:
            // https://github.com/ProseMirror/prosemirror-view/blob/d27ff92999b2aedca18c34efaab8fa5e695dcc8f/src/input.ts#L620
            const hasCopyKeyModifier = event[getClientInfo().isAppleDevice ? "altKey" : "ctrlKey"];

            // If we have a file drop target but `action` is null then this is a noop.
            if (initialFileDropTarget && !initialFileDropTarget.action) {
                return true;
            }

            handleInsertSlice({
                asyncSpanName: "<ContentEditor> drop",
                remember: [
                    view.state.selection,
                    initialFileDropTarget?.action?.pos ?? $mouse.pos,
                    draggingFileRef.current?.getPos() ?? null,
                ],
                slice,
                dataTransfer: event.dataTransfer,
                action: ([selection, mouse, draggingFilePos], slice, createTransaction) => {
                    const $mouse = view.state.doc.resolve(assertExists(mouse));
                    const fileDropTarget = initialFileDropTarget
                        ? {
                              ...initialFileDropTarget,
                              action: initialFileDropTarget.action
                                  ? {...initialFileDropTarget.action, pos: assertExists(mouse)}
                                  : null,
                          }
                        : null;

                    // NOTE: This if branch will only be executed if drop target is present that
                    // indicates we are dragging a single file. hence in the current slice only file
                    // will be present, so we can ignore other edge cases where slice may contain other
                    // nodes.
                    if (fileDropTarget) {
                        if (slice.size === 0) return;

                        assert(fileDropTarget.action);

                        // Make sure every node in the slice is a `file`. `fileDropTarget` will only be
                        // non-null if `isDraggingFile` was true when the drop started and every child of
                        // `slice` is either a `fileRow` or a `file`.
                        if (slice.content.content.some(node => node.type.name === "file")) {
                            slice = new Slice(
                                Fragment.from(
                                    slice.content.content.map(node =>
                                        node.type.name === "file"
                                            ? schema.node(
                                                  isSelectionInContentTable(selection)
                                                      ? "fileRowTable"
                                                      : "fileRow",
                                                  {},
                                                  [node],
                                              )
                                            : node,
                                    ),
                                ),
                                slice.openStart,
                                slice.openEnd,
                            );
                        }

                        let isDraggingFileFloat = false;
                        const transaction = createTransaction();

                        const $draggingFilePos =
                            draggingFilePos !== null
                                ? transaction.doc.resolve(draggingFilePos)
                                : null;
                        if ($draggingFilePos !== null) {
                            if ($draggingFilePos.nodeAfter?.type.name === "file") {
                                isDraggingFileFloat =
                                    $draggingFilePos.parent.type.name === "fileFloat";

                                // If we're moving a file then let's make sure to delete the file from our doc
                                // before adding it back.
                                if (!hasCopyKeyModifier) {
                                    if ($draggingFilePos.parent.childCount === 1) {
                                        transaction.delete(
                                            $draggingFilePos.pos - 1,
                                            $draggingFilePos.pos + 2,
                                        );
                                    } else {
                                        transaction.delete(
                                            $draggingFilePos.pos,
                                            $draggingFilePos.pos + 1,
                                        );
                                    }
                                }
                            }
                        }

                        const pos = transaction.mapping.map(fileDropTarget.action.pos);
                        const $pos = transaction.doc.resolve(pos);
                        switch (fileDropTarget.action.type) {
                            case "InsertFileRow": {
                                // If we're dragging a file float then preserve the file float styling.
                                if (
                                    isDraggingFileFloat &&
                                    slice.content.content.length === 1 &&
                                    slice.content.content[0]!.type.name === "fileRow" &&
                                    slice.content.content[0]!.content.content.length === 1
                                ) {
                                    slice = new Slice(
                                        Fragment.from(
                                            schema.node(
                                                "fileFloat",
                                                {
                                                    direction:
                                                        $draggingFilePos?.parent.attrs.direction ??
                                                        "left",
                                                },
                                                slice.content.content[0]!.content,
                                            ),
                                        ),
                                        slice.openStart,
                                        slice.openEnd,
                                    );
                                }

                                // If we are draging a fileRowTable node from the table and dropping it outside of
                                // the table then we need to convert the fileRowTable into a fileRow, otherwise we
                                // will end up with a fileRowTable node inside a `content_document`.
                                if (
                                    slice.content.content.length === 1 &&
                                    slice.content.content[0]!.type.name === "fileRowTable"
                                ) {
                                    slice = new Slice(
                                        Fragment.from(
                                            schema.node(
                                                "fileRow",
                                                {},
                                                slice.content.content[0]!.content,
                                            ),
                                        ),
                                        slice.openStart,
                                        slice.openEnd,
                                    );
                                }

                                // Empty paragraph after cursor
                                if (
                                    $pos.nodeAfter?.type.name === "paragraph" &&
                                    $pos.nodeAfter.content.size === 0
                                ) {
                                    transaction.replace(pos, pos + 2, slice);

                                    transaction
                                        .setSelection(
                                            new NodeSelection(transaction.doc.resolve(pos + 1)),
                                        )
                                        .scrollIntoView();
                                } else if (
                                    // Empty paragraph before cursor
                                    $pos.nodeBefore?.type.name === "paragraph" &&
                                    $pos.nodeBefore.content.size === 0
                                ) {
                                    transaction.replace(pos - 2, pos, slice);

                                    transaction
                                        .setSelection(
                                            new NodeSelection(transaction.doc.resolve(pos - 1)),
                                        )
                                        .scrollIntoView();
                                } else {
                                    // No empty paragraphs adjacent
                                    transaction.insert(pos, slice.content);

                                    transaction
                                        .setSelection(
                                            new NodeSelection(transaction.doc.resolve(pos + 1)),
                                        )
                                        .scrollIntoView();
                                }
                                break;
                            }
                            case "InsertFileIntoRow": {
                                assert(slice.size > 0);

                                const fileNodes: Array<Node> = [];

                                for (const fileRowNode of slice.content.content) {
                                    assert(fileRowNode.type.name === "fileRow");

                                    for (const fileNode of fileRowNode.content.content) {
                                        assert(fileNode.type.name === "file");

                                        fileNodes.push(fileNode);
                                    }
                                }

                                // A non-empty slice will have at least one `FileId`. If the slice is empty then we
                                // return above.
                                assert(fileNodes.length > 0);

                                // We need to use the first file node instead of creating a new node from the
                                // `FileId` to preserve any comment marks on the file.
                                transaction.insert(pos, fileNodes[0]!);

                                const $newPos = transaction.doc.resolve(pos);

                                transaction
                                    .setSelection(new NodeSelection($newPos))
                                    .scrollIntoView();

                                // If there's more than one file, then add all additional files as new rows after
                                // the row we inserted into.
                                if (fileNodes.length > 1) {
                                    const fileNodesByRow: Array<Array<Node>> = [[]];

                                    for (const fileNode of fileNodes.slice(1)) {
                                        if (fileNodesByRow[fileNodesByRow.length - 1]!.length < 3) {
                                            fileNodesByRow[fileNodesByRow.length - 1]!.push(
                                                fileNode,
                                            );
                                        } else {
                                            fileNodesByRow.push([fileNode]);
                                        }
                                    }

                                    assert($newPos.parent.type.name === "fileRow");

                                    transaction.insert(
                                        $newPos.after(),
                                        fileNodesByRow.map(fileNodes =>
                                            schema.node(
                                                "fileRow",
                                                {},
                                                fileNodes.map(fileNode => fileNode),
                                            ),
                                        ),
                                    );
                                }
                                break;
                            }
                            case "InsertFileRowTable": {
                                assert(slice.size > 0);

                                const isSourceFileRowTable =
                                    slice.content.content.length === 1 &&
                                    slice.content.content[0]!.type.name === "fileRowTable";

                                if (!isSourceFileRowTable) {
                                    const fileNodes: Array<Node> = [];

                                    for (const sourceNode of slice.content.content) {
                                        if (
                                            sourceNode.type.name === "fileRow" ||
                                            sourceNode.type.name === "fileFloat"
                                        ) {
                                            for (const fileNode of sourceNode.content.content) {
                                                assert(fileNode.type.name === "file");
                                                fileNodes.push(fileNode);
                                            }
                                        } else if (sourceNode.type.name === "file") {
                                            // very unlikely to happen Direct file node
                                            fileNodes.push(sourceNode);
                                        }
                                    }

                                    slice = new Slice(
                                        Fragment.from(
                                            fileNodes.map(fileNode =>
                                                schema.node("fileRowTable", {}, [fileNode]),
                                            ),
                                        ),
                                        0,
                                        0,
                                    );
                                }

                                // Same logic as `InsertFileRow` statement
                                if (
                                    $pos.nodeAfter?.type.name === "paragraph" &&
                                    $pos.nodeAfter.content.size === 0
                                ) {
                                    transaction.replaceRange(pos, pos + 2, slice);
                                    transaction
                                        .setSelection(
                                            new NodeSelection(transaction.doc.resolve(pos + 1)),
                                        )
                                        .scrollIntoView();
                                } else if (
                                    // Empty paragraph before cursor
                                    $pos.nodeBefore?.type.name === "paragraph" &&
                                    $pos.nodeBefore.content.size === 0
                                ) {
                                    transaction.replaceRange(pos - 2, pos, slice);
                                    transaction
                                        .setSelection(
                                            new NodeSelection(transaction.doc.resolve(pos - 1)),
                                        )
                                        .scrollIntoView();
                                } else {
                                    // No empty paragraphs adjacent
                                    transaction.insert(pos, slice.content);
                                    transaction
                                        .setSelection(
                                            new NodeSelection(transaction.doc.resolve(pos + 1)),
                                        )
                                        .scrollIntoView();
                                }

                                break;
                            }

                            default:
                                throw exhaustive(fileDropTarget.action);
                        }

                        view.focus();
                        view.dispatch(transaction);
                        return;
                    }

                    // NOTE(rohit): This is a hack to ensure that the slice is transformed for the
                    // content table. This happens when you drag and drop a slice which may or may not
                    // contain any file nodes.
                    //
                    // While file drag and drop only generated drop indications when we drag single
                    // file. Although a user can select multiple nodes including multiple files and
                    // then they can drag the whole slice and drop in the `content_table` To ensure
                    // that we still are able to convert the fileRow/ fileFloat nodes into fileRowTable
                    // nodes we transform the slice here.
                    if (isPosInContentTable($mouse)) {
                        const [transformedSlice, remainingSlice] = transformPastedForContentTable(
                            schema,
                            slice,
                        );
                        slice = transformedSlice;

                        // Validate remainingSlice exists and has content before proceeding
                        if (remainingSlice && remainingSlice.content.size > 0) {
                            const originalCreateTransaction = createTransaction;
                            createTransaction = () => {
                                const transaction = originalCreateTransaction();
                                // Insert remainingSlice after the table
                                const insertPos = $mouse.after(1);
                                transaction.insert(insertPos, remainingSlice.content);
                                return transaction;
                            };
                        }
                    }

                    // Implement the same logic as ProseMirror's `drop` function:
                    // https://github.com/ProseMirror/prosemirror-view/blob/d27ff92999b2aedca18c34efaab8fa5e695dcc8f/src/input.ts#L674-L707
                    //
                    // Except use `selection` which may be different than `view.state.selection` and
                    // our re-defined `$mouse` variable since the position may have moved while we were
                    // asynchronously processing the drop.

                    let insertPos = slice
                        ? dropPoint(view.state.doc, $mouse.pos, slice)
                        : $mouse.pos;
                    if (insertPos == null) insertPos = $mouse.pos;

                    const transaction = createTransaction();
                    if (move) {
                        selection
                            // We need to map `selection` because `createTransaction()` may insert some stuff
                            // (e.g. `remainingSlice` from `transformPastedForContentTable()`) into the
                            // document above our selection.
                            .map(transaction.doc, transaction.mapping)
                            .replace(transaction);
                    }

                    const pos = transaction.mapping.map(insertPos);

                    const isNode =
                        slice.openStart === 0 &&
                        slice.openEnd === 0 &&
                        slice.content.childCount === 1;

                    const beforeInsert = transaction.doc;
                    // if single node, use `replaceRangeWith`
                    if (isNode) transaction.replaceRangeWith(pos, pos, slice.content.firstChild!);
                    // if we need to replace by a slice, use `replaceRange`
                    else transaction.replaceRange(pos, pos, slice);
                    if (transaction.doc.eq(beforeInsert)) return;

                    const $pos = transaction.doc.resolve(pos);

                    if (
                        isNode &&
                        NodeSelection.isSelectable(slice.content.firstChild!) &&
                        $pos.nodeAfter &&
                        $pos.nodeAfter.sameMarkup(slice.content.firstChild!)
                    ) {
                        transaction.setSelection(new NodeSelection($pos));
                    } else {
                        let end = transaction.mapping.map(insertPos);
                        transaction.mapping.maps[transaction.mapping.maps.length - 1]!.forEach(
                            (from, to, newFrom, newTo) => (end = newTo),
                        );

                        transaction.setSelection(
                            view.someProp("createSelectionBetween", f =>
                                f(view, $pos, transaction.doc.resolve(end)),
                            ) || TextSelection.between($pos, transaction.doc.resolve(end)),
                        );
                    }

                    view.focus();
                    view.dispatch(transaction.setMeta("uiEvent", "drop"));
                },
            });

            // Pass any files from this paste or drop we didn't handle to our parent component.
            if (
                temporaryPastedFileInfosForParent &&
                temporaryPastedFileInfosForParent.length > 0 &&
                propsRef.current.onPasteOrDropFiles
            ) {
                propsRef.current.onPasteOrDropFiles(temporaryPastedFileInfosForParent);
            }

            // We completely override ProseMirror's drop logic and implement our own. Our paste
            // logic is derived from ProseMirror's drop logic.
            return true;
        };

        /* ========================================================================== *\
         *                               Insert events                                *
        \* ========================================================================== */

        const insertFiles = (posOrSelection: number | Selection, files: ReadonlyArray<File>) => {
            if (files.length === 0) return;

            const fileIds: Array<FileId> = [];

            for (const file of files) {
                const fileId = generateFileIdWithSynchronizedClock();
                fileIds.push(fileId);

                // Cleanup `temporaryPastedFileInfoById` after a microtask. `handlePaste` will use
                // this map synchronously after `transformPastedDOM`.
                if (temporaryPastedFileInfoById === undefined) {
                    temporaryPastedFileInfoById = new Map();
                    scheduleMicrotask(() => {
                        temporaryPastedFileInfoById = undefined;
                    });
                }

                temporaryPastedFileInfoById.set(fileId, {
                    type: "UploadFile",
                    input: {type: "File", file},
                });
            }

            const fileIdsByRow: Array<Array<FileId>> = [[]];

            for (const fileId of fileIds) {
                if (fileIdsByRow[fileIdsByRow.length - 1]!.length < 3) {
                    fileIdsByRow[fileIdsByRow.length - 1]!.push(fileId);
                } else {
                    fileIdsByRow.push([fileId]);
                }
            }

            const slice = new Slice(
                Fragment.from(
                    fileIdsByRow.map(fileIds =>
                        schema.node(
                            isPosInContentTable(
                                posOrSelection instanceof Selection
                                    ? posOrSelection.$head
                                    : view.state.doc.resolve(posOrSelection),
                            )
                                ? "fileRowTable"
                                : "fileRow",
                            {},
                            fileIds.map(fileId => schema.node("file", {fileId})),
                        ),
                    ),
                ),
                0,
                0,
            );

            handleInsertSlice({
                asyncSpanName: "<ContentEditor> insert files",
                remember: [posOrSelection],
                slice,
                dataTransfer: null,
                action: ([posOrSelection], slice, createTransaction) => {
                    const transaction = createTransaction();

                    const singleNode =
                        slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1
                            ? slice.content.firstChild
                            : null;

                    // The various code paths we support here:
                    //
                    // 1. Inserting a file from the insert menu. In a document the insert menu can be
                    //    found either in the "more" menu or from a right click. We support inserting
                    //    both when the selection is in text and when we have a file `NodeSelection`.
                    //
                    // 2. Replacing a file from the replace button in `<ContentEditorFileToolbar>`.
                    //
                    // 3. Adding new files from the add file button in `<ContentEditorFileToolbar>`.
                    //
                    // If `posOrSelection` is a number we're inserting into that position. If
                    // `posOrSelection` is a `Selection` then we're replacing that selection.
                    if (typeof posOrSelection === "number") {
                        let pos = posOrSelection;
                        let $pos = view.state.doc.resolve(pos);

                        if ($pos.parent.type.name !== "fileRow" || $pos.parent.childCount >= 3) {
                            // Instead of splitting a full file row, insert after the file row.
                            pos = $pos.parent.type.name === "fileRow" ? $pos.after() : pos;
                            $pos = $pos.pos !== pos ? view.state.doc.resolve(pos) : $pos;

                            transaction.insert(pos, slice.content);

                            // Make sure we select the first file after inserting so the user can make further
                            // modifications from there (like left/right aligning the file).
                            if (slice.content.firstChild) {
                                const $newPos = findInsertedNodeAfterReplaceRangeWith(
                                    $pos,
                                    transaction.doc,
                                    slice.content.firstChild,
                                );

                                if ($newPos) {
                                    transaction.setSelection(
                                        new NodeSelection(transaction.doc.resolve($newPos.pos + 1)),
                                    );
                                }
                            }
                        }
                        // If we're inserting into a file row that's not full, let's add files to the row
                        // until the row is full and then start adding file rows after the full file row.
                        else {
                            const maxInsertChildCount = 3 - $pos.parent.childCount;

                            assert(fileIds.length > 0);
                            assert(maxInsertChildCount > 0);

                            transaction.insert(
                                pos,
                                createArrayWithLength(
                                    Math.min(maxInsertChildCount, fileIds.length),
                                    index => schema.node("file", {fileId: fileIds[index]}),
                                ),
                            );

                            transaction.setSelection(
                                new NodeSelection(transaction.doc.resolve(pos)),
                            );

                            {
                                const fileIdsByRow: Array<Array<FileId | null>> = [[]];

                                for (const fileId of fileIds.slice(maxInsertChildCount)) {
                                    if (fileIdsByRow[fileIdsByRow.length - 1]!.length < 3) {
                                        fileIdsByRow[fileIdsByRow.length - 1]!.push(fileId);
                                    } else {
                                        fileIdsByRow.push([fileId]);
                                    }
                                }

                                if ((fileIdsByRow[0]?.[0]?.length ?? 0) > 0) {
                                    transaction.insert(
                                        $pos.after() + maxInsertChildCount,
                                        fileIdsByRow.map(fileIds =>
                                            schema.node(
                                                "fileRow",
                                                {},
                                                fileIds.map(fileId =>
                                                    schema.node("file", {fileId}),
                                                ),
                                            ),
                                        ),
                                    );
                                }
                            }
                        }
                    } else {
                        const selection = posOrSelection;

                        // If this is not a file node selection then replace the selection with our
                        // `fileRow`(s) slice.
                        if (
                            !(selection instanceof NodeSelection) ||
                            selection.node.type.name !== "file"
                        ) {
                            if (singleNode) {
                                selection.replaceWith(transaction, singleNode);
                            } else {
                                selection.replace(transaction, slice);
                            }

                            // Make sure we select the first file after inserting so the user can make further
                            // modifications from there (like left/right aligning the file).
                            if (slice.content.firstChild) {
                                const $newPos = findInsertedNodeAfterReplaceRangeWith(
                                    selection.$from,
                                    transaction.doc,
                                    slice.content.firstChild,
                                );

                                if ($newPos) {
                                    transaction.setSelection(
                                        new NodeSelection(transaction.doc.resolve($newPos.pos + 1)),
                                    );
                                }
                            }
                        }
                        // If this is a file node selection then take the first file from our `fileRow`(s)
                        // slice and replace the selected `FileId` with that first file. All other files
                        // will be added to `fileRow`s below.
                        else {
                            assert(fileIds.length > 0);

                            // If the editor selection moved then make sure we're selecting our file.
                            if (transaction.selection !== selection)
                                transaction.setSelection(selection);

                            transaction.setNodeAttribute(selection.anchor, "fileId", fileIds[0]!);

                            // If there were more than one `FileId`s then add them in rows after the file
                            // parent we updated.
                            //
                            // NOTE(calebmer, 2024-10-15): I don't think this code path runs in practice. The
                            // replace file button only allows uploading a single file and the insert menu code
                            // path intentionally moves the selection off a file so we don't replace it. I
                            // include this code path only for completeness.
                            {
                                const fileIdsByRow: Array<Array<FileId | null>> = [[]];

                                for (const fileId of fileIds.slice(1)) {
                                    if (fileIdsByRow[fileIdsByRow.length - 1]!.length < 3) {
                                        fileIdsByRow[fileIdsByRow.length - 1]!.push(fileId);
                                    } else {
                                        fileIdsByRow.push([fileId]);
                                    }
                                }

                                if ((fileIdsByRow[0]?.[0]?.length ?? 0) > 0) {
                                    transaction.insert(
                                        posOrSelection.$anchor.after(),
                                        fileIdsByRow.map(fileIds =>
                                            schema.node(
                                                "fileRow",
                                                {},
                                                fileIds.map(fileId =>
                                                    schema.node("file", {fileId}),
                                                ),
                                            ),
                                        ),
                                    );
                                }
                            }
                        }
                    }

                    view.focus();
                    view.dispatch(transaction.scrollIntoView());
                },
            });
        };

        const insertFileFromUrl = (url: URL) => {
            const fileId = generateFileIdWithSynchronizedClock();

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

            const posOrSelection = view.state.selection;

            const slice = new Slice(
                Fragment.from(
                    schema.node(
                        isPosInContentTable(posOrSelection.$head) ? "fileRowTable" : "fileRow",
                        {},
                        [schema.node("file", {fileId})],
                    ),
                ),
                0,
                0,
            );

            handleInsertSlice({
                asyncSpanName: "<ContentEditor> insert file from URL",
                remember: [posOrSelection],
                slice,
                dataTransfer: null,
                action: ([posOrSelection], slice, createTransaction) => {
                    const transaction = createTransaction();

                    if (
                        posOrSelection instanceof NodeSelection &&
                        posOrSelection.node.type.name === "file"
                    ) {
                        posOrSelection.replaceWith(transaction, schema.node("file", {fileId}));
                    } else {
                        const singleNode = slice.content.firstChild;
                        if (singleNode) {
                            posOrSelection.replaceWith(transaction, singleNode);
                        } else {
                            posOrSelection.replace(transaction, slice);
                        }
                    }

                    if (slice.content.firstChild) {
                        const $newPos = findInsertedNodeAfterReplaceRangeWith(
                            posOrSelection.$from,
                            transaction.doc,
                            slice.content.firstChild,
                        );

                        if ($newPos) {
                            transaction.setSelection(
                                new NodeSelection(transaction.doc.resolve($newPos.pos + 1)),
                            );
                        }
                    }

                    view.focus();
                    view.dispatch(transaction.scrollIntoView());
                },
            });
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

            // Open date picker with keyboard when Enter is pressed inside a date decoration.
            if (
                hasDatePickerUiFeatureForEditorView &&
                event.key === "Enter" &&
                !event.altKey &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey
            ) {
                const {from} = view.state.selection;
                const dateMatch = getContentEditorDateMatchAtPos(view.state, from);
                if (dateMatch && from > dateMatch.from && from < dateMatch.to) {
                    event.preventDefault();
                    openDatePicker(view, dateMatch, true);
                    return true;
                }
            }

            if (
                typeof propsRef.current.onModEnterKeyDown === "function" &&
                event.key === "Enter" &&
                !event.altKey &&
                !event.shiftKey &&
                // Cmd+Enter triggers this on MacOS and Ctrl+Enter triggers this elsewhere
                (isAppleDevice ? event.metaKey : event.ctrlKey)
            ) {
                propsRef.current.onModEnterKeyDown(event);
                if (event.defaultPrevented) return true;
            }

            if (
                typeof propsRef.current.onEnterKeyDownFromPhysicalKeyboard === "function" &&
                event.key === "Enter" &&
                !event.altKey &&
                !event.shiftKey &&
                // Ctrl+Enter on non-MacOS platforms should trigger the callback
                (!isAppleDevice || !event.ctrlKey) &&
                // Cmd+Enter on MacOS platforms should trigger the callback
                (isAppleDevice || !event.metaKey) &&
                // On a physical keyboard where the user has access to Shift+Enter we sometimes
                // want enter to send the message or otherwise save what's being edited. On a
                // virtual, mobile, keyboard (like the iOS touchscreen keyboard) we want enter to
                // insert a newline and have the user submit their message with a button press.
                !isVirtualKeyboardEvent(event)
            ) {
                propsRef.current.onEnterKeyDownFromPhysicalKeyboard(event);
                if (event.defaultPrevented) return true;
            }

            if (typeof propsRef.current.onEscapeKeyDown === "function" && event.key === "Escape") {
                propsRef.current.onEscapeKeyDown(event);
                if (event.defaultPrevented) return true;
            }

            if (
                typeof propsRef.current.onArrowUpKeyDown === "function" &&
                event.key === "ArrowUp"
            ) {
                propsRef.current.onArrowUpKeyDown(event);
                if (event.defaultPrevented) return true;
            }

            // Override copy keyboard shortcut when copying files. For some reason the browser
            // doesn't execute the `copy` event when there's a file `NodeSelection`. Even if it
            // did, it's still good to run `handleContentFileCopy()` since it'll write an
            // `image/png` to the clipboard as well.
            if (
                event.key === "c" &&
                (isAppleDevice ? event.metaKey : event.ctrlKey) &&
                view.state.selection instanceof NodeSelection &&
                view.state.selection.node.type.name === "file"
            ) {
                const spaceId = assertExists(spaceContextRef.current?.space.id);
                const fileId: FileId | FileEntityId | null = view.state.selection.node.attrs.fileId;

                if (fileId && isId<FileId>(fileId)) {
                    const selectedNodeElement = view.dom.getElementsByClassName(
                        "ProseMirror-selectednode",
                    )[0];

                    if (selectedNodeElement) {
                        const fileReference = fileId
                            ? getContentEditorReferences(view.state).references.fileById?.get(
                                  fileId,
                              )
                            : undefined;

                        const file = fileReference
                            ? getFileRegistry(spaceId).getFileStore(fileReference).getSnapshot()
                            : null;

                        handleCopyContentFile(selectedNodeElement, {
                            spaceId,
                            file,
                            attachmentTarget: assertExists(propsRef.current.fileAttachmentTarget),
                        }).catch(scheduleUncaughtError);
                    }

                    return true;
                }
            }

            return false;
        };

        viewProps.handleScrollToSelection = () => {
            // Before scrolling to selection, synchronously flush scrollbar resizes. When the
            // user is deleting content, our custom scrollbar from `scrollbar.tsx`'s height
            // will shrink once `ResizeObserver` or `MutationObserver` call their callbacks.
            // However, ProseMirror will call its `scrollRectIntoView()` function BEFORE these
            // callbacks are called. Leading to an incorrect scroll because the parent
            // element's scroll height is larger than it should be given our custom scrollbar
            // from `scrollbar.tsx` hasn't updated its height yet.
            //
            // The fix is to make sure we synchronously flush scrollbar resizes before
            // `scrollRectIntoView()` is called.
            //
            // You can see a bug this fixes [here][1]. Notice how in the bad example when
            // deleting the document underneath scrolls! Which shouldn't happen.
            //
            // [1]: https://gist.github.com/calebmer/7ac49a81c466b14cf3bac987e7bb65a9
            flushScrollbarResizeSync(view.dom);

            // If the user is in a table then we want to scroll to the edges of the table cell
            // that we're in instead of the edge of the text.
            if (
                view.state.selection instanceof TextSelection &&
                isPosInContentTable(view.state.selection.$head)
            ) {
                const cellPos = view.state.selection.$head.start(3);
                const cellElement = view.domAtPos(cellPos).node as HTMLElement;
                const cellRect = cellElement.getBoundingClientRect();
                const textRect = view.coordsAtPos(view.state.selection.head, 1);

                const overflowGradientWidthPx = convertRemLengthToPx(
                    contentStyles.tableOverflowGradientWidth,
                    getSpacingScaleWithoutListening(),
                );

                const rect = {
                    top: textRect.top,
                    bottom: textRect.bottom,
                    left: cellRect.left - overflowGradientWidthPx,
                    right: cellRect.right + overflowGradientWidthPx,
                };

                scrollRectIntoView(view, rect, document.getSelection()!.focusNode!);
                return true;
            }

            return false;
        };

        // We add this handler in a patch to `prosemirror-view`.
        viewProps.handleSelectionEnter = () => {
            if (!view.hasFocus()) setHasSelectionEnteredWhenUnfocused(true);
            propsRef.current.onSelectionEnter?.();
            return false;
        };

        // We add this handler in a patch to `prosemirror-view`.
        viewProps.handleSelectionLeave = () => {
            if (!view.hasFocus()) setHasSelectionEnteredWhenUnfocused(false);
            propsRef.current.onSelectionLeave?.();
            return false;
        };

        // Forked from [`prosemirror-view`'s copy/paste handler][1]. The main reason for
        // forking is to call `trimSelectionInvisibleExtensionIntoAdjacentNodes()` on the
        // selection.
        //
        // [1]:
        //     https://github.com/ProseMirror/prosemirror-view/blob/a72140e2113aebbd4c76d88ab43cbe7dfc838dd7/src/input.ts#L585-L602
        const handleCopyOrCut = (view: EditorView, event: ClipboardEvent) => {
            const isCut = event.type === "cut";

            const originalSelection = view.state.selection;
            if (originalSelection.empty) return false;

            const selection = trimSelectionInvisibleExtensionIntoAdjacentNodes(originalSelection);

            const slice = view.state.doc.slice(selection.$from.pos, selection.$to.pos);

            const {dom, text} = serializeForClipboard(view, slice);

            const clipboardData = event.clipboardData;
            if (!clipboardData) {
                // We [expect to always have `clipboardData` based on the browsers we support][1].
                // So don't add a fallback like the one in `prosemirror-view`.
                //
                // [1]: https://caniuse.com/?search=clipboardData
            } else {
                event.preventDefault();
                clipboardData.clearData();
                clipboardData.setData("text/html", dom.innerHTML);
                clipboardData.setData("text/plain", text);
            }

            if (isCut) {
                view.dispatch(
                    view.state.tr
                        .deleteRange(selection.$from.pos, selection.$to.pos)
                        .scrollIntoView()
                        .setMeta("uiEvent", "cut"),
                );
            }

            return true;
        };

        viewProps.handleDOMEvents = {
            copy: handleCopyOrCut,
            cut: handleCopyOrCut,
            mousedown: (view, event) => {
                const posResult = view.posAtCoords({left: event.clientX, top: event.clientY});

                // If clicking below all content (in the bottom padding area) and the last block is
                // not a paragraph, insert an empty paragraph and put the cursor there. This
                // provides a convenient way to continue typing after ending a document with a
                // non-paragraph block like a code block, quote, or list.
                if (
                    propsRef.current.withMouseDownAtEndCreatesParagraph &&
                    posResult &&
                    posResult.inside === -1
                ) {
                    const doc = view.state.doc;
                    const lastChild = doc.lastChild;

                    if (lastChild && lastChild.type.name !== "paragraph") {
                        // Get the DOM element for the last child to check if click is below it
                        const lastChildPos = doc.content.size - lastChild.nodeSize;
                        const lastChildDom = view.nodeDOM(lastChildPos);

                        if (lastChildDom instanceof HTMLElement) {
                            const lastChildRect = lastChildDom.getBoundingClientRect();

                            // Check if click is below the last child element
                            if (event.clientY > lastChildRect.bottom) {
                                const schema = view.state.schema;
                                const paragraphType = schema.nodes.paragraph;

                                // Only insert if the schema has a paragraph node type
                                if (paragraphType) {
                                    const paragraph = paragraphType.create();
                                    const insertPos = doc.content.size;
                                    const transaction = view.state.tr;
                                    transaction.insert(insertPos, paragraph);
                                    transaction.setSelection(
                                        TextSelection.create(transaction.doc, insertPos + 1),
                                    );
                                    view.dispatch(transaction);
                                    view.focus();
                                    return true;
                                }
                            }
                        }
                    }
                }

                if (view.hasFocus()) return false;

                // If the `<ContentEditor>` is unfocused and the user clicks inside with their
                // mouse then focus the position they clicked on `mousedown`. ProseMirror will set
                // the selection on `mouseup` ([part 1][1], [part 2][2]) but we want the selection
                // to be set on `mousedown` instead as that's what's consistent with browser
                // behavior.
                //
                // [1]:
                //     https://github.com/ProseMirror/prosemirror-view/blob/a72140e2113aebbd4c76d88ab43cbe7dfc838dd7/src/input.ts#L294
                // [2]:
                //     https://github.com/ProseMirror/prosemirror-view/blob/a72140e2113aebbd4c76d88ab43cbe7dfc838dd7/src/input.ts#L401

                if (posResult) {
                    const $pos = view.state.doc.resolve(posResult.pos);
                    const selection = Selection.near($pos);

                    if (view.state.selection.eq(selection)) return true;

                    view.dispatch(view.state.tr.setSelection(selection).setMeta("pointer", true));
                }

                view.focus();

                return true;
            },
            keyup: (view, event) => {
                // Implement keyboard shortcuts when the mention floater is open:
                const floaterState = getContentEditorFloaterState(view.state);
                if (floaterState.type === "Mention") {
                    floaterState.handleKeyUpRef.current?.(event);
                }
            },
        };

        /* ========================================================================== *\
         *                 ProseMirror/React reconciliation (part 1)                  *
        \* ========================================================================== */

        viewProps.dispatchTransaction = transaction => {
            const oldState = view.state;

            // By default, applying a transaction will clear the editor's stored marks. We
            // don't want that behavior! Instead we want to preserve stored marks until a user
            // either explicitly toggles them off or moves their selection somewhere else in
            // the document.
            const shouldResetStoredMarks = !transaction.docChanged && transaction.selectionSet;
            if (!shouldResetStoredMarks && oldState.storedMarks && !transaction.storedMarksSet) {
                transaction.setStoredMarks(oldState.storedMarks);
            }

            const newState = oldState.apply(transaction);

            lastTransactionRef.current = transaction;

            // Always call the change handler through a ref. By using a ref we can avoid
            // destroying and recreating an editor when the function changes.
            //
            // We also must flush synchronously. Since ProseMirror preserves local DOM state
            // when we call `updateState()` synchronously but won't otherwise.
            //
            // See the "Efficient updating" section in the [editor view guide][1]. If we don't
            // synchronously apply the transaction it is considered cancelled. A quote from the
            // guide:
            //
            // > When such a transaction is canceled or modified somehow, the view will undo
            // > the DOM change...
            //
            // [1]: https://prosemirror.net/docs/guide/#view
            flushSync(() => {
                propsRef.current.onChange(wrap(newState), transaction);
            });

            // If the state change was accepted (`view.updateState()` was called by `onChange`
            // triggering a React re-render which is synchronous thanks to `flushSync()` which
            // runs the layout effect in `<ContentEditor>` which calls `view.updateState()`)
            // then tell our spell checker about the transaction.
            if (view.state !== oldState) {
                spellChecker?.handleTransaction(transaction);
            }
        };

        const view = new EditorView(rootElement, viewProps);

        /* ========================================================================== *\
         *                               Spell checker                                *
        \* ========================================================================== */

        const spellChecker = spaceContextRef.current
            ? new ContentEditorSpellChecker({
                  getContext: () => assertExists(contextRef.current),
                  getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
                  spaceId: spaceContextRef.current.space.id,
                  view,
              })
            : null;

        /* ========================================================================== *\
         *                         Dual input modality events                         *
        \* ========================================================================== */

        if (isMobileWebKit) {
            // NOTE(calebmer, #mobile-webkit-weirdness): This is a fix for what I consider to
            // be a Safari bug. In iOS the selection highlight and caret color is controlled by
            // the `caret-color` CSS property. On desktop the caret color defaults to the
            // current text color. On iOS the caret color defaults to `WKWebView`'s `tintColor`
            // property. On desktop, we want the caret color to be `grey-100` even while in a
            // link so the cursor color doesn't change as the user moves it across different
            // styles. So we set `caret-color` to `grey-100` in `content_schema.css.ts`.
            // However on iOS we want the caret/selection color to be `WKWebView`'s
            // `tintColor`. The problem is:
            //
            // 1. Setting [`caret-color: initial` in WebKit also sets the stored caret color
            //    (which initially is null) to the current text color][1]
            // 2. If the `WKWebView`'s `tintColor` is specifically `UIColor.systemBlue` (the
            //    default `tintColor`) [WebKit uses the stored caret color][2] if it's not null
            //    instead of `tintColor`
            //
            // 1 seems like the correct behavior on MacOS Safari but on iOS Safari when we set
            // `caret-color: initial` we want `WKWebView`'s `tintColor` even if it's
            // `UIColor.systemBlue`. Not the text color which is black. This seems like a bug
            // in iOS Safari but it's easy to workaround by manually setting caret color back
            // to `UIColor.systemBlue`.
            //
            // This will override `WKWebView`'s custom `tintColor` if `tintColor` not system
            // blue so we have to be a little careful. In our native mobile app we set a
            // non-system blue `tintColor` so we need to set `caret-color: initial` when
            // running in our native mobile app shell.
            //
            // [1]:
            //     https://github.com/WebKit/WebKit/blob/ccd45357bd2ad7e46bbf93b899234eeb1c62cca2/Source/WebCore/rendering/style/RenderStyleSetters.h#L171
            // [2]:
            //     https://github.com/WebKit/WebKit/blob/1a78cf12c8f5ff2e296f7eb25ff4bcbc86cfbfe8/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L4341-L4345
            view.dom.style.caretColor = NativeMobileBridge ? "initial" : "-apple-system-blue";
        }

        // Manage content editor's dual input modality on mobile devices. Content editor
        // starts in a read only state where elements are interactive and after a tap
        // becomes editable.
        //
        // NOTE(calebmer): The logic here also exists in a nearly identical form in
        // `<TaskRowTitleInput>` since that component supports dual modality on mobile too.
        // If you make a change here you probably also want to make a change there and vice
        // versa.
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

                    // If the content isn't editable a tap shouldn't focus it.
                    if (!hasAccessLevel(propsRef.current.accessLevel ?? "Manage", "Edit")) return;

                    // If our view already has focus, we don't need a tap to give it focus.
                    if (view.hasFocus()) return;

                    // Only support a single touch.
                    if (event.touches.length !== 1) return;
                    const touch = event.touches[0]!;

                    // If there's a focused element this tap dismisses the focus. It doesn't make the
                    // editor editable.
                    if (
                        (document.activeElement && document.activeElement !== document.body) ||
                        view.state.selection instanceof NodeSelection
                    ) {
                        return;
                    }

                    let isTargetInteractive = false;
                    if (event.target instanceof HTMLElement && view.dom.contains(event.target)) {
                        let element: HTMLElement | null = event.target;

                        while (element !== null && element !== view.dom) {
                            if (
                                element.classList.contains(linkClassName) ||
                                element.classList.contains(commentClassName) ||
                                element.classList.contains(fileClassName) ||
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
                    // element, then they handle the touch event. The touch will not give our editor
                    // focus.
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

                            // Make sure, again, that the content is editable before focusing.
                            if (!hasAccessLevel(propsRef.current.accessLevel ?? "Manage", "Edit"))
                                return;

                            const posResult = view.posAtCoords({
                                left: touch.clientX,
                                top: touch.clientY,
                            });
                            if (!posResult) return;

                            // By default, iOS will move the selection to the end of the word you touched. We
                            // instead want focus moved to the selection specified in our `setSelection()`
                            // call.
                            event.preventDefault();

                            // This may seem strange. Shouldn't `setIsFocused(true)` be set from an event
                            // handler after `focus()` is called? Well in this case our editor is not editable
                            // if we are in dual modality state and `isFocused` is false. When our editor is
                            // not editable it's also not focusable. So we need to set `isFocused` to true to
                            // be able to focus!
                            //
                            // We must call `focus()` during the `touchend` event since iOS won't open the
                            // software keyboard unless focus happens in a user-initiated event. So we call
                            // `flushSync()` to make sure `isFocused` is updated synchronously so we can call
                            // `focus()` synchronously.
                            flushSync(() => setIsFocused(true));
                            view.focus();

                            const $pos = view.state.doc.resolve(posResult.pos);
                            view.dispatch(
                                view.state.tr.setSelection(TextSelection.between($pos, $pos)),
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
                // If our tap state hasn't been cancelled we actually successfully received a tap!
                touchState?.finish(event);
                touchState = null;
            });

            view.dom.addEventListener("touchcancel", () => {
                touchState?.cancel();
                touchState = null;
            });

            handleDocumentSelectionChange = () => {
                // After a long press, iOS selects text. If we see the selection change during a
                // tap we no longer have a tap gesture and instead we have a long press gesture.
                touchState?.cancel();
                touchState = null;
            };

            document.addEventListener("selectionchange", handleDocumentSelectionChange);
        }

        /* ========================================================================== *\
         *                       Drag and drop events (part 2)                        *
        \* ========================================================================== */

        // Manage the file drag interaction. While the user is dragging we'll update our
        // `fileDropTarget` state with the rendered drop target. When the user drops we
        // process the drop in `handleDrop` above.
        let fileDragState: ContentEditorFileDragState | null = null;

        view.dom.addEventListener("dragenter", event => {
            if (!fileDragState) {
                const state = ContentEditorFileDragState.onDragEnter(event, view, {
                    getDraggingPos: () => draggingFileRef.current?.getPos() ?? null,
                    onDropTargetChange: setFileDropTarget,
                    onDispose: () => {
                        if (fileDragState === state) {
                            fileDragState = null;
                        }
                    },
                });

                fileDragState = state;
            }
        });

        // Stash the editor view instance on the DOM node for debugging and tests.
        (rootElement as any)[internalEditorViewKey] = view;

        viewRef.current = Object.assign(view, {
            insertFiles,
            insertFileFromUrl,
            getBlockWidth: () => blockWidthRef.current,
            getAccessLevel: () => propsRef.current.accessLevel ?? "Manage",
        });

        return () => {
            viewRef.current = null;
            document.removeEventListener("selectionchange", handleDocumentSelectionChange);
            tripleClickDragStateRef.current?.dispose();
            fileDragState?.dispose();
            spellChecker?.destroy();
            view.destroy();
        };

        // IMPORTANT: If the view ref ever changes I suspect things will start breaking.
        // (Though I'm not entirely sure.) Child components may be written assuming a
        // constant view. Make sure this is always an empty dependency array.
        //
        // Don't ignore `react-hooks/exhaustive-deps` ESLint warnings! Instead remove
        // whatever's causing the warning.
    }, []);

    /* ========================================================================== *\
     *                 ProseMirror/React reconciliation (part 2)                  *
    \* ========================================================================== */

    const [selectedNodeState, setSelectedNodeState] = useState<{
        readonly key: Key;
        readonly element: HTMLElement;
    } | null>(null);

    // Reconcile our imperative `EditorView` state with state from React. If this is
    // run by `dispatchTransaction()` (which updates state in `flushSync()`) then this
    // should be flushed synchronously given this is a layout effect.
    useLayoutEffect(() => {
        const newState = unwrap(state);

        const view = assertExists(viewRef.current);
        const viewElement = view.dom;
        const oldState = view.state;

        // Get the transaction that produced `newState`.
        let transaction = lastTransactionRef.current;
        lastTransactionRef.current = null;
        if (transaction?.doc !== newState.doc) transaction = null;

        // When ProseMirror applies a mark like `code` or `italic`, under the hood what
        // happens is the text to be marked is removed from the DOM. Then a new `<code>` or
        // `<em>` element is inserted into the DOM. Removing the text from the DOM
        // sometimes causes the content editor to temporarily shrink. Then adding the text
        // back sets the content editor back to its original size.
        //
        // To explain this visually. Let's say you have the following wrapped text in your
        // content editor.
        //
        // ```
        // The quick brown fox jumps over
        // the lazy dog
        // ```
        //
        // I'm selecting "over the lazy dog" to turn it into italic text. To produce this
        // change in the DOM, ProseMirror will first _delete_ the text "over the lazy dog".
        //
        // ```
        // The quick brown fox jumps
        // ```
        //
        // Then it will _insert_ the text again wrapped in an `<em>` element.
        //
        // ```
        // The quick brown fox jumps <em>over
        // the lazy dog</em>
        // ```
        //
        // So you can see that temporarily the content editor's height went from 2 lines of
        // text to 1 line of text.
        //
        // This causes a bug in `<ChatView>` (and perhaps other message surfaces). In
        // `<ChatView>` we use `display: flex` with the chat messages setting
        // `flex-grow: 1` and the chat message input setting `flex-shrink: 1`. So the chat
        // messages take up all vertical space not used by the message input. The chat
        // messages is a scrollable area usually scrolled to bottom.
        //
        // If the chat message input shrinks then grows then the chat message area will
        // grow then shrink! Causing the chat message area to scroll up if it was
        // previously scrolled to the bottom. You can see this bug [here][1].
        //
        // The fix is to set `min-height` on the content editor right before calling
        // `view.updateState()` when ProseMirror applies its updates to the DOM. Then
        // removing `min-height` after `view.updateState()` finishes. That way the content
        // editor never shrinks below its original height when content is temporarily
        // removed.
        //
        // [1]:
        //     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/zkhvbgxayzf05xzt2bm7p9veyg
        const previousMinHeight = view.dom.style.minHeight;
        try {
            const viewRect = view.dom.getBoundingClientRect();
            view.dom.style.minHeight = `${viewRect.height}px`;

            view.updateState(newState);
        } finally {
            if (previousMinHeight) {
                view.dom.style.minHeight = previousMinHeight;
            } else {
                view.dom.style.removeProperty("min-height");
            }
        }

        // If the document changes then map our triple click selection based on the
        // document changes.
        if (tripleClickDragStateRef.current) {
            if (!tripleClickDragStateRef.current.selection) {
                tripleClickDragStateRef.current.selection = newState.selection;
            } else if (!transaction) {
                tripleClickDragStateRef.current.dispose();
            } else if (transaction.docChanged) {
                tripleClickDragStateRef.current.selection =
                    tripleClickDragStateRef.current.selection.map(
                        newState.doc,
                        transaction.mapping,
                    );
            }
        }

        const selection = state.getSelection();

        // Keep track of the element ProseMirror marks as selected with the
        // `ProseMirror-selectednode` CSS class so that we can render our own custom ring
        // around it.
        //
        // Don't render a `<FocusRing>` for selected mentions.
        if (!(selection instanceof NodeSelection) || selection.node.type.name === "mention") {
            setSelectedNodeState(null);
        } else {
            const selectedNodeElement = viewElement.getElementsByClassName(
                "ProseMirror-selectednode",
            )[0];
            if (selectedNodeElement instanceof HTMLElement) {
                setSelectedNodeState(selectedNodeState => {
                    if (selectedNodeState?.element === selectedNodeElement)
                        return selectedNodeState;

                    return {key: generateId(), element: selectedNodeElement};
                });
            } else {
                setSelectedNodeState(null);
            }
        }

        // Emit a content references change for any subscribers (typically node views which
        // depend on content references).
        if (
            referencesUpdateEmitterRef.current &&
            getContentEditorReferences(oldState).references !==
                getContentEditorReferences(newState).references
        ) {
            referencesUpdateEmitterRef.current.emit();
        }

        // Close the history stack if we're making cross-node edits. If we're editing
        // within an `inlineContent` node then allow history entries to be grouped but if
        // we're editing across nodes (e.g. typing in a paragraph, then hit enter, then
        // created a code block all within the history debounce delay) we want to close
        // history each time the selected node changes while editing.
        if (oldState.doc !== newState.doc) {
            const isTypingWithinInlineContent =
                oldState.selection.$from.parent.inlineContent &&
                newState.selection.$from.parent.inlineContent &&
                oldState.selection.$from.parent === oldState.selection.$to.parent &&
                newState.selection.$from.parent === newState.selection.$to.parent &&
                oldState.selection.$from.start() === newState.selection.$from.start();

            if (!isTypingWithinInlineContent) {
                scheduleMicrotask(() => {
                    view.dispatch(closeHistory(view.state.tr));
                });
            }
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

    // Make sure `isFocused` is false if we can't edit since the content editor will be
    // `contenteditable="false"`.
    if (isFocused && !hasEditAccessLevel) setIsFocused(false);

    // Will be true if the selection has entered the `<ContentEditor>` but the editor
    // isn't focused. For example, when `accessLevel` is `View` and we're selecting
    // text.
    const [hasSelectionEnteredWhenUnfocused, setHasSelectionEnteredWhenUnfocused] = useState(false);
    if (isFocused && hasSelectionEnteredWhenUnfocused) setHasSelectionEnteredWhenUnfocused(false);

    const [decorationCallbacks, setDecorationCallbacks] = useState<
        ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
    >(() => new Set());

    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        view.setProps({
            editable: () => hasEditAccessLevel && (!isDualModality || isFocused),

            decorations: state => {
                let decorationSet = DecorationSet.empty;

                decorationSet = addEmojiDecorations(decorationSet, state.doc);

                for (const decorationCallback of decorationCallbacks) {
                    decorationSet = decorationCallback(decorationSet, state);
                }

                return decorationSet;
            },
        });
    }, [accessLevel, decorationCallbacks, hasEditAccessLevel, isDualModality, isFocused]);

    /* ========================================================================== *\
     *                              View attributes                               *
    \* ========================================================================== */

    // Apply `className`s from our `className` prop. Take care to make sure class names
    // added by ProseMirror or other effects continue to be applied.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);
        const viewElement = view.dom;

        const classList = classNames(
            contentStyles.docClassName,
            routeLayout === "narrow" ? contentStyles.narrowRouteLayoutDocClassName : undefined,
            className,
        ).split(" ");
        viewElement.classList.add(...classList);

        if (style?.minHeight !== undefined) {
            if (typeof style.minHeight === "number") {
                viewElement.style.minHeight = `${style.minHeight}px`;
            } else {
                viewElement.style.minHeight = style.minHeight;
            }
        }
        if (style?.paddingTop !== undefined) {
            if (typeof style.paddingTop === "number") {
                viewElement.style.paddingTop = `${style.paddingTop}px`;
            } else {
                viewElement.style.paddingTop = style.paddingTop;
            }
        }
        if (style?.paddingBottom !== undefined) {
            if (typeof style.paddingBottom === "number") {
                viewElement.style.paddingBottom = `${style.paddingBottom}px`;
            } else {
                viewElement.style.paddingBottom = style.paddingBottom;
            }
        }
        if (style?.paddingLeft !== undefined) {
            if (typeof style.paddingLeft === "number") {
                viewElement.style.paddingLeft = `${style.paddingLeft}px`;
            } else {
                viewElement.style.paddingLeft = style.paddingLeft;
            }
        }
        if (style?.paddingRight !== undefined) {
            if (typeof style.paddingRight === "number") {
                viewElement.style.paddingRight = `${style.paddingRight}px`;
            } else {
                viewElement.style.paddingRight = style.paddingRight;
            }
        }
        if (style?.borderRadius !== undefined) {
            if (typeof style.borderRadius === "number") {
                viewElement.style.borderRadius = `${style.borderRadius}px`;
            } else {
                viewElement.style.borderRadius = style.borderRadius;
            }
        }

        return () => {
            viewElement.classList.remove(...classList);

            if (style?.minHeight !== undefined) {
                viewElement.style.removeProperty("min-height");
            }
            if (style?.paddingTop !== undefined) {
                viewElement.style.removeProperty("padding-top");
            }
            if (style?.paddingBottom !== undefined) {
                viewElement.style.removeProperty("padding-bottom");
            }
            if (style?.paddingLeft !== undefined) {
                viewElement.style.removeProperty("padding-left");
            }
            if (style?.paddingRight !== undefined) {
                viewElement.style.removeProperty("padding-right");
            }
            if (style?.borderRadius !== undefined) {
                viewElement.style.removeProperty("border-radius");
            }
        };
    }, [
        className,
        routeLayout,
        style?.borderRadius,
        style?.minHeight,
        style?.paddingBottom,
        style?.paddingLeft,
        style?.paddingRight,
        style?.paddingTop,
    ]);

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

    const stateDoc = state.getDoc();
    const isTitleEmpty = isContentTitleEmpty(stateDoc);
    const isBodyEmpty = isContentBodyEmpty(stateDoc) || isBodyEmptyFromProps;

    // Set `aria-placeholder` on the editor for accessibility and then
    // `data-placeholder` on nodes which need to render placeholders.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        // Adds the `emptyTitleClassName` class if the editor document is empty and removes
        // the class when the editor document is not empty.
        {
            if (
                isTitleEmpty &&
                !viewElement.classList.contains(contentStyles.emptyTitleClassName)
            ) {
                viewElement.classList.add(contentStyles.emptyTitleClassName);
            }
            if (
                !isTitleEmpty &&
                viewElement.classList.contains(contentStyles.emptyTitleClassName)
            ) {
                viewElement.classList.remove(contentStyles.emptyTitleClassName);
            }

            if (isBodyEmpty && !viewElement.classList.contains(contentStyles.emptyBodyClassName)) {
                viewElement.classList.add(contentStyles.emptyBodyClassName);
            }
            if (!isBodyEmpty && viewElement.classList.contains(contentStyles.emptyBodyClassName)) {
                viewElement.classList.remove(contentStyles.emptyBodyClassName);
            }
        }

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

    // Apply a class to the view element depending on whether the shift key is down or
    // not.
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
        // Chrome we won't get a shift `keyup` event. So cancel our shift/alt keydown state
        // when the context menu opens.
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
                (getComputedStyle(event.target).userSelect ||
                    // In Safari `user-select` is behind a vendor prefix.
                    getComputedStyle(event.target).webkitUserSelect) !== "none";
            isPointerDownFromSelectableElementAndMoved = false;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    view.dom.classList.add(contentStyles.isDraggingSelectionDocClassName);
                } else {
                    view.dom.classList.remove(contentStyles.isDraggingSelectionDocClassName);
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
                    view.dom.classList.add(contentStyles.isDraggingSelectionDocClassName);
                } else {
                    view.dom.classList.remove(contentStyles.isDraggingSelectionDocClassName);
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
                    view.dom.classList.add(contentStyles.isDraggingSelectionDocClassName);
                } else {
                    view.dom.classList.remove(contentStyles.isDraggingSelectionDocClassName);
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
    // keyboard focus to another element that's still targeting the content editor. So
    // the user needs to see what content their link/highlight will apply to.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const view = viewRef.current;
        const viewElement = view.dom;

        const blurDecorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            const floaterState = getContentEditorFloaterState(state);

            switch (floaterState.type) {
                // While the comment input is open, optimistically add the highlight style so the
                // user doesn't lose track of the text they selected.
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

        const handleFocusChange = (event?: globalThis.FocusEvent) => {
            // If `<ContentEditor>` is focused when `view.destroy()` is called then
            // `handleBlur` will be called in a `useInsertionEffect()` cleanup which will cause
            // React to log a warning. So don't change state if the view is destroyed.
            if (viewRef.current !== view) return;

            const focusedElement =
                event?.type === "focusout" ? event.relatedTarget : document.activeElement;

            const run: (action: () => void) => void = withoutFlushSync
                ? action => action()
                : // We frequently call `focus()` in a `useEffect()`. It's fine if we don't
                  // immediately flush our `isFocused` update in this context.
                  flushSyncIfNotRendering;

            run(() => {
                if (focusedElement === viewElement) {
                    setIsFocused(true);

                    setDecorationCallbacks(decorationCallbacks => {
                        if (!decorationCallbacks.has(blurDecorationCallback))
                            return decorationCallbacks;

                        const newDecorationCallbacks = new Set(decorationCallbacks);
                        newDecorationCallbacks.delete(blurDecorationCallback);
                        return newDecorationCallbacks;
                    });

                    // Keep track of the element ProseMirror marks as selected with the
                    // `ProseMirror-selectednode` CSS class so that we can render our own custom ring
                    // around it.
                    //
                    // We have this code here in addition to in the state update `useLayoutEffect()`
                    // because we've observed sometimes ProseMirror doesn't set the
                    // `ProseMirror-selectednode` class until after a focus event.
                    //
                    // Don't render a `<FocusRing>` for selected mentions.
                    if (
                        !(view.state.selection instanceof NodeSelection) ||
                        view.state.selection.node.type.name === "mention"
                    ) {
                        setSelectedNodeState(null);
                    } else {
                        const selectedNodeElement = viewElement.getElementsByClassName(
                            "ProseMirror-selectednode",
                        )[0];
                        if (selectedNodeElement instanceof HTMLElement) {
                            setSelectedNodeState(selectedNodeState => {
                                if (selectedNodeState?.element === selectedNodeElement)
                                    return selectedNodeState;

                                return {key: generateId(), element: selectedNodeElement};
                            });
                        } else {
                            setSelectedNodeState(null);
                        }
                    }
                } else {
                    setIsFocused(false);

                    setDecorationCallbacks(decorationCallbacks => {
                        if (decorationCallbacks.has(blurDecorationCallback))
                            return decorationCallbacks;

                        const newDecorationCallbacks = new Set(decorationCallbacks);
                        newDecorationCallbacks.add(blurDecorationCallback);
                        return newDecorationCallbacks;
                    });
                }
            });
        };

        handleFocusChange();

        withoutFlushSync = false;

        viewElement.addEventListener("focusin", handleFocusChange);
        viewElement.addEventListener("focusout", handleFocusChange);
        return () => {
            viewElement.addEventListener("focusin", handleFocusChange);
            viewElement.addEventListener("focusout", handleFocusChange);

            setDecorationCallbacks(decorationCallbacks => {
                if (!decorationCallbacks.has(blurDecorationCallback)) return decorationCallbacks;
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, []);

    /* ========================================================================== *\
     *                       Phantom selection decorations                        *
    \* ========================================================================== */

    // Highlights the selection of all our phantom text selections using the
    // ProseMirror decoration feature. We render `phantomSelections` in two parts:
    //
    // 1. The phantom text selection (only if the selection is not empty)
    // 2. The text selection cursor head
    //
    // 1 is rendered using the PromiseMirror decoration feature. 2 is rendered as
    // standard React components since inserting an element into the DOM between some
    // characters breaks kerning. Which causes some jitter when user quickly moves
    // their phantom cursor around.
    useLayoutEffect(() => {
        if (!phantomSelections || phantomSelections.length === 0) return;

        const decorations: Array<(state: EditorState) => Array<Decoration>> = [];

        for (const phantomSelection of phantomSelections) {
            if (phantomSelection.$anchor.pos !== phantomSelection.$head.pos) {
                decorations.push(state => {
                    return createPhantomSelectionDecorations(
                        state.doc,
                        TextSelection.between(phantomSelection.$anchor, phantomSelection.$head),
                        phantomSelection.color,
                    );
                });
            }
        }

        if (decorations.length === 0) return;

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(
                state.doc,
                // We need to copy the array since it looks like `DecorationSet.add()` mutates it?
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

    // Watch all parent elements of our content editor for scroll events. When a scroll
    // event occurs we want to call `dispatchParentScrollWhenPointerDownAndOverEvent()`
    // on any pressable elements.
    //
    // This replicates the behavior in `@react-aria/interactions` where a press is
    // cancelled when a parent element scrolls. This behavior is important for mobile
    // since the user must press somewhere on the screen to scroll. Normally
    // `pointercancel` should be dispatched when the user scrolls while pressing on
    // some element but when the CSS `touch-action: manipulation` is set the press is
    // not cancelled.
    //
    // We can't add listeners to parent scroll elements in our link/mark view code
    // because ProseMirror does not offer us a cleanup hook for mark views! So we add
    // listeners at this level and call
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
                    // Find all elements with the provided class names and exclude elements that are
                    // children of a file node. File entities may recursively render content (e.g.
                    // document file entities). The content within file entities is inert so shouldn't
                    // get any interactive behaviors.
                    .map(className => `.${className}:not(.${fileClassName} .${className})`)
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
    const {schema} = unwrappedState;

    assert(
        !schema.nodes.file || fileAttachmentTarget,
        "When the ProseMirror schema supports files then the prop `fileAttachmentTarget` is required",
    );

    assert(
        !schema.marks.comment || commentFileAttachmentTarget,
        "When the ProseMirror schema supports comments then the prop `commentFileAttachmentTarget` is required",
    );

    const floaterState = state.getFloaterState();

    /* ========================================================================== *\
     *                          Mobile link modal state                           *
    \* ========================================================================== */

    const [mobileLinkModalState, setMobileLinkModalState] =
        useState<ContentEditorMobileLinkModalState | null>(null);
    if (!(platform === "mobile" && !withoutMobileKeyboardToolbar) && mobileLinkModalState) {
        setMobileLinkModalState(null);
    }

    /* ========================================================================== *\
     *                         Mobile comment input state                         *
    \* ========================================================================== */

    const [isMobileCommentInputOpen, setIsMobileCommentInputOpen] = useState(false);
    if (
        (!unwrappedState.schema.marks.comment ||
            !(platform === "mobile" && !withoutMobileKeyboardToolbar)) &&
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
     *                            Date picker state                               *
    \* ========================================================================== */

    const [datePickerState, setDatePickerState] = useState<{
        key: Id;
        match: ContentEditorDateDecorationMatch;
        isVisible: boolean;
        autoFocus: boolean;
        savedSelection: Selection;
    } | null>(null);

    // A hidden anchor element positioned over the detected date text so that
    // OverlayAnimated can position the picker relative to it.
    const [datePickerAnchorElement, setDatePickerAnchorElement] = useState<HTMLDivElement | null>(
        null,
    );
    useLayoutEffect(() => {
        if (
            !hasDatePickerUiFeature ||
            !datePickerState?.isVisible ||
            !viewRef.current ||
            !datePickerAnchorElement
        ) {
            return;
        }

        const view = viewRef.current;
        const startCoords = view.coordsAtPos(datePickerState.match.from);
        const endCoords = view.coordsAtPos(datePickerState.match.to);
        const editorRect = view.dom.getBoundingClientRect();

        datePickerAnchorElement.style.position = "absolute";
        datePickerAnchorElement.style.left = `${startCoords.left - editorRect.left}px`;
        datePickerAnchorElement.style.top = `${startCoords.top - editorRect.top}px`;
        datePickerAnchorElement.style.width = `${endCoords.right - startCoords.left}px`;
        datePickerAnchorElement.style.height = `${endCoords.bottom - startCoords.top}px`;
    }, [datePickerAnchorElement, datePickerState, hasDatePickerUiFeature]);

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

    // Whenever this component renders check that `targetElement` is still in the DOM.
    // If it's not (maybe `attr`s changed or another user removed it) then reset our
    // state to null.
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

    // Whenever this component renders check that `targetElement` is still in the DOM.
    // If it's not (maybe `attr`s changed or another user removed it) then reset our
    // state to null.
    if (
        codeBlockCopyButtonTooltipState &&
        (platform === "mobile" ||
            !document.body.contains(codeBlockCopyButtonTooltipState.targetElement))
    ) {
        setCodeBlockCopyButtonTooltipState(null);
    }

    /* ========================================================================== *\
     *                                Context menu                                *
    \* ========================================================================== */

    const canUndo = state.undoDepth() > 0;
    const canRedo = state.redoDepth() > 0;

    const getContextMenuActions = useCallback(
        (
            event: MouseEvent,
        ): {
            actions: ReadonlyArray<MenuActionsSection>;
            withoutDefaultActions?: boolean;
            withSelectionAlignment?: boolean;
        } => {
            // You can't undo, redo, or insert if you don't have edit access to the document.
            if (!hasEditAccessLevel) return {actions: emptyArray};

            const view = assertExists(viewRef.current);
            const {state} = view;

            const lints = getContentEditorSpellCheckerLints(state);
            if (lints.length > 0) {
                const posResult = view.posAtCoords({left: event.clientX, top: event.clientY});

                // If the user right clicked into a lint then we want to show suggestions for that
                // lint.
                const selectedLint = posResult
                    ? lints.find(lint => {
                          if (lint.from <= posResult.pos && posResult.pos <= lint.to) {
                              return true;
                          }
                          return false;
                      })
                    : null;

                if (selectedLint) {
                    // Select the entire lint instead of doing the browser default of only selecting
                    // the word the user right clicked on.
                    view.dispatch(
                        state.tr.setSelection(
                            TextSelection.between(
                                state.doc.resolve(selectedLint.from),
                                state.doc.resolve(selectedLint.to),
                            ),
                        ),
                    );

                    const lintMenuActions: Array<MenuActionsSection> = [];

                    // TODO(#spell-check): Immediately hide lint after press so it doesn't disappear
                    // asynchronously?
                    const createLintActionOnPress = (suggestion: ContentSpellCheckSuggestion) => {
                        switch (suggestion.kind) {
                            case "replace": {
                                return () => {
                                    const fragment = Fragment.from(schema.text(suggestion.text));

                                    const transaction = state.tr.replace(
                                        selectedLint.from,
                                        selectedLint.to,
                                        new Slice(fragment, 0, 0),
                                    );

                                    // Make sure we're selecting the replaced text.
                                    transaction.setSelection(
                                        TextSelection.between(
                                            transaction.doc.resolve(selectedLint.from),
                                            transaction.doc.resolve(
                                                selectedLint.from + suggestion.text.length,
                                            ),
                                        ),
                                    );

                                    view.dispatch(transaction);
                                };
                            }
                            case "remove": {
                                return () => {
                                    const transaction = state.tr.replace(
                                        selectedLint.from,
                                        selectedLint.to,
                                        Slice.empty,
                                    );

                                    // Make sure our selection is at the location of the removed text.
                                    transaction.setSelection(
                                        TextSelection.near(
                                            transaction.doc.resolve(selectedLint.from),
                                        ),
                                    );

                                    view.dispatch(transaction);
                                };
                            }
                            case "insertafter": {
                                return () => {
                                    const transaction = state.tr.insert(
                                        selectedLint.to,
                                        schema.text(suggestion.text),
                                    );

                                    // Make sure we're selecting the replaced text.
                                    transaction.setSelection(
                                        TextSelection.between(
                                            transaction.doc.resolve(selectedLint.from),
                                            transaction.doc.resolve(
                                                selectedLint.to + suggestion.text.length,
                                            ),
                                        ),
                                    );

                                    view.dispatch(transaction);
                                };
                            }
                            default:
                                throw exhaustive(suggestion.kind);
                        }
                    };

                    const createLintActionLabel = (
                        selectedText: string,
                        suggestion: ContentSpellCheckSuggestion,
                    ) => {
                        switch (suggestion.kind) {
                            case "replace":
                                return `Replace \u201C${selectedText}\u201D with \u201C${suggestion.text}\u201D`;
                            case "remove":
                                return `Remove \u201C${selectedText}\u201D`;
                            case "insertafter":
                                return `Add \u201C${suggestion.text}\u201D after \u201C${selectedText}\u201D`;
                        }
                    };

                    const selectedLintText = state.doc.textBetween(
                        selectedLint.from,
                        selectedLint.to,
                    );

                    const heading =
                        selectedLint.suggestions.length === 0
                            ? "No Suggestions"
                            : selectedLint.suggestions.length === 1
                              ? "Suggestion"
                              : "Suggestions";

                    if (selectedLint.category === "spelling") {
                        lintMenuActions.push({
                            heading,
                            actions: selectedLint.suggestions.map(suggestion => ({
                                // For spelling issues, just show the suggested word in line
                                label: suggestion.text,
                                onPress: createLintActionOnPress(suggestion),
                            })),
                        });
                    } else {
                        lintMenuActions.push({
                            heading,
                            actions: selectedLint.suggestions.map(suggestion => ({
                                label: createLintActionLabel(selectedLintText, suggestion),
                                onPress: createLintActionOnPress(suggestion),
                            })),
                        });
                    }

                    const {onSpellCheckIgnoreLint} = propsRef.current;

                    if (onSpellCheckIgnoreLint) {
                        lintMenuActions.push([
                            {
                                label: "Ignore this issue",
                                onPress: () =>
                                    onSpellCheckIgnoreLint({
                                        key: selectedLintText,
                                        kind: selectedLint.category,
                                    }),
                                pressErrorTitle: "Couldn\u2019t ignore issue",
                            },
                        ]);
                    }

                    return {
                        actions: lintMenuActions,
                        // Don't show standard text input copy/paste actions.
                        withoutDefaultActions: true,
                        // Align the context menu next to the selection, not precisely next to the cursor.
                        // The user should be able to read the content and interpret the suggestion
                        // relative to the content.
                        withSelectionAlignment: true,
                    };
                }
            }

            return {
                actions: [
                    [
                        {
                            label: "Undo",
                            isDisabled: !canUndo,
                            keyboardShortcutHint: renderKeyboardShortcutHint(
                                clientInfo,
                                "mod",
                                "z",
                            ),
                            onPress: () => {
                                undo(view.state, view.dispatch, view);
                            },
                        },
                        {
                            label: "Redo",
                            isDisabled: !canRedo,
                            keyboardShortcutHint: renderKeyboardShortcutHint(
                                clientInfo,
                                "mod",
                                "y",
                            ),
                            onPress: () => {
                                redo(view.state, view.dispatch, view);
                            },
                        },
                    ],
                    [
                        {
                            hasChildren: true,
                            key: "insert",
                            label: "Insert",
                            actions: getContentEditorInsertMenuActions({
                                schema,
                                viewRef,
                                onOpenGifPicker: isGifPickerEnabled ? openGifPicker : undefined,
                            }),
                        },
                    ],
                ],
            };
        },
        [
            canRedo,
            canUndo,
            clientInfo,
            hasEditAccessLevel,
            isGifPickerEnabled,
            openGifPicker,
            schema,
        ],
    );

    // Manually add context menu actions on `contextmenu` event since we can't render a
    // `<ContextMenu>` component which would break our `useInsertionEffect()`.
    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        const handleContextMenu = (event: MouseEvent) => {
            const newMenuActions = getContextMenuActions(event);
            addContextMenuActions(event, newMenuActions.actions, newMenuActions);
        };

        view.dom.addEventListener("contextmenu", handleContextMenu);
        return () => {
            view.dom.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [getContextMenuActions]);

    /* ========================================================================== *\
     *                           Date picker handlers                             *
    \* ========================================================================== */

    function handleDatePickerChange(newDateString: string) {
        if (!datePickerState) return;
        const view = viewRef.current;
        if (!view) return;

        const newText = formatDateInOriginalFormat(newDateString, datePickerState.match.format);
        const {from, to} = datePickerState.match;

        // Re-focus the editor first so ProseMirror can accept the selection change. Focus
        // may have moved to the calendar overlay.
        view.focus();

        let tr = view.state.tr.replaceWith(from, to, view.state.schema.text(newText));

        // Restore the selection to where it was before the picker opened. Map through the
        // replacement in case positions shifted.
        const mappedSelection = datePickerState.savedSelection.map(tr.doc, tr.mapping);
        tr = tr.setSelection(mappedSelection);

        view.dispatch(tr);

        setDatePickerState(state => (state ? {...state, isVisible: false} : null));
    }

    // Close the date picker as soon as the cursor position changes (e.g. arrow keys,
    // clicking elsewhere). We store the selection at open time and compare on every
    // editor state update.
    const datePickerSelectionAtOpenRef = useRef<Selection | null>(null);
    useEffect(() => {
        if (!hasDatePickerUiFeature) {
            datePickerSelectionAtOpenRef.current = null;
            if (datePickerState !== null) {
                setDatePickerState(null);
            }
            return;
        }

        if (!datePickerState?.isVisible) {
            datePickerSelectionAtOpenRef.current = null;
            return;
        }

        // Record the selection on the first render after open.
        if (datePickerSelectionAtOpenRef.current === null) {
            datePickerSelectionAtOpenRef.current = unwrappedState.selection;
            return;
        }

        // Close if the selection changed at all.
        if (!unwrappedState.selection.eq(datePickerSelectionAtOpenRef.current)) {
            setDatePickerState(prev => (prev ? {...prev, isVisible: false} : null));
        }
    }, [datePickerState, hasDatePickerUiFeature, unwrappedState]);

    /* ========================================================================== *\
     *                                   Render                                   *
    \* ========================================================================== */

    return (
        <div
            ref={containerRef}
            className={classNames(
                contentEditorStyles.containerClassName,
                !canPrimaryInputHover
                    ? contentEditorStyles.canNotPrimaryInputHoverContainerClassName
                    : undefined,
                !hasEditAccessLevel ? contentEditorStyles.hasNoEditAccessClassName : undefined,
                customContainerClassName,
            )}
            onFocus={onFocus}
            onFocusCapture={onFocusCapture}
            onBlur={onBlur}
        >
            <ContentEditorFloater
                platform={platform}
                state={unwrappedState}
                accessLevel={accessLevel}
                viewRef={viewRef}
                floaterState={floaterState}
                setFloaterState={floaterState => {
                    const view = assertExists(viewRef.current);
                    view.dispatch(setContentEditorFloaterState(view.state.tr, floaterState));
                }}
                isFocused={isFocused}
                hasSelectionEnteredWhenUnfocused={hasSelectionEnteredWhenUnfocused}
                setDecorationCallbacks={setDecorationCallbacks}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
                mentionFloaterSectionOrder={mentionFloaterSectionOrder}
                onPasteOrDropFiles={onPasteOrDropFiles}
                onSelectGif={isGifPickerEnabled ? onSelectGif : undefined}
            />
            {hasDatePickerUiFeature && datePickerState && (
                <>
                    <div
                        ref={setDatePickerAnchorElement}
                        style={{position: "absolute", pointerEvents: "none"}}
                    />
                    {datePickerAnchorElement && (
                        <ContentEditorDatePickerOverlay
                            key={datePickerState.key}
                            targetElement={datePickerAnchorElement}
                            isVisible={datePickerState.isVisible}
                            date={datePickerState.match.date}
                            onDateChange={handleDatePickerChange}
                            onCloseWithAnimation={() => {
                                viewRef.current?.focus();
                                setDatePickerState(state =>
                                    state ? {...state, isVisible: false} : null,
                                );
                            }}
                            onCloseWithoutAnimation={() => {
                                viewRef.current?.focus();
                                setDatePickerState(null);
                            }}
                            autoFocus={datePickerState.autoFocus}
                        />
                    )}
                </>
            )}
            <ContentEditorFileToolbarController
                state={unwrappedState}
                viewRef={viewRef}
                isFocused={isFocused}
                accessLevel={accessLevel}
                floaterState={floaterState}
                selectedNodeElement={selectedNodeState?.element ?? null}
                hasFileDropTarget={!!fileDropTarget}
                onInsertFiles={(insertionSelection, files) =>
                    viewRef.current?.insertFiles(insertionSelection, files)
                }
                onMobileCommentInputOpen={() => {
                    setIsMobileCommentInputOpen(true);
                }}
            />
            {isFocused &&
                !fileDropTarget &&
                selectedNodeState &&
                // Only show the focus ring for selected nodes while editing. Unless we have
                // comment access and we've selected a file node. Since we still show the toolbar
                // for selected files with the only option being "Comment".
                (hasEditAccessLevel ||
                    (hasAccessLevel(accessLevel, "Comment") &&
                        unwrappedState.selection instanceof NodeSelection &&
                        unwrappedState.selection.node.type.name === "file")) && (
                    <FocusRing
                        key={selectedNodeState.key}
                        isVisible={true}
                        targetElement={selectedNodeState.element}
                        // Don't offset focus ring on file entity.
                        offset={
                            unwrappedState.selection instanceof NodeSelection &&
                            unwrappedState.selection.node.type.name === "file" &&
                            unwrappedState.selection.node.attrs.fileId?.includes(":")
                                ? "border"
                                : "0.5"
                        }
                    />
                )}
            {phantomSelections?.map(phantomSelection => (
                <ContentEditorPhantomSelectionCursor
                    key={phantomSelection.key}
                    state={unwrappedState}
                    viewRef={viewRef}
                    phantomSelection={phantomSelection}
                />
            ))}
            {platform === "mobile" && !isInert && !withoutMobileKeyboardToolbar && (
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
                    onOpenGifPicker={isGifPickerEnabled ? openGifPicker : undefined}
                />
            )}
            {mobileLinkModalState && (
                // Needs to be rendered outside of `<ContentEditorMobileKeyboardToolbar>` so that
                // when we go inert this is still rendered.
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
            {schema.marks.comment && isMobileCommentInputOpen && (
                // Needs to be rendered outside of `<ContentEditorMobileKeyboardToolbar>` so that
                // when we go inert this is still rendered.
                <ContentEditorMobileCommentInputBottomBar
                    state={unwrappedState}
                    viewRef={viewRef}
                    onClose={() => setIsMobileCommentInputOpen(false)}
                    fileAttachmentTarget={assertExists(commentFileAttachmentTarget)}
                />
            )}
            {codeBlockLanguagePickerState && (
                <ContentEditorCodeBlockLanguagePickerComboBox
                    targetElement={codeBlockLanguagePickerState.targetElement}
                    isVisible={codeBlockLanguagePickerState.isVisible}
                    onCloseWithAnimation={() => {
                        // NOTE(calebmer, #mobile-webkit-weirdness): Courtesy blur since WebKit doesn't
                        // like it when a focused element is removed from the DOM. We've observed sometimes
                        // that when this combobox closes and we don't call `blur()` WebKit will scroll us
                        // to the bottom of the parent document! It's unclear to me what causes this to
                        // happen but it's definitely the browser (`register_scroll_event_debugger.ts`
                        // doesn't report a scroll from JavaScript) and calling `blur()` beforehand helps.
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
                        // like it when a focused element is removed from the DOM. We've observed sometimes
                        // that when this combobox closes and we don't call `blur()` WebKit will scroll us
                        // to the bottom of the parent document! It's unclear to me what causes this to
                        // happen but it's definitely the browser (`register_scroll_event_debugger.ts`
                        // doesn't report a scroll from JavaScript) and calling `blur()` beforehand helps.
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
                        // Once the tooltip completely disappears (after fade out completes) then we can
                        // remove our tooltip state.
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
            {fileDropTarget?.action &&
                (fileDropTarget.action.indicator === "Top" ? (
                    <Box
                        data-testid={
                            process.env.NODE_ENV !== "production"
                                ? `ContentEditorFileDropTargetIndicator:${fileDropTarget.action.type}:${fileDropTarget.action.pos}`
                                : undefined
                        }
                        position="absolute"
                        left="0"
                        right="0"
                        height="border-thick"
                        pointerEvents="none"
                        backgroundColor="theme-40-const"
                        borderRadius="full"
                        style={{
                            left: fileDropTarget.rect.left,
                            right: `calc(100% - ${fileDropTarget.rect.right}px)`,
                            top: fileDropTarget.rect.top - 1,
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
                        width="border-thick"
                        pointerEvents="none"
                        backgroundColor="theme-40-const"
                        borderRadius="full"
                        style={{
                            top: fileDropTarget.rect.top,
                            bottom: `calc(100% - ${fileDropTarget.rect.bottom}px)`,
                            left:
                                fileDropTarget.action.indicator === "Left"
                                    ? fileDropTarget.rect.left - 1
                                    : fileDropTarget.rect.right - 1,
                        }}
                    />
                ))}
            {hasSelectionEnteredWhenUnfocused && !unwrappedState.selection.empty && (
                // When `accessLevel` is `Comment` add a global keydown listener for the comment
                // keyboard shortcut. Since the content editor won't be focused while in read-only
                // mode we need to listen to global keydown events.
                <GlobalKeyDownEvent
                    onGlobalKeyDown={event => {
                        const view = assertExists(viewRef.current);
                        const {state} = view;

                        if (
                            !view.editable &&
                            event.key === "c" &&
                            event.shiftKey &&
                            (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            if (state.selection.from !== state.selection.to) {
                                let isCommentSupported = false;
                                state.doc.nodesBetween(
                                    state.selection.from,
                                    state.selection.to,
                                    node => {
                                        isCommentSupported ||=
                                            !!schema.marks.comment &&
                                            node.type.allowsMarkType(schema.marks.comment);
                                    },
                                );

                                if (isCommentSupported) {
                                    view.dispatch(
                                        state.tr.setMeta(
                                            openContentEditorCommentInputFloaterMetaKey,
                                            true,
                                        ),
                                    );
                                }
                            }
                        }
                    }}
                />
            )}
        </div>
    );
}

// Inspired by [React internal keys][1].
//
// [1]:
//     https://github.com/facebook/react/blob/80c4dea0d1da0012977c6c4b2ac7a8bd37154d50/packages/react-dom/src/client/ReactDOMComponentTree.js#L34-L41
const internalEditorViewKey = `__prosemirrorEditorView$${Math.random().toString(36).slice(2)}`;

// We export null outside of Jest to avoid breaking fast refresh for
// `<ContentEditor>`.
//
// Ok to export this since in development it's the constant `null` which won't
// break hot reloading.

// eslint-disable-next-line react-refresh/only-export-components
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
// performing an asynchronous paste then the selection we're pasting on top of (the
// `selection` argument) may be different than the user's current selection (what's
// in `EditorState.selection`). Which is why we decompose `EditorView` here into
// just the bits we need.
function handlePasteAfterResolvingReferences(
    doc: Node,
    selection: Selection,
    createTransaction: () => Transaction,
    dispatch: (transaction: Transaction) => void,
    event: ClipboardEvent,
    slice: Slice,
): void {
    // Convert any links in text to link marks.
    slice = transformPastedLinks(doc.type.schema, slice, selection);

    // If pasting into a table, transform pasted content to make sure it matches the
    // expected content type for a table.
    {
        // flag to see if any one of the node is not tableBlock, If found, then only do
        // that transformation
        let hasNonTableContent = false;
        let remainingSlice: Slice;

        if (isSelectionInContentTable(selection)) {
            slice.content.forEach(node => {
                if (!isContentTableBlockNode(node) && node.type.name !== "tableRow") {
                    hasNonTableContent = true;
                }
            });
            if (hasNonTableContent) {
                [slice, remainingSlice] = transformPastedForContentTable(doc.type.schema, slice);

                // Validate remainingSlice exists and has content before proceeding
                if (remainingSlice && remainingSlice.content && remainingSlice.content.size > 0) {
                    const originalCreateTransaction = createTransaction;
                    createTransaction = () => {
                        const transaction = originalCreateTransaction();
                        // Insert remainingSlice after the table
                        const insertPos = selection.$anchor.after(1);
                        transaction.insert(insertPos, remainingSlice.content);
                        return transaction;
                    };
                }
            }
        }
    }

    // If the selection is a file node, insert pasted content in a new paragraph after
    // the file This matches the pattern from handleTextInput in the keymap plugin
    if (selection instanceof NodeSelection && selection.node.type.name === "file") {
        const insertPosition = selection.$anchor.after();
        const transaction = createTransaction();

        // Insert content directly at the position after the file/fileRow
        transaction.replace(insertPosition, insertPosition, slice);

        // Set selection to the end of the pasted content
        const newSelection = TextSelection.near(
            transaction.doc.resolve(insertPosition + slice.size + 1),
        );
        transaction.setSelection(newSelection);

        dispatch(transaction.setMeta("paste", true).setMeta("uiEvent", "paste"));
        return;
    }

    // First check if we're in a table - if so, delegate to table paste handler
    if (handleContentTablePaste(doc, selection, createTransaction, dispatch, slice)) return;

    if (handleLinkPasteWithSelection(doc, selection, createTransaction, dispatch, event)) return;

    // If we're pasting into an empty paragraph at the top level, then paste the entire
    // slice content with `openStart` 0 to avoid losing our first node's styling and
    // attempt to replace the paragraph.
    //
    // This matters when:
    //
    // - You're pasting content that starts with a heading in an empty paragraph
    // - You're pasting a file in an empty paragraph (the file should replace the
    //   paragraph)
    if (
        selection.$from.pos === selection.$to.pos &&
        selection.$from.depth === 1 &&
        selection.$from.parent.type.name === "paragraph" &&
        selection.$from.parent.nodeSize === 2
    ) {
        const transaction = createTransaction();

        const actualSlice = new Slice(slice.content, 0, slice.openEnd);

        replaceSelection(
            {from: selection.$from.pos - 1, to: selection.$from.pos + 1},
            transaction,
            actualSlice,
        );

        fixNodeSelectionAfterPaste(actualSlice, transaction);
        dispatch(transaction.setMeta("paste", true).setMeta("uiEvent", "paste"));
        return;
    }

    // If we're pasting a code block into a code block then we want to update
    // `openStart` and `openEnd` to 2 so we don't split the code block we're pasting
    // into. Instead assimilating the pasted code block into the current code block.
    //
    // We need this since `transformPasted` does the inverse. Making sure pasted code
    // block content always has `openStart` and `openEnd` of 0 so we don't merge code
    // content with some other node type.
    if (
        selection.$from.parent.type.name === "codeBlockLine" &&
        selection.$to.parent.type.name === "codeBlockLine" &&
        selection.$from.node(-1) === selection.$to.node(-1) &&
        (slice.content.firstChild?.type.name === "codeBlock" ||
            slice.content.lastChild?.type.name === "codeBlock")
    ) {
        if (slice.content.firstChild?.type.name === "codeBlock" && slice.openStart < 2) {
            slice = new Slice(slice.content, 2, slice.openEnd);
        }

        if (slice.content.lastChild?.type.name === "codeBlock" && slice.openEnd < 2) {
            slice = new Slice(slice.content, slice.openStart, 2);
        }

        const transaction = createTransaction();

        const singleNode =
            slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
                ? slice.content.firstChild
                : null;

        if (singleNode) {
            selection.replaceWith(transaction, singleNode);
        } else {
            selection.replace(transaction, slice);
        }

        fixNodeSelectionAfterPaste(slice, transaction);
        dispatch(transaction.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
        return;
    }

    // If you're pasting a list item (source list item) into another list item (target
    // list item) then we want to keep the target list item's type and indentation
    // level instead of overriding it with the source.
    //
    // We accomplish this by "unwrapping" the source list item's contents if we're
    // pasting into a target list item. ProseMirror will do the right thing from there.
    if (slice.openStart > 0 && slice.content.firstChild?.type.isInGroup("listItem")) {
        // Non-null if we're pasting into a list item.
        let indentForTargetListItem: number | null = null;

        for (let depth = selection.$from.depth; depth >= 0; depth--) {
            const node = selection.$from.node(depth);
            if (node.type.isInGroup("listItem")) {
                indentForTargetListItem = node.attrs.indent;
                break;
            }
        }

        if (indentForTargetListItem !== null) {
            const content: Array<Node> = [];

            for (const childNode of slice.content.firstChild.content.content) {
                content.push(childNode);
            }

            let isWithinAdjacentListItems = true;

            for (const node of slice.content.content.slice(1)) {
                // If there's another list item in the slice we're pasting then increase its
                // indentation so it sits under the target list item's indentation.
                if (!isWithinAdjacentListItems || !node.type.isInGroup("listItem")) {
                    isWithinAdjacentListItems = false;
                    content.push(node);
                } else {
                    content.push(
                        node.type.create(
                            {...node.attrs, indent: indentForTargetListItem + node.attrs.indent},
                            node.content,
                            node.marks,
                        ),
                    );
                }
            }

            slice = new Slice(
                Fragment.from(content),
                Math.max(0, slice.openStart - 1),
                slice.openEnd,
            );
        }
    }

    // Implement the same logic as ProseMirror's `doPaste` function:
    // https://github.com/ProseMirror/prosemirror-view/blob/d27ff92999b2aedca18c34efaab8fa5e695dcc8f/src/input.ts#L592-L601
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

    fixNodeSelectionAfterPaste(slice, transaction);
    dispatch(transaction.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
}

// This function is derived from `Selection.replace()` from `prosemirror-state`.
// Useful if you want the same selection replace logic (particularly with regards
// to how the new selection should be positioned) but don't want to create a
// `Selection` object.
//
// https://github.com/ProseMirror/prosemirror-state/blob/d6fdcd19c4f7f68206b0a8d49649860365672585/src/selection.ts#L70-L89
function replaceSelection(
    range: {from: number; to: number},
    transaction: Transaction,
    content: Slice,
) {
    // Put the new selection at the position after the inserted content. When that
    // ended in an inline node, search backwards, to get the position after that node.
    // If not, search forward.
    let lastNode = content.content.lastChild;
    let lastParent = null;
    for (let i = 0; i < content.openEnd; i++) {
        lastParent = lastNode!;
        lastNode = lastNode!.lastChild;
    }

    const mapFrom = transaction.steps.length;
    const {from, to} = range;
    const mapping = transaction.mapping.slice(mapFrom);
    transaction.replaceRange(mapping.map(from), mapping.map(to), content);

    const bias = (lastNode ? lastNode.isInline : lastParent && lastParent.isTextblock) ? -1 : 1;

    // The following code is derived from `selectionToInsertionEnd()` from
    // `prosemirror-state`.
    //
    // https://github.com/ProseMirror/prosemirror-state/blob/d6fdcd19c4f7f68206b0a8d49649860365672585/src/selection.ts#L454-L462

    const lastStepIndex = transaction.steps.length - 1;
    if (lastStepIndex < mapFrom) return;

    const step = transaction.steps[lastStepIndex];
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return;

    const map = transaction.mapping.maps[lastStepIndex]!;
    let end: number | undefined;

    map.forEach((from, to, newFrom, newTo) => {
        if (end === undefined) end = newTo;
    });

    transaction.setSelection(Selection.near(transaction.doc.resolve(assertExists(end)), bias));
}

/**
 * When pasting a slice that ends in a selectable node, ProseMirror puts the
 * selection into the next text block instead of in the pasted selectable node!
 * This function runs after the ProseMirror `replace()` which performs the paste to
 * detect if the last node of our slice was a selectable node and if so, make sure
 * the selection after the paste has selected the new node.
 *
 * To reproduce this try selecting a divider, copying, then pasting the divider.
 * The divider should be selected after the paste.
 */
function fixNodeSelectionAfterPaste(slice: Slice, transaction: Transaction) {
    let lastSelectableChild = slice.content.lastChild;
    while (
        lastSelectableChild?.lastChild &&
        !lastSelectableChild.inlineContent &&
        !lastSelectableChild.type.spec.selectable
    ) {
        lastSelectableChild = lastSelectableChild.lastChild;
    }

    // The last selectable child is text content. ProseMirror will correctly place the
    // selection at the end of the pasted content.
    if (!lastSelectableChild || lastSelectableChild.inlineContent) return;

    // We already have a `NodeSelection`. ProseMirror correctly placed the selection in
    // the last pasted node.
    if (
        transaction.selection instanceof NodeSelection &&
        transaction.selection.node.eq(lastSelectableChild)
    ) {
        return;
    }

    // Find a selection moving backwards from before the current selected node. This
    // should be the last node in the pasted slice.
    const newSelection = Selection.findFrom(
        transaction.doc.resolve(transaction.selection.$from.before()),
        -1,
    );

    // The new selection isn't the node selection we were hoping for...
    if (!(newSelection instanceof NodeSelection && newSelection.node.eq(lastSelectableChild)))
        return;

    transaction.setSelection(newSelection);
}

/**
 * Iterate through all content in the slice and if we find a URL in the slice's
 * text, add a link mark around the URL.
 */
function transformPastedLinks(
    schema: ProsemirrorSchema,
    slice: Slice,
    selection: Selection,
): Slice {
    // Don't auto link content in code
    if (selection.$from.marks().some(mark => mark.type.name === "code")) return slice;

    // Don't auto link content in code
    for (let depth = selection.$from.depth; depth >= 0; depth--) {
        if (selection.$from.node(depth).type.name === "codeBlock") return slice;
    }

    const urlRegExp = getUrlRegExp();

    const newFragment = transformFragment(slice.content);
    if (slice.content === newFragment) return slice;
    return new Slice(newFragment, slice.openStart, slice.openEnd);

    function transformFragment(oldFragment: Fragment): Fragment {
        let hasChanged = false;
        const newNodes: Array<Node> = [];

        for (const oldNode of oldFragment.content) {
            const newNode = transformNode(oldNode);

            if (newNode !== oldNode) hasChanged = true;

            if (newNode instanceof Fragment) {
                for (const actualNewChildNode of newNode.content) {
                    newNodes.push(actualNewChildNode);
                }
            } else {
                newNodes.push(newNode);
            }
        }

        if (!hasChanged) return oldFragment;
        return Fragment.fromArray(newNodes);
    }

    function transformNode(oldNode: Node): Node | Fragment {
        // Don't auto link content in code
        if (oldNode.type.name === "codeBlock") return oldNode;
        if (oldNode.marks.some(mark => mark.type.name === "code")) return oldNode;

        if (
            oldNode.type.name !== "text" ||
            // If this text already has a link mark, then don't override the link mark.
            schema.marks.link!.isInSet(oldNode.marks)
        ) {
            if (oldNode.content.content.length === 0) return oldNode;
            const newFragment = transformFragment(oldNode.content);
            if (oldNode.content === newFragment) return oldNode;
            return oldNode.type.create(oldNode.attrs, newFragment, oldNode.marks);
        }

        const text = oldNode.text!;
        const matches = Array.from(text.matchAll(urlRegExp));
        if (matches.length === 0) return oldNode;

        let lastIndex = 0;
        const newNodes: Array<Node> = [];

        for (const match of matches) {
            const startIndex = assertExists(match.index);
            const endIndex = startIndex + match[0].length;

            if (lastIndex !== startIndex) {
                newNodes.push(schema.text(text.slice(lastIndex, startIndex), oldNode.marks));
            }

            lastIndex = endIndex;

            const url = text.slice(startIndex, endIndex);
            newNodes.push(schema.text(url, schema.mark("link", {url}).addToSet(oldNode.marks)));
        }

        if (lastIndex !== text.length) {
            newNodes.push(schema.text(text.slice(lastIndex, text.length), oldNode.marks));
        }

        return Fragment.fromArray(newNodes);
    }
}

/**
 * If pasting/dropping content into a table, transform pasted content to make sure
 * it matches the expected content type for a table.
 */
function transformPastedForContentTable(
    schema: ProsemirrorSchema,
    slice: Slice,
): [slice: Slice, remainingSlice: Slice] {
    const remainingContent: Array<Node> = []; // paste outside of table in next position
    const primaryContent: Array<Node> = []; // paste inside of table / table cell with modifications
    slice.content.content.forEach(node => {
        // NOTE(rohit): It is recommended that once we add one node to remainingContent,
        // all future nodes in the slice should be remainingContent. The reason being if
        // you paste content like this:

        // <p>Text explaining table 1</p>
        // <table><!-- Table 1 --></table>
        // <p>Text explaining table 2</p>
        // <table><!-- Table 2 --></table>

        // It would be weird to paste this inside the table:
        //
        // <p>Text explaining table 1</p>
        // <p>Text explaining table 2</p>
        //
        // …and this outside the table:
        //
        // <table><!-- Table 1 --></table>
        // <table><!-- Table 2 --></table>
        //
        // I feel like it would make more sense to the user if we paste this inside the
        // table:
        //
        // <p>Text explaining table 1</p>
        // …and this outside the table:

        // <table><!-- Table 1 --></table>
        // <p>Text explaining table 2</p>
        // <table><!-- Table 2 --></table>
        //
        // This doesn't break the user's intent. However reordering their content might
        // break the user's intent!
        if (remainingContent.length > 0) {
            remainingContent.push(node);
            return;
        }

        switch (node.type.name) {
            case "table": {
                remainingContent.push(node);
                break;
            }

            case "heading": {
                const boldMark = assertExists(schema.marks.bold).create();
                const paragraphType = assertExists(schema.nodes.paragraph);

                const paragraphNode = paragraphType.create(
                    null,
                    node.content.content.map(childNode => {
                        assert(childNode.isText);
                        return childNode.mark(boldMark.addToSet(childNode.marks));
                    }),
                );
                primaryContent.push(paragraphNode);
                break;
            }

            case "file":
            case "fileRow":
            case "fileFloat": {
                const fileNodes: Array<Node> = [];

                if (node.type.name === "fileRow" || node.type.name === "fileFloat") {
                    for (const fileNode of node.content.content) {
                        assert(fileNode.type.name === "file");
                        fileNodes.push(fileNode);
                    }
                } else if (node.type.name === "file") {
                    // very unlikely to happen Direct file node
                    fileNodes.push(node);
                }

                fileNodes.forEach(fileNode => {
                    const fileRowTableNode = schema.node("fileRowTable", {}, [fileNode]);
                    primaryContent.push(fileRowTableNode);
                });
                break;
            }

            case "divider": {
                // Divider nodes are dropped completely
                break;
            }

            default: {
                // Check if node is allowed in table cell Allow table block nodes, text nodes, and
                // inline nodes (like mentions)
                if (isContentTableBlockNode(node) || node.type.name === "text" || node.isInline) {
                    primaryContent.push(node);
                } else {
                    remainingContent.push(node);
                }
                break;
            }
        }
    });

    return [
        primaryContent.length > 0
            ? new Slice(
                  Fragment.fromArray(primaryContent),
                  primaryContent[0] === slice.content.firstChild ? slice.openStart : 0,
                  primaryContent[primaryContent.length - 1] === slice.content.lastChild
                      ? slice.openEnd
                      : 0,
              )
            : Slice.empty,
        remainingContent.length > 0
            ? new Slice(Fragment.fromArray(remainingContent), 0, 0)
            : Slice.empty,
    ];
}

/**
 * If the user has selected some text and they paste a link then we want to convert
 * the selected text to a link instead of replacing the text.
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

    // 3. Instead of replacing the selected text with the replaced text we instead add
    //    a link mark to the selection.
    const range = trimSpacesFromProsemirrorRange(doc, selection);
    dispatch(
        createTransaction().addMark(range.from, range.to, doc.type.schema.mark("link", {url})),
    );
    return true;
}

/**
 * Create decorations that carefully recreate browser text selection styles. So far
 * we've only tested this on Chrome for MacOS. May need tweaks to match Windows
 * styles.
 *
 * Some things to consider when creating selection styles in Chrome for MacOS:
 *
 * - The height of the selection should match the text's line height. Not content
 *   height. We can't find a CSS property to let us target an inline element's line
 *   height with a background color so we carefully add some padding.
 *
 * - Selection adds some extra space at the end of selected paragraphs to show that
 *   you are selecting a newline.
 */
function createPhantomSelectionDecorations(doc: Node, selection: Selection, color: ThemeColor) {
    const decorations = [
        Decoration.inline(selection.from, selection.to, {
            class: contentStyles.phantomSelectionClassName,
            style: `background-color:${selectionColorSchemeVars[`${color}-selection`]}`,
        }),
    ];

    // Add newline indicators to the end of selected paragraphs and headers like
    // browser selection styles.
    //
    // Particularly important to show we've selected an empty paragraph or header.
    //
    // Also give selected files a tint so other users know when they're selected.
    doc.nodesBetween(
        // We've found `selection.to` is sometimes `doc.nodeSize - 1` which causes
        // ProseMirror to throw an error.
        clamp(0, selection.from, doc.nodeSize - 2),
        clamp(0, selection.to, doc.nodeSize - 2),
        (node, pos) => {
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
                        selectionColorSchemeVars[`${color}-selection`];
                    newlineIndicatorElement.style.userSelect = "none";
                    // In Safari `user-select` is behind a vendor prefix.
                    newlineIndicatorElement.style.webkitUserSelect = "none";
                    newlineIndicatorElement.ariaHidden = "true";
                    return newlineIndicatorElement;
                }),
            );
        },
    );

    return decorations;
}

/**
 * Add a decoration for every emoji in the editor that wraps the emoji in a
 * `<span>` and changes the font to `emojiFontFamily`. Otherwise we end up using
 * characters from our default font (Inter). For example, Inter has a heart glyph
 * but we don't want to use that glyph.
 *
 * Since traversing the entire doc can be expensive for large docs we have a
 * caching layer that takes advantage of structural sharing in the immutable doc
 * representation.
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

class ContentEditorTripleClickDragState {
    public selection: Selection | null = null;

    private readonly _view: EditorView;
    private readonly _onDispose: () => void;
    private readonly _autoScroll: ContentEditorDragAutoScrollState;

    private _isDisposed = false;
    private _pointerX: number;
    private _pointerY: number;

    private constructor(
        pointerX: number,
        pointerY: number,
        view: EditorView,
        {onDispose}: {onDispose: () => void},
    ) {
        this._view = view;
        this._onDispose = onDispose;

        this._pointerX = pointerX;
        this._pointerY = pointerY;

        this._autoScroll = new ContentEditorDragAutoScrollState(view.dom, {
            onScroll: this._move,
        });

        document.addEventListener("mousemove", this._onMouseMove);
        document.addEventListener("mouseup", this.dispose);
        document.addEventListener("dragstart", this.dispose);
    }

    public static onTripleClick(
        event: MouseEvent,
        view: EditorView,
        options: {onDispose: () => void},
    ) {
        return new ContentEditorTripleClickDragState(event.clientX, event.clientY, view, options);
    }

    public readonly dispose = () => {
        assert(!this._isDisposed);
        this._isDisposed = true;

        document.removeEventListener("mousemove", this._onMouseMove);
        document.removeEventListener("mouseup", this.dispose);
        document.removeEventListener("dragstart", this.dispose);

        this._autoScroll.dispose();

        this._onDispose();
    };

    private readonly _onMouseMove = (event: MouseEvent) => {
        if (event.buttons === 0) {
            this.dispose();
            return;
        }

        this._pointerX = event.clientX;
        this._pointerY = event.clientY;

        this._move();

        this._autoScroll.onPointerMove(this._pointerY);
    };

    private readonly _move = () => {
        assert(!this._isDisposed);

        // We expect the selection to be updated by ProseMirror's default triple click
        // support synchronously after `handleTripleClick` is called. So
        // `originalSelection` shouldn't be null. Silently ignore event if it is null.
        const originalSelection = this.selection;
        if (!originalSelection) return;

        const posResult = this._view.posAtCoords({
            left: this._pointerX,
            top: this._pointerY,
        });
        if (!posResult) return;

        const $pos = this._view.state.doc.resolve(posResult.pos);

        let selection: Selection;
        if ($pos.pos < originalSelection.from) {
            selection = TextSelection.between(originalSelection.$to, $pos, -1);
        } else if ($pos.pos > originalSelection.to) {
            selection = TextSelection.between(originalSelection.$from, $pos, 1);
        } else if (this._view.state.selection.$anchor === originalSelection.$from) {
            selection = TextSelection.between(originalSelection.$from, originalSelection.$to, -1);
        } else {
            selection = TextSelection.between(originalSelection.$to, originalSelection.$from, 1);
        }

        if (!selection.eq(this._view.state.selection)) {
            this._view.dispatch(this._view.state.tr.setSelection(selection));
        }
    };
}

class ContentEditorFileDragState {
    private readonly _view: EditorView;
    private _dropTarget: ContentEditorFileDropTarget | null = null;
    private readonly _getDraggingPos: () => number | null;
    private readonly _onDropTargetChange: (dropTarget: ContentEditorFileDropTarget | null) => void;
    private readonly _onDispose: () => void;
    private readonly _autoScroll: ContentEditorDragAutoScrollState;
    private readonly _dragContainerElement: HTMLElement;

    private _isDisposed = false;
    private _pointerX: number;
    private _pointerY: number;
    private _dragEnterCount = 0;

    private _lastDropTargets: {
        viewWidth: number;
        viewHeight: number;
        state: EditorState;
        topBlockIndex: number;
        dropTargets: Array<ContentEditorFileDropTarget>;
    } | null = null;

    private _lastDropTarget: {
        viewWidth: number;
        viewHeight: number;
        state: EditorState;
        time: number;
        dropTarget: ContentEditorFileDropTarget;
    } | null = null;

    private constructor(
        pointerX: number,
        pointerY: number,
        view: EditorView,
        {
            getDraggingPos,
            onDropTargetChange,
            onDispose,
        }: {
            getDraggingPos: () => number | null;
            onDropTargetChange: (dropTarget: ContentEditorFileDropTarget | null) => void;
            onDispose: () => void;
        },
    ) {
        this._view = view;
        this._getDraggingPos = getDraggingPos;
        this._onDropTargetChange = onDropTargetChange;
        this._onDispose = onDispose;

        this._pointerX = pointerX;
        this._pointerY = pointerY;

        this._autoScroll = new ContentEditorDragAutoScrollState(view.dom, {
            onScroll: this._move,
        });

        // Use the scrollable element as the drag container element if we have it. This way
        // if while dragging your mouse is over some sticky element in the scroll view
        // (e.g. the navigation bar) we'll still auto scroll.
        this._dragContainerElement = this._autoScroll.getScrollableElement() ?? this._view.dom;

        this._dragContainerElement.addEventListener("dragenter", this._onDragEnter);
        this._dragContainerElement.addEventListener("dragleave", this._onDragLeave);
        this._dragContainerElement.addEventListener("drop", this.dispose);
        this._dragContainerElement.addEventListener("dragover", this._onDragOver);
    }

    public static onDragEnter(
        event: DragEvent,
        view: EditorView,
        options: {
            getDraggingPos: () => number | null;
            onDropTargetChange: (dropTarget: ContentEditorFileDropTarget | null) => void;
            onDispose: () => void;
        },
    ) {
        const isDraggingFile =
            event.target instanceof Element &&
            view.dom.contains(event.target) &&
            !!event.dataTransfer &&
            // In Safari, `event.dataTransfer.items` is an empty array during the `dragenter`
            // event but it exists in Chrome. `event.dataTransfer.types` works across both
            // browsers.
            iterableSome(
                event.dataTransfer.types,
                type => type === "Files" || type === "application/x.alpine.file",
            );

        if (!isDraggingFile) return null;

        const state = new ContentEditorFileDragState(event.clientX, event.clientY, view, options);

        state._move();

        return state;
    }

    public readonly dispose = () => {
        assert(!this._isDisposed);
        this._isDisposed = true;

        this._dragContainerElement.removeEventListener("dragenter", this._onDragEnter);
        this._dragContainerElement.removeEventListener("dragleave", this._onDragLeave);
        this._dragContainerElement.removeEventListener("drop", this.dispose);
        this._dragContainerElement.removeEventListener("dragover", this._onDragOver);

        this._autoScroll.dispose();

        this._dropTarget = null;
        this._onDropTargetChange(null);

        this._onDispose();
    };

    public getDropTarget() {
        return this._dropTarget;
    }

    private readonly _onDragEnter = (event: DragEvent) => {
        if (!(event.target instanceof Element) || !this._view.dom.contains(event.target)) return;

        // We don't need to increment on our static `onDragEnter` function that constructs
        // this class because that function is called in response to a `dragenter` event on
        // our EditorView's DOM whereas this `dragenter` event is attached to our
        // scrollable element. So due to event bubbling this method will be called
        // immediately after the static `onDragEnter` function.
        this._dragEnterCount++;
    };

    private readonly _onDragLeave = (event: DragEvent) => {
        if (!(event.target instanceof Element) || !this._view.dom.contains(event.target)) return;

        this._dragEnterCount--;

        // [Safari doesn't set `event.relatedTarget`][1] whereas Chrome does. If we
        // reliably had access to `event.relatedTarget` we'd check:
        // `this._dragContainerElement.contains(event.relatedTarget)`.
        //
        // Instead we look at `dragenter` event counts. Once we reach 0 that means the user
        // has fully dragged out of the container. We got the idea for this fix from [this
        // Gist][2].
        //
        // We use this method in Chrome as well (even though we could use
        // `event.relatedTarget`) to have consistent behavior across all browsers.
        //
        // [1]: https://bugs.webkit.org/show_bug.cgi?id=66547
        // [2]: https://gist.github.com/alexreardon/10c595cbb840608a2828db56df99fa79
        if (this._dragEnterCount > 0) {
            return;
        }

        this.dispose();
    };

    private readonly _onDragOver = (event: DragEvent) => {
        const lastPointerY = this._pointerY;

        this._pointerX = event.clientX;
        this._pointerY = event.clientY;

        this._move();

        if (lastPointerY !== this._pointerY) {
            this._autoScroll.onPointerMove(this._pointerY);
        }
    };

    private _move = () => {
        const dropTarget = this._selectDropTarget();

        if (dropTarget !== this._dropTarget) {
            this._dropTarget = dropTarget;
            this._onDropTargetChange(this._dropTarget);
        }
    };

    private _selectDropTarget() {
        const posResult = this._view.posAtCoords({left: this._pointerX, top: this._pointerY});
        if (!posResult) return null;

        const {width: viewWidth, height: viewHeight} = this._view.dom.getBoundingClientRect();
        const $pos = this._view.state.doc.resolve(posResult.pos);
        const topBlockIndex = $pos.index(0);
        const spacingScale = getSpacingScaleWithoutListening();

        // Recompute drop targets if the mouse moved over a new top block or anything
        // changed that may have updated the layout of our content (e.g. `viewWidth`
        // resizing changes how text flows).
        if (
            viewWidth !== this._lastDropTargets?.viewWidth ||
            viewHeight !== this._lastDropTargets.viewHeight ||
            this._view.state !== this._lastDropTargets?.state ||
            topBlockIndex !== this._lastDropTargets?.topBlockIndex
        ) {
            this._lastDropTargets = {
                viewWidth,
                viewHeight,
                state: this._view.state,
                topBlockIndex,
                dropTargets: getContentEditorFileDropTargets(
                    this._view,
                    topBlockIndex,
                    this._getDraggingPos(),
                ),
            };
        }

        // User experience win: Wait 100ms to update the drop target we display. That way
        // if the user is quickly moving their cursor over the document they don't see drop
        // indicators flashing in and out everywhere. This is especially distracting when
        // dragging horizontally across a file row with 2 items since a drop indicator
        // between the two images flashes in and in doing so hides the vertical drop
        // indicator that used to be there. This is distracting but by reusing the last
        // drop target for 100ms we improve the UX in this case.
        //
        // This function is called continuously during a drag by the `dragover` event so we
        // don't need to schedule a timeout to call `setFileDropTarget()` after 100ms.
        if (
            viewWidth === this._lastDropTarget?.viewWidth &&
            viewHeight === this._lastDropTarget.viewHeight &&
            this._view.state === this._lastDropTarget.state &&
            Date.now() - this._lastDropTarget.time < perceivedAsInstantLimitMs
        ) {
            return this._lastDropTarget.dropTarget;
        }

        let lastOffsetParent: Element | null = null;
        let lastOffsetParentRect: DOMRect | null = null;
        let nearestCollision: {
            distance: number;
            dropTarget: ContentEditorFileDropTarget;
        } | null = null;

        for (const dropTarget of this._lastDropTargets.dropTargets) {
            // If all our drop targets have the same `offsetParent` then we only need to call
            // `getBoundingClientRect()` once.
            const offsetParentRect: DOMRect | null =
                lastOffsetParent !== dropTarget.offsetParent
                    ? (dropTarget.offsetParent?.getBoundingClientRect() ?? null)
                    : lastOffsetParentRect;
            lastOffsetParent = dropTarget.offsetParent;
            lastOffsetParentRect = offsetParentRect;

            const mouseX = this._pointerX - (offsetParentRect?.left ?? 0);
            const mouseY = this._pointerY - (offsetParentRect?.top ?? 0);

            // Calculate the distance between the pointer and the droppable bounding box.
            // https://stackoverflow.com/a/18157551/1568890
            let dx = Math.max(dropTarget.rect.left - mouseX, 0, mouseX - dropTarget.rect.right);

            // We want our chosen drop target to be the nearest target vertically unless we're
            // right on top of a horizontal target. This creates the effect of as you're
            // dragging a file into a document you're only seeing the vertical drop indicators
            // flash in/out. However, if you drag to the left or right edge of an existing file
            // (or into the document margins) then you'll see horizontal drop indicators which
            // will let you create a gallery.
            //
            // What this code is doing is it penalizes horizontal distance (compared to
            // vertical distance) when you're out of a narrow range right on top of the drop
            // target.
            //
            // We choose `spacing["5"]` as the margin in which horizontal drop targets will
            // apply since that's the smallest size of an `<IconButton>`. Since we consider an
            // `xs` `<IconButton>` to have a sufficient hit target we consider the hit target
            // sufficient here too.
            if (dx > convertRemLengthToPx("5", spacingScale)) {
                dx += viewWidth;
            }

            const dy = Math.max(dropTarget.rect.top - mouseY, 0, mouseY - dropTarget.rect.bottom);
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (!nearestCollision || nearestCollision.distance > distance) {
                nearestCollision = {distance, dropTarget};
            }
        }

        const dropTarget = nearestCollision?.dropTarget ?? null;
        if (!dropTarget) {
            this._lastDropTarget = null;
        } else {
            this._lastDropTarget = {
                viewWidth,
                viewHeight,
                state: this._view.state,
                time: Date.now(),
                dropTarget,
            };
        }

        return dropTarget;
    }
}

// Our auto scroll copies the constants and math used by `@dnd-kit/core`'s
// `getScrollDirectionAndSpeed()` utility function and `useAutoScroller()` utility
// hook.
//
// https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/utilities/scroll/getScrollDirectionAndSpeed.ts#L12-L18
// https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/hooks/utilities/useAutoScroller.ts#L109-L179
class ContentEditorDragAutoScrollState {
    private readonly _scrollableElement: HTMLElement | null;
    private readonly _onScroll: () => void;
    private _isDisposed = false;
    private _directionY: -1 | 1 | 0 = 0;
    private _speedY: number = 0;
    private _interval: Interval | null = null;

    constructor(element: HTMLElement, {onScroll}: {onScroll: () => void}) {
        let scrollableElement: Element | null = element;
        while (scrollableElement) {
            const {overflowY} = getComputedStyle(scrollableElement);

            if (overflowY === "auto" || overflowY === "scroll") {
                break;
            }

            scrollableElement = scrollableElement.parentElement;
        }

        this._scrollableElement =
            scrollableElement instanceof HTMLElement ? scrollableElement : null;
        this._onScroll = onScroll;

        this._scrollableElement?.addEventListener("scroll", this._onScroll);
    }

    public dispose() {
        assert(!this._isDisposed);
        this._isDisposed = true;

        this._scrollableElement?.removeEventListener("scroll", this._onScroll);
        this._interval?.clear();
        this._interval = null;
    }

    public getScrollableElement() {
        return this._scrollableElement;
    }

    public onPointerMove(pointerY: number) {
        assert(!this._isDisposed);
        if (!this._scrollableElement) return;

        const scrollableRect = this._scrollableElement.getBoundingClientRect();

        const thresholdHeight = scrollableRect.height * 0.1;

        if (pointerY !== null && pointerY < scrollableRect.top + thresholdHeight) {
            this._directionY = -1;

            // Speed calculation taken from `getScrollDirectionAndSpeed()`:
            // https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/utilities/scroll/getScrollDirectionAndSpeed.ts#L37-L41
            this._speedY =
                10 * Math.abs((scrollableRect.top + thresholdHeight - pointerY) / thresholdHeight);
        } else if (pointerY !== null && pointerY > scrollableRect.bottom - thresholdHeight) {
            this._directionY = 1;

            // Speed calculation taken from `getScrollDirectionAndSpeed()`:
            // https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/utilities/scroll/getScrollDirectionAndSpeed.ts#L48-L53
            this._speedY =
                10 *
                Math.abs((scrollableRect.bottom - thresholdHeight - pointerY) / thresholdHeight);
        } else {
            this._interval?.clear();
            this._interval = null;
            return;
        }

        if (this._interval === null) {
            this._interval = createInterval(() => {
                const deltaY = this._speedY * this._directionY;

                this._scrollableElement!.scrollTop += deltaY;

                // 5ms interval approach taken from `useAutoScroller()`:
                // https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/hooks/utilities/useAutoScroller.ts#L61
            }, 5);
        }
    }
}
