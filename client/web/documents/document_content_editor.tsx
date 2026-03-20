import classNames from "classnames";
import {AnimationPlaybackControls, animate} from "motion";
import {
    ArrowLeft,
    ArrowUp,
    CaretDown,
    CaretLeft,
    CaretRight,
    CaretUp,
    Link as LinkIcon,
    Play,
    Plus,
    SpinnerGap,
    X,
} from "phosphor-react";
import {
    Memo,
    Ref,
    RefObject,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {
    ContentBlockWidthContextProvider,
    useContentBlockWidth,
} from "~/client/web/content/content_block_width.js";
import {ContentDuplicationInstructionalModal} from "~/client/web/content/content_duplication_instructional_modal.js";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {getContentEditorScrollAnchorPosition} from "~/client/web/content/get_content_editor_scroll_anchor_position.js";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {createContentCommentThreadMetaKey} from "~/client/web/content/state/content_editor_state.js";
import {getOptimisticContentEditorTableLayoutStore} from "~/client/web/content/state/table/content_editor_table_plugin.js";
import {resolveContentTableColumnWidthPx} from "~/client/web/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {
    mobileFullScreenModalAnimationDurationLongMs,
    mobileFullScreenModalAnimationDurationMs,
    mobileFullScreenModalAnimationEasingParsedCubicBezier,
} from "~/client/web/design/mobile_full_screen_modal.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useIsBehindMobileFullScreenModal} from "~/client/web/design/use_is_behind_mobile_full_screen_modal.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {
    DocumentCommentThreadListView,
    DocumentCommentThreadListViewRef,
} from "~/client/web/documents/document_comment_thread_list_view.js";
import {DocumentContentCoverModal} from "~/client/web/documents/internal/document_content_cover_modal.js";
import {
    DocumentContentEditorSideDecoration,
    DocumentContentEditorSideDecorations,
} from "~/client/web/documents/internal/document_content_editor_side_decorations.js";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/web/documents/internal/document_content_editor_web_socket_client.js";
import {
    DocumentContentExportFormat,
    DocumentContentExportModal,
} from "~/client/web/documents/internal/document_content_export_modal.js";
import {
    DocumentPresentationController,
    DocumentPresentationControllerRef,
} from "~/client/web/documents/internal/document_presentation_controller.js";
import {useDocumentContentEditorPhantomSelections} from "~/client/web/documents/internal/use_document_content_editor_phantom_selections.js";
import {useDocumentContentEditorSpellCheckIgnoredLints} from "~/client/web/documents/internal/use_document_content_editor_spell_check_ignored_lints.js";
import {
    SubscribeToCommentThreadEventsFunction,
    useDocumentContentEditorWebSocket,
} from "~/client/web/documents/use_document_content_editor_web_socket.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {LecturnIcon} from "~/client/web/icons/lecturn_icon.js";
import {PanoramaIcon} from "~/client/web/icons/panorama_icon.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {NavigationBarRef} from "~/client/web/navigation/navigation_bar_types.js";
import {usePeekStackContextIfExists} from "~/client/web/peek/peek_stack_context.js";
import {getClientInfo, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {
    getSpacingScaleWithoutListening,
    useSpacingScale,
} from "~/client/web/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/web/remix/use_is_inert_native_mobile_route.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {documentContentEditorSidebarWidth} from "~/client/web/styles/document_shared_styles.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonNegativeMarginX,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputMinHeightPx,
    messageInputPaddingY,
    messageViewAccountAvatarSize,
} from "~/client/web/styles/messaging_shared_styles.js";
import {
    colorSchemeVars,
    contentEditorStyles,
    contentStyles,
    documentContentStyles,
    inputPlaceholderStyles,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {
    encodeContentDuplicationVariableSchemaForUrl,
    extractContentDuplicationVariableSchema,
} from "~/shared/content/content_duplication_variable_schema.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {paragraphClassName} from "~/shared/design/core/constant_class_names.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    encodeDocumentCommentRoomKey,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {DynamoGeneralRealtimeQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InternalError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, FileId} from "~/shared/id/types/id_types.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {createDocument, duplicateDocument} from "~/shared/rpc/documents_rpc_definitions.js";
import {createSpellCheckIgnoredLint} from "~/shared/rpc/spell_check_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

const documentContentEditorMobileSidebarInsetTop = "48";

export type DocumentContentEditorInitialScroll =
    | {
          readonly type: "CommentInOpenThread";
          readonly commentIndex: number;
      }
    | {
          readonly type: "CommentThread";
          readonly commentThreadId: DocumentCommentThreadId;
      };

type DocumentContentEditorSidebarState =
    | {
          readonly isOpen: false;
          readonly transition: DocumentContentEditorSidebarTransition | null;
      }
    | {
          readonly isOpen: true;
          readonly animationState: "Opening" | "Closing" | null;
          readonly transition: DocumentContentEditorSidebarTransition | null;
          readonly commentThreadId: DocumentCommentThreadId;
          readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarData | null>;
          readonly mobileState: DocumentContentEditorSidebarMobileState;
      };

type DocumentContentEditorSidebarMobileState =
    | {
          readonly isFullScreen: false;
      }
    | {
          readonly isFullScreen: true;
          readonly animationState: "Expanding" | "Contracting" | null;
          readonly onAnimationFinishedRef: {current: (() => void) | null};
      };

type DocumentContentEditorSidebarTransition = {
    readonly commentThreadId: DocumentCommentThreadId;
    readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarData | null>;
    // Promise that resolves when the transition finishes. This may happen before the
    // data promise resolves! Or if another transition starts cancelling our previous
    // transition.
    readonly pendingPromiseResolver: PromiseResolver<void>;
};

type DocumentContentEditorSidebarData = {
    readonly checkpoint: ServerSynchronizationCheckpoint;
    readonly commentThread: DocumentCommentThreadModel;
    readonly initialComments: ReadonlyArray<DocumentCommentModel>;
    readonly initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
    readonly initialOptimisticComments: ReadonlyArray<OptimisticMessageModel>;
};

export function DocumentContentEditor({
    documentId,
    initialDocument,
    initialCommentThreadResult,
    initialSpellCheckIgnoredLints,
    initialIsFavorite,
    initialScroll,
    shouldInitiallyFocus,
    onCreate,
    onContentChange,
    onContentLocalChange,
    onCommentThreadChange,
}: {
    documentId: DocumentId;
    initialDocument: DocumentModel | null;
    initialCommentThreadResult: {
        checkpoint: ServerSynchronizationCheckpoint;
        commentThread: DocumentCommentThreadModel;
        initialComments: ReadonlyArray<DocumentCommentModel>;
        initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
    } | null;
    initialSpellCheckIgnoredLints: DynamoGeneralRealtimeQueryResult<SpellCheckIgnoredLintModel>;
    initialIsFavorite: boolean;
    initialScroll: DocumentContentEditorInitialScroll | null;
    shouldInitiallyFocus: boolean;
    onCreate: () => void;
    onContentChange?: (content: DocumentContent) => void;
    onContentLocalChange?: () => void;
    onCommentThreadChange?: (commentThreadId: DocumentCommentThreadId | null) => void;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const isInitialAppRender = useIsInitialAppRender();
    const clientInfo = useClientInfo();
    const {isNativeMobile} = clientInfo;
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {currentAccount} = useSpaceContext();
    const peekContext = usePeekContext();
    const peekStackContext = usePeekStackContextIfExists();
    const navigate = useNavigate();
    const isMounted = useIsMounted();

    const editorRef = useRef<ContentEditorRef<DocumentContentWithReferences>>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const commentThreadListViewRef = useRef<DocumentCommentThreadListViewRef>(null);
    const presentationControllerRef = useRef<DocumentPresentationControllerRef>(null);

    const editorContainerId = useId();
    const [containerResizeRef, containerSize] = useResizeObserver();
    const blockWidth = useContentBlockWidth();

    const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
    const [exportModalState, setExportModalState] = useState<{
        readonly format: DocumentContentExportFormat;
        readonly string: string;
        readonly html: string;
    } | null>(null);

    const [showDuplicateInstructionalModal, setShowDuplicateInstructionalModal] = useState(false);
    const [
        doNotShowDuplicationInstructionalModalAgain,
        setDoNotShowDuplicationInstructionalModalAgain,
    ] = useLocalStorage(
        "cyberworlds/doNotShowContentDuplicationInstructionalModalAgain",
        Schema.boolean,
        false,
    );

    const {
        spaceId,
        isConnected,
        editorState,
        onEditorStateChange,
        onClearOurPresenceState,
        onUnclearOurPresenceState,
        content,
        title,
        accessLevel,
        otherPresenceStateByConnectionId,
        rememberedSteps,
        toggleShouldConnect,
        procedures,
        subscribeToCommentThreadEvents,
        subscribeToSpellCheckIgnoredLintEvents,
        subscribeToPongs,
        unpersistedResolutionStateByCommentThreadId,
        ensureCreateDocument,
    } = useDocumentContentEditorWebSocket({documentId, initialDocument}, {onCreate});

    const phantomSelections = useDocumentContentEditorPhantomSelections({
        editorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
    });

    const {handleEventForSpellCheckIgnoredLint} = useDocumentContentEditorSpellCheckIgnoredLints({
        documentId,
        initialSpellCheckIgnoredLints,
        isConnected,
        subscribeToSpellCheckIgnoredLintEvents,
        subscribeToPongs,
    });

    useDevConsoleTool(
        "documentContentEditor",
        useCallback(
            () => ({
                prosemirrorSchema: DocumentContentProsemirrorSchema,
                toggleShouldConnect,
                createDocument: (content: any) => {
                    return createDocument(context, {
                        spaceId,
                        content: assertDocumentContent(
                            DocumentContentProsemirrorSchema.nodeFromJSON(content),
                        ),
                    });
                },
            }),
            [context, spaceId, toggleShouldConnect],
        ),
    );

    const lastContentDocRef = useRef(content.doc);
    useEffect(() => {
        if (content.doc !== lastContentDocRef.current) {
            onContentChange?.(content.doc);
            lastContentDocRef.current = content.doc;
        }
    }, [content.doc, onContentChange]);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const editor = assertExists(editorRef.current);

        if (!shouldInitiallyFocus) return;

        return scheduleAfterNavigationAnimation(() => {
            editor.focus();
        });
    }, [shouldInitiallyFocus]);

    /* ========================================================================== *\
     *                            Sidebar animations                              *
    \* ========================================================================== */

    // TODO(calebmer): The word "sidebar" is a bit of a misnomer now that on mobile
    // comments are displayed in a bottom sheet. Maybe rename someday?
    const [sidebarState, setSidebarState] = useState<DocumentContentEditorSidebarState>(() => {
        if (!initialCommentThreadResult) {
            return {
                isOpen: false,
                transition: null,
            };
        }

        const data: DocumentContentEditorSidebarData = {
            ...initialCommentThreadResult,
            initialOptimisticComments: [],
        };

        return {
            isOpen: true,
            animationState: null,
            transition: null,
            commentThreadId: initialCommentThreadResult.commentThread.id,
            dataPromise: PromiseImmediate.resolve(data),
            mobileState: {isFullScreen: false},
        };
    });

    // Sidebar may not be fullscreen if we're not on a mobile device.
    if (sidebarState.isOpen && sidebarState.mobileState.isFullScreen && platform !== "mobile") {
        setSidebarState({...sidebarState, mobileState: {isFullScreen: false}});
    }

    if (routeLayout !== "narrow" && sidebarState.isOpen && sidebarState.animationState !== null) {
        if (sidebarState.animationState === "Closing") {
            setSidebarState({isOpen: false, transition: null});
        } else {
            setSidebarState({...sidebarState, animationState: null});
        }
    }

    const pinnedCommentInputRef = useRef<MessageInputRef>(null);
    const mobileFakeCommentInputRef = useRef<HTMLDivElement>(null);
    const mobileFakeCommentInputEditorRef = useRef<HTMLDivElement>(null);

    const sidebarAnimationInRef = useRef<AnimationPlaybackControls | null>(null);
    const sidebarAnimationOutRef = useRef<AnimationPlaybackControls | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (routeLayout !== "narrow") {
            // We only animate the sidebar on narrow displays
            return;
        }

        if (!(sidebarState.isOpen && sidebarState.animationState === "Opening")) {
            sidebarAnimationInRef.current?.cancel();
            sidebarAnimationInRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarAnimationInRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const spacingScale = getSpacingScaleWithoutListening();

        const editorContainerRect = editorContainerElement.getBoundingClientRect();

        const sidebarHeight =
            editorContainerRect.height -
            convertRemLengthToPx(documentContentEditorMobileSidebarInsetTop, spacingScale);

        const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

        const animation = animate(
            [
                [
                    sidebarElement,
                    {y: [sidebarHeight, 0]},
                    {ease: mobileFullScreenModalAnimationEasingParsedCubicBezier},
                ],
                [
                    mobileFakeCommentInputElement ?? [],
                    {y: [sidebarHeight, 0]},
                    {at: 0, ease: mobileFullScreenModalAnimationEasingParsedCubicBezier},
                ],
            ],
            {
                // Add a little bit of delay so React can finish rendering before playing our
                // animation.
                delay: 0.05,
                duration: mobileFullScreenModalAnimationDurationLongMs / 1000,
            },
        );

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of both.
            if (isMobileWebKit) {
                const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

                sidebarElement.style.transform = "translateY(0)";
                if (mobileFakeCommentInputElement)
                    mobileFakeCommentInputElement.style.transform = "translateY(0)";
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll view
            // translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            // Since we have the style updates above, make sure we synchronously flush this
            // update so we paint any React changes at the same time.
            flushSync(() => {
                setSidebarState(sidebarState => {
                    if (!sidebarState.isOpen || sidebarState.animationState !== "Opening")
                        return sidebarState;

                    return {...sidebarState, animationState: null};
                });
            });
        });
        sidebarAnimationInRef.current = animation;
    }, [platform, routeLayout, sidebarState]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (routeLayout !== "narrow") {
            // We only animate the sidebar on narrow displays
            return;
        }

        if (!(sidebarState.isOpen && sidebarState.animationState === "Closing")) {
            sidebarAnimationOutRef.current?.cancel();
            sidebarAnimationOutRef.current = null;
            return;
        }

        // Already animating out...
        if (sidebarAnimationOutRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const spacingScale = getSpacingScaleWithoutListening();

        const editorContainerRect = editorContainerElement.getBoundingClientRect();

        const sidebarHeight =
            editorContainerRect.height -
            convertRemLengthToPx(documentContentEditorMobileSidebarInsetTop, spacingScale);

        const scrollBottom =
            editorContainerElement.scrollHeight -
            (editorContainerElement.scrollTop + editorContainerElement.clientHeight);

        // After our sidebar is done closing we'll remove the safe area we added to the
        // bottom of the document. If we've scrolled to the bottom of the document this
        // will cause the document to jump back into place. This is jarring so instead
        // animate a scroll along with our close animation to get us back to the right
        // place before the document size changes.
        if (scrollBottom < sidebarHeight) {
            editorContainerElement.scrollTo({
                top: editorContainerElement.scrollTop - (sidebarHeight - scrollBottom),
                behavior: "smooth",
            });
        }

        const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

        const animation = animate(
            [
                [
                    sidebarElement,
                    {y: [0, sidebarHeight]},
                    {ease: mobileFullScreenModalAnimationEasingParsedCubicBezier},
                ],
                [
                    mobileFakeCommentInputElement ?? [],
                    {y: [0, sidebarHeight]},
                    {at: 0, ease: mobileFullScreenModalAnimationEasingParsedCubicBezier},
                ],
            ],
            {
                // Add a little bit of delay so React can finish rendering before playing our
                // animation.
                delay: 0.05,
                duration: mobileFullScreenModalAnimationDurationLongMs / 1000,
            },
        );

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of both.
            if (isMobileWebKit) {
                const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

                sidebarElement.style.transform = `translateY(${sidebarHeight}px)`;
                if (mobileFakeCommentInputElement)
                    mobileFakeCommentInputElement.style.transform = `translateY(${sidebarHeight}px)`;
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll view
            // translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            // When we switch to `isOpen: false` the width of the document editor container
            // will change. We don't want to keep the `translateX()` we added during the
            // animation since it'll push the editor container offscreen.
            editorContainerElement.style.transform = "translateX(0px)";

            // Since we have the style updates above, make sure we synchronously flush this
            // update so we paint any React changes at the same time.
            flushSync(() => {
                setSidebarState(sidebarState => {
                    if (!sidebarState.isOpen || sidebarState.animationState !== "Closing")
                        return sidebarState;

                    return {isOpen: false, transition: null};
                });
            });
        });

        sidebarAnimationOutRef.current = animation;
    }, [platform, routeLayout, sidebarState]);

    // When the sidebar opens on mobile:
    //
    // 1. Add safe area to the bottom of the document of the same height as the sidebar
    //    (sidebar is positioned as a bottom sheet on mobile)
    // 2. Make sure the content editor is blurred
    useLayoutEffectWithoutServerSideWarning(() => {
        const editorContainerElement = assertExists(editorContainerRef.current);

        if (routeLayout !== "narrow" || !sidebarState.isOpen) {
            editorContainerElement.style.removeProperty("--safe-area-inset-bottom");
            return;
        }

        const editor = assertExists(editorRef.current);
        editor.blur();

        const spacingScale = getSpacingScaleWithoutListening();
        const editorContainerRect = editorContainerElement.getBoundingClientRect();

        const sidebarHeight =
            editorContainerRect.height -
            convertRemLengthToPx(documentContentEditorMobileSidebarInsetTop, spacingScale);

        editorContainerElement.style.setProperty("--safe-area-inset-bottom", `${sidebarHeight}px`);
    }, [routeLayout, sidebarState.isOpen]);

    const sidebarMobileFullScreenAnimationInRef = useRef<AnimationPlaybackControls | null>(null);
    const sidebarMobileFullScreenAnimationOutRef = useRef<AnimationPlaybackControls | null>(null);

    useEffect(() => {
        if (
            !sidebarState.isOpen ||
            !sidebarState.mobileState.isFullScreen ||
            sidebarState.mobileState.animationState !== "Expanding"
        ) {
            sidebarMobileFullScreenAnimationInRef.current?.cancel();
            sidebarMobileFullScreenAnimationInRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarMobileFullScreenAnimationInRef.current) return;

        const sidebarElement = assertExists(sidebarRef.current);

        const offset = convertRemLengthToPx(
            documentContentEditorMobileSidebarInsetTop,
            getSpacingScaleWithoutListening(),
        );

        // If the user has scrolled far enough down a comment thread (e.g. all the way to
        // the bottom) then once the expand animation finishes there'll be a bunch of empty
        // space that'll disappear once we take away the comment thread's mobile background
        // slop. Since it looks janky to animate in this empty space then take it away,
        // instead do a scroll to prevent the background slop from showing at the beginning
        // of our expand animation.
        const commentThreadListView = commentThreadListViewRef.current;
        if (commentThreadListView) {
            const scrollTop = commentThreadListView.getScrollOffset();
            const scrollBottom =
                commentThreadListView.getContentHeight() -
                (scrollTop + commentThreadListView.getHeight());

            if (scrollBottom < offset) {
                commentThreadListView.setScrollOffset(scrollTop - (offset - scrollBottom), {
                    behavior: "instant",
                });
            }
        }

        const animation = animate(
            sidebarElement,
            {y: [0, -offset]},
            {
                duration: mobileFullScreenModalAnimationDurationMs / 1000,
                ease: mobileFullScreenModalAnimationEasingParsedCubicBezier,
            },
        );

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of both.
            if (isMobileWebKit) {
                sidebarElement.style.transform = `translateY(${-offset}px)`;
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll view
            // translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            setSidebarState(sidebarState => {
                if (
                    !sidebarState.isOpen ||
                    !sidebarState.mobileState.isFullScreen ||
                    sidebarState.mobileState.animationState !== "Expanding"
                ) {
                    return sidebarState;
                }

                return {
                    ...sidebarState,
                    mobileState: {...sidebarState.mobileState, animationState: null},
                };
            });
        });

        sidebarMobileFullScreenAnimationInRef.current = animation;
    }, [sidebarState]);

    useEffect(() => {
        if (
            !sidebarState.isOpen ||
            !sidebarState.mobileState.isFullScreen ||
            sidebarState.mobileState.animationState !== "Contracting"
        ) {
            sidebarMobileFullScreenAnimationOutRef.current?.cancel();
            sidebarMobileFullScreenAnimationOutRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarMobileFullScreenAnimationOutRef.current) return;

        const sidebarElement = assertExists(sidebarRef.current);

        const offset = convertRemLengthToPx(
            documentContentEditorMobileSidebarInsetTop,
            getSpacingScaleWithoutListening(),
        );

        const animation = animate(
            sidebarElement,
            {y: [-offset, 0]},
            {
                duration: mobileFullScreenModalAnimationDurationMs / 1000,
                ease: mobileFullScreenModalAnimationEasingParsedCubicBezier,
            },
        );

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of both.
            if (isMobileWebKit) {
                sidebarElement.style.transform = "translateY(0)";
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll view
            // translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            setSidebarState(sidebarState => {
                if (
                    !sidebarState.isOpen ||
                    !sidebarState.mobileState.isFullScreen ||
                    sidebarState.mobileState.animationState !== "Contracting"
                ) {
                    return sidebarState;
                }

                return {
                    ...sidebarState,
                    mobileState: {isFullScreen: false},
                };
            });
        });

        sidebarMobileFullScreenAnimationOutRef.current = animation;
    }, [sidebarState]);

    // Focus the comment input if it was requested in our state.
    useEffect(() => {
        if (
            sidebarState.isOpen &&
            sidebarState.mobileState.isFullScreen &&
            sidebarState.mobileState.animationState === null &&
            sidebarState.mobileState.onAnimationFinishedRef.current
        ) {
            const onAnimationFinished = sidebarState.mobileState.onAnimationFinishedRef.current;

            sidebarState.mobileState.onAnimationFinishedRef.current = null;
            onAnimationFinished();
        }
    }, [sidebarState]);

    const [pressedCommentThreadId, setPressedCommentThreadId] =
        useState<DocumentCommentThreadId | null>(null);

    const sidebarCommentThreadId =
        sidebarState.isOpen && sidebarState.animationState !== "Closing"
            ? sidebarState.commentThreadId
            : null;

    {
        const lastSidebarCommentThreadIdRef = useRef(sidebarCommentThreadId);
        useEffect(() => {
            if (sidebarCommentThreadId !== lastSidebarCommentThreadIdRef.current) {
                onCommentThreadChange?.(sidebarCommentThreadId);
                lastSidebarCommentThreadIdRef.current = sidebarCommentThreadId;
            }
        }, [onCommentThreadChange, sidebarCommentThreadId]);
    }

    const activeCommentThreadId = pressedCommentThreadId ?? sidebarCommentThreadId;

    const documentContentEditorSidebarWidthPx = convertRemLengthToPx(
        documentContentEditorSidebarWidth,
        useSpacingScale(),
    );

    // We compute the _editor_ container size from the container size so that when the
    // sidebar opens/closes we don't need to re-render side decorations when the resize
    // observer changes.
    const editorContainerWidth =
        containerSize && sidebarState.isOpen && sidebarState.animationState !== "Closing"
            ? containerSize.width - documentContentEditorSidebarWidthPx
            : (containerSize?.width ?? null);

    /* ========================================================================== *\
     *                     Comment thread sidebar navigation                      *
    \* ========================================================================== */

    const openCommentThread = useEvent((commentThreadId: DocumentCommentThreadId) => {
        // If this comment thread is already open or in the process of opening then don't
        // open it again.
        if (
            sidebarState.transition?.commentThreadId === commentThreadId ||
            (sidebarState.isOpen &&
                sidebarState.commentThreadId === commentThreadId &&
                !sidebarState.transition)
        ) {
            return Promise.resolve();
        }

        const dataPromise = procedures
            .getCommentThreadAndInitialCommentsIfExists({
                commentThreadId,
                limit: getInitialLoadMessageCount(getClientInfo()),
            })
            .then((data): DocumentContentEditorSidebarData | null => {
                if (data.commentThread === null) return null;

                return {
                    checkpoint: data.checkpoint,
                    commentThread: data.commentThread,
                    initialComments: data.initialComments,
                    initialOtherReferencedComments: data.initialOtherReferencedComments,
                    initialOptimisticComments: [],
                };
            });

        const pendingPromiseResolver = createPromiseResolver();

        setSidebarState(sidebarState => ({
            ...sidebarState,
            transition: {
                commentThreadId,
                dataPromise: PromiseImmediate.resolve(dataPromise),
                pendingPromiseResolver,
            },
        }));

        return pendingPromiseResolver.promise;
    });

    useEffect(() => {
        const transition = sidebarState.transition;
        if (!transition) return;

        let isCancelled = false;
        let isAccepted = false;

        const acceptTransition = () => {
            if (isCancelled) return;

            if (isAccepted) return;
            isAccepted = true;

            transition.pendingPromiseResolver.resolve();

            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen) {
                    return {
                        isOpen: true,
                        animationState: routeLayout === "narrow" ? "Opening" : null,
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                        mobileState: {isFullScreen: false},
                    };
                } else {
                    return {
                        isOpen: true,
                        animationState:
                            routeLayout === "narrow" ? sidebarState.animationState : null,
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                        mobileState: {isFullScreen: false},
                    };
                }
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our data promise resolves
        // - Our loading indicator delay finishes
        transition.dataPromise.then(data => {
            if (isCancelled) return;
            if (isAccepted) return;

            if (!data) {
                reporter.logErrorWithoutDisplaying(
                    "Selected document comment thread couldn\u2019t be opened",
                    new InternalError("Couldn\u2019t find document comment thread"),
                );

                // Comment thread not found so cancel the transition.
                setSidebarState({
                    isOpen: false,
                    transition: null,
                });
            } else {
                acceptTransition();
            }
        }, acceptTransition);

        const timeout = createTimeout(
            acceptTransition,
            delayScreenTransitionLoadingIndicatorLimitMs,
        );

        return () => {
            isCancelled = true;
            timeout.clear();
            transition.pendingPromiseResolver.resolve();
        };
    }, [reporter, routeLayout, sidebarState.transition]);

    const [
        mobileDiscardSidebarCommentInputModalState,
        setMobileDiscardSidebarCommentInputModalState,
    ] = useState<{onDiscard: () => void} | null>(null);

    const {
        onSidebarClose,
        onSidebarMobileFullScreenExpand,
        onSidebarMobileFullScreenContract,
        onCopyLink,
    } = useEvents({
        onSidebarClose: () => {
            const run = () => {
                setSidebarState(sidebarState => {
                    if (!sidebarState.isOpen) return sidebarState;

                    if (routeLayout === "narrow") {
                        return {...sidebarState, animationState: "Closing" as const};
                    } else {
                        return {isOpen: false, transition: null};
                    }
                });
            };

            // If the user is in a fullscreen comment thread, warn if they try to exit without
            // sending a comment they've typed in.
            //
            // We do this mostly since the fake comment input rendered when the comment thread
            // is open but not fullscreen will always be empty. So when returning to that state
            // we want to actually empty out the underlying comment input.
            if (
                sidebarState.isOpen &&
                sidebarState.mobileState.isFullScreen &&
                !pinnedCommentInputRef.current?.isEmpty()
            ) {
                setMobileDiscardSidebarCommentInputModalState({onDiscard: run});
                return;
            }

            // We still want to call `clear()` to clear replying state and editing state.
            pinnedCommentInputRef.current?.clear();

            run();
        },
        onSidebarMobileFullScreenExpand: ({
            onAnimationFinished,
        }: {
            onAnimationFinished?: () => void;
        } = {}) => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen) return sidebarState;
                if (sidebarState.mobileState.isFullScreen) return sidebarState;

                return {
                    ...sidebarState,
                    mobileState: {
                        isFullScreen: true,
                        animationState: "Expanding",
                        onAnimationFinishedRef: {current: onAnimationFinished ?? null},
                    },
                };
            });
        },
        onSidebarMobileFullScreenContract: () => {
            pinnedCommentInputRef.current?.blur();

            const run = () => {
                setSidebarState(sidebarState => {
                    if (!sidebarState.isOpen) return sidebarState;
                    if (!sidebarState.mobileState.isFullScreen) return sidebarState;

                    return {
                        ...sidebarState,
                        mobileState: {
                            ...sidebarState.mobileState,
                            animationState: "Contracting",
                        },
                    };
                });
            };

            // If the user is in a fullscreen comment thread, warn if they try to exit without
            // sending a comment they've typed in.
            //
            // We do this mostly since the fake comment input rendered when the comment thread
            // is open but not fullscreen will always be empty. So when returning to that state
            // we want to actually empty out the underlying comment input.
            if (
                sidebarState.isOpen &&
                sidebarState.mobileState.isFullScreen &&
                !pinnedCommentInputRef.current?.isEmpty()
            ) {
                setMobileDiscardSidebarCommentInputModalState({onDiscard: run});
                return;
            }

            // We still want to call `clear()` to clear replying state and editing state.
            pinnedCommentInputRef.current?.clear();

            run();
        },
        onCopyLink: async () => {
            // When the user goes to copy the link for a document, make sure the document has
            // been created before copying. Otherwise the other user won't see realtime updates
            // to the document.
            await ensureCreateDocument();

            const url = new URL(`/s/${spaceId}/documents/${documentId}`, window.location.href);
            await writeTextToClipboard(url.toString());
        },
    });

    /* ========================================================================== *\
     *                        Comment decoration collection                       *
    \* ========================================================================== */

    const [decorationByMarkTop, setDecorationByMarkTop] = useState<
        ReadonlyMap<
            number,
            {
                readonly markHeight: number;
                readonly commentThreadIds: ReadonlySet<DocumentCommentThreadId>;
            }
        >
    >(emptyMap);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Our editor won't be able to determine positions of comment marks until after the
        // initial render because it uses `<ContentView>` which doesn't support
        // `coordsAtPos()`.
        if (isInitialAppRender) return;

        // Recompute our decorations whenever the editor width changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        editorContainerWidth;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const editor = assertExists(editorRef.current);

        // We still collect decorations on mobile even though we don't render them because
        // we need them for the next/previous buttons on an opened comment thread.
        const store = computeStore(get =>
            collectDecorationByMarkTop(
                {
                    get,
                    spacingScale,
                    blockWidth,
                    editorContainerElement,
                    editorContainerRect: editorContainerElement.getBoundingClientRect(),
                    editor,
                    seenCommentThreadIds: new Set(),
                    decorationByMarkTop: new Map(),
                    tableCacheByPos: new Map(),
                },
                content.doc,
            ),
        );

        const update = () => {
            const {decorationByMarkTop} = store.getSnapshot();

            setDecorationByMarkTop(previousDecorationByMarkTop => {
                // Often the document will change but our decorations will not change. Do not
                // re-render the component if our decorations did not change.
                if (isDeepEqual(previousDecorationByMarkTop, decorationByMarkTop))
                    return previousDecorationByMarkTop;

                return decorationByMarkTop;
            });
        };

        update();
        return store.subscribe(update);
    }, [
        editorContainerRef,
        content.doc,
        editorRef,
        isInitialAppRender,
        editorContainerWidth,
        spacingScale,
        blockWidth,
    ]);

    const {totalDecoratedCommentThreads, decorations} = useMemo(() => {
        let totalDecoratedCommentThreads = 0;

        const decorations = Array.from(decorationByMarkTop, ([markTop, decoration]) => {
            totalDecoratedCommentThreads += decoration.commentThreadIds.size;

            return {
                markTop,
                markHeight: decoration.markHeight,
                commentThreadIds: decoration.commentThreadIds,
            };
        }).sort((a, b) => a.markTop - b.markTop);

        return {
            totalDecoratedCommentThreads,
            decorations,
        };
    }, [decorationByMarkTop]);

    /* ========================================================================== *\
     *                       Scroll to comment in document                        *
    \* ========================================================================== */

    const scrollToEditorRect = useEvent(
        (
            rect: DOMRect,
            {behavior, prefer}: {behavior: ScrollBehavior; prefer?: "top" | "bottom"},
        ) => {
            const navigationBar = assertExists(navigationBarRef.current);
            const editorContainerElement = assertExists(editorContainerRef.current);

            const spacingScale = getSpacingScaleWithoutListening();

            const navigationBarMaxVisibleHeight = navigationBar.getMaxVisibleHeight();
            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            // When using mobile layout the sidebar takes up visible space.
            const sidebarHeight =
                routeLayout === "narrow" && sidebarState.isOpen
                    ? editorContainerRect.height -
                      convertRemLengthToPx(documentContentEditorMobileSidebarInsetTop, spacingScale)
                    : 0;

            const visibleRect = {
                top: editorContainerRect.top + navigationBarMaxVisibleHeight,
                bottom: editorContainerRect.bottom - sidebarHeight,
            };
            visibleRect.bottom = Math.max(visibleRect.bottom, visibleRect.top);

            const visibleHeight = visibleRect.bottom - visibleRect.top;

            const commentMarkTop = editorContainerElement.scrollTop + rect.top - visibleRect.top;
            const commentMarkBottom =
                editorContainerElement.scrollTop + rect.bottom - visibleRect.top;

            // Try scrolling the element 20% from the top of the screen...
            const candidateScrollTop1 = clamp(
                0,
                commentMarkTop - visibleHeight / 5,
                editorContainerElement.scrollHeight - visibleHeight,
            );

            // Try scrolling the element 20% from the bottom of the screen...
            const candidateScrollTop2 = clamp(
                0,
                commentMarkBottom + visibleHeight / 5 - visibleHeight,
                editorContainerElement.scrollHeight - visibleHeight,
            );

            if (prefer === "top") {
                editorContainerElement.scrollTo({top: candidateScrollTop1, behavior});
            } else if (prefer === "bottom") {
                editorContainerElement.scrollTo({top: candidateScrollTop2, behavior});
            } else {
                const candidateScrollTop1Distance = Math.abs(
                    candidateScrollTop1 - editorContainerElement.scrollTop,
                );
                const candidateScrollTop2Distance = Math.abs(
                    candidateScrollTop2 - editorContainerElement.scrollTop,
                );

                // Pick the scroll offset that moves our window the least. That way there are no
                // big disorienting jumps.
                if (candidateScrollTop2Distance < candidateScrollTop1Distance) {
                    editorContainerElement.scrollTo({top: candidateScrollTop2, behavior});
                } else {
                    editorContainerElement.scrollTo({top: candidateScrollTop1, behavior});
                }
            }
        },
    );

    const handleCommentThreadSnippetPress = useEvent((commentThreadId: DocumentCommentThreadId) => {
        const editorContainerElement = assertExists(editorContainerRef.current);
        const firstCommentMarkElement = editorContainerElement.querySelector(
            // eslint-disable-next-line cyberworlds/string-quotes
            `[data-comment="${commentThreadId}"]`,
        );
        if (!firstCommentMarkElement) return;

        scrollToEditorRect(firstCommentMarkElement.getBoundingClientRect(), {behavior: "instant"});
    });

    {
        const hasInitializedRef = useRef(false);
        const lastSidebarStateRef = useRef(sidebarState);
        useLayoutEffectWithoutServerSideWarning(() => {
            // Ignore the initial app render since we won't have rendered comment marks...
            if (isInitialAppRender) return;

            const isInitialRender = !hasInitializedRef.current;
            hasInitializedRef.current = true;

            const lastSidebarState = lastSidebarStateRef.current;
            lastSidebarStateRef.current = sidebarState;

            const commentThreadId =
                sidebarState.isOpen &&
                // NOTE(calebmer): I've found running the sidebar open animation and the scroll
                // animation at the same time on mobile WebKit makes the sidebar open animation
                // look janky. However sequencing one after the other looks smooth. _shrug_
                (!isMobileWebKit || sidebarState.animationState !== "Opening") &&
                sidebarState.animationState !== "Closing"
                    ? sidebarState.commentThreadId
                    : null;

            // When the sidebar comment thread changes, scroll to the comment in the document.
            // Or when the component initially mounts.
            if (!commentThreadId) return;

            const navigationBar = assertExists(navigationBarRef.current);
            const editorContainerElement = assertExists(editorContainerRef.current);

            const commentMarkElements = editorContainerElement.querySelectorAll(
                // eslint-disable-next-line cyberworlds/string-quotes
                `[data-comment="${commentThreadId}"]`,
            );

            // Comment thread doesn't exist in the document anymore
            if (commentMarkElements.length === 0) return;

            const spacingScale = getSpacingScaleWithoutListening();

            const navigationBarVisibleHeight = navigationBar.getVisibleHeight();
            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            // When using mobile layout the sidebar takes up visible space.
            const sidebarHeight =
                routeLayout === "narrow" && sidebarState.isOpen
                    ? editorContainerRect.height -
                      convertRemLengthToPx(documentContentEditorMobileSidebarInsetTop, spacingScale)
                    : 0;

            const visibleRect = {
                top: editorContainerRect.top + navigationBarVisibleHeight,
                bottom: editorContainerRect.bottom - sidebarHeight,
            };
            visibleRect.bottom = Math.max(visibleRect.bottom, visibleRect.top);

            let firstCommentMarkRect: DOMRect | undefined;
            let isSomeCommentMarkVisible = false;

            for (const commentMarkElement of commentMarkElements) {
                const commentMarkRect = commentMarkElement.getBoundingClientRect();
                if (!firstCommentMarkRect) firstCommentMarkRect = commentMarkRect;

                if (
                    isRangeContained(
                        visibleRect.top,
                        visibleRect.bottom,
                        commentMarkRect.top,
                        commentMarkRect.bottom,
                    )
                ) {
                    isSomeCommentMarkVisible = true;
                    break;
                }
            }

            // If any of the comment's mark elements are visible we don't need to scroll to it!
            // If the user wants to see exactly the part of the doc in the preview they can
            // click on the preview.
            if (isSomeCommentMarkVisible) return;

            assert(firstCommentMarkRect);
            scrollToEditorRect(firstCommentMarkRect, {
                behavior:
                    // Don't animate scroll if:
                    //
                    // 1. This is the initial render; OR
                    // 2. We're opening the sidebar in our desktop layout
                    //
                    // In case 1 we should open immediately to the comment (e.g. if the user is
                    // navigating here from somewhere). In case 2 we need to scroll because of a layout
                    // shift when we made the document content narrower so it would be weird to
                    // animate.
                    isInitialRender || (!lastSidebarState.isOpen && routeLayout !== "narrow")
                        ? "instant"
                        : "smooth",
            });
        }, [isInitialAppRender, routeLayout, scrollToEditorRect, sidebarState]);
    }

    /* ========================================================================== *\
     *                           Initial render scroll                            *
    \* ========================================================================== */

    {
        const hasInitializedRef = useRef(false);

        useLayoutEffectWithoutServerSideWarning(() => {
            if (hasInitializedRef.current) return;
            hasInitializedRef.current = true;

            const editorContainerElement = assertExists(editorContainerRef.current);

            if (!initialScroll) return;

            switch (initialScroll.type) {
                case "CommentInOpenThread": {
                    if (initialCommentThreadResult) {
                        commentThreadListViewRef.current?.jumpToCommentRange({
                            roomKey: encodeDocumentCommentRoomKey(
                                documentId,
                                initialCommentThreadResult.commentThread.id,
                            ),
                            startIndex: initialScroll.commentIndex,
                            endIndex: initialScroll.commentIndex,
                            start: null,
                            end: null,
                        });
                    }
                    break;
                }
                case "CommentThread": {
                    const firstCommentMarkElement = editorContainerElement.querySelector(
                        // eslint-disable-next-line cyberworlds/string-quotes
                        `[data-comment="${initialScroll.commentThreadId}"]`,
                    );
                    if (firstCommentMarkElement) {
                        scrollToEditorRect(firstCommentMarkElement.getBoundingClientRect(), {
                            behavior: "instant",
                            prefer: "top",
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(initialScroll);
            }
        }, [documentId, initialCommentThreadResult, initialScroll, scrollToEditorRect]);
    }

    /* ========================================================================== *\
     *                               Native Mobile                                *
    \* ========================================================================== */

    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    useScrollToAvoidBottomBarsAndMobileKeyboard(editorContainerRef, {
        // - Disable on `isInitialAppRender` since `coordsAtPos()` won't work on initial
        //   render.
        // - Disable on `sidebarState.isOpen` since the comment view should be scrolling
        //   not the document.
        isDisabled: isInitialAppRender || sidebarState.isOpen,
        getAnchorPosition: useCallback(() => getContentEditorScrollAnchorPosition(editorRef), []),
    });

    useEffect(() => {
        if (!NativeMobileBridge) return;
        if (isInitialAppRender) return;
        if (isInert) return;

        const editor = assertExists(editorRef.current);

        const getIsAddCommentEditMenuOptionVisible = () => {
            return (
                !document.activeElement ||
                document.activeElement === document.body ||
                editor.isFocused()
            );
        };

        let lastIsAddCommentEditMenuOptionVisible: boolean | null = null;

        const handleFocusChange = () => {
            const isAddCommentEditMenuOptionVisible = getIsAddCommentEditMenuOptionVisible();

            // Noop if there was no change.
            if (lastIsAddCommentEditMenuOptionVisible === isAddCommentEditMenuOptionVisible) return;

            lastIsAddCommentEditMenuOptionVisible = isAddCommentEditMenuOptionVisible;

            if (isAddCommentEditMenuOptionVisible) {
                NativeMobileBridge!.editMenu.enableAddCommentAction();
            } else {
                NativeMobileBridge!.editMenu.disableAddCommentAction();
            }
        };

        document.addEventListener("focusin", handleFocusChange);
        document.addEventListener("focusout", handleFocusChange);

        // We've observed that iOS Safari doesn't emit `focusin`/`focusout` events when a
        // focused element is removed from the DOM. So we listen for `selectionchange`
        // events as well as a fallback which should fire before the edit menu opens.
        document.addEventListener("selectionchange", handleFocusChange);

        const unsubscribe = NativeMobileBridge.editMenu.subscribeToAddCommentAction(() => {
            editor.openMobileKeyboardToolbarCommentInputIfPossible();
        });

        handleFocusChange();

        return () => {
            if (lastIsAddCommentEditMenuOptionVisible) {
                NativeMobileBridge!.editMenu.disableAddCommentAction();
            }

            unsubscribe();

            document.removeEventListener("focusin", handleFocusChange);
            document.removeEventListener("focusout", handleFocusChange);
            document.removeEventListener("selectionchange", handleFocusChange);
        };
    }, [isInert, isInitialAppRender]);

    // Hide the tab bar when the sidebar is open. Sidebar is render as a bottom sheet
    // on mobile.
    const hasDisabledNativeMobileTabBarRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!NativeMobileBridge) return;

        if (isInertNativeMobileRoute || routeLayout !== "narrow" || !sidebarState.isOpen) {
            if (hasDisabledNativeMobileTabBarRef.current) {
                hasDisabledNativeMobileTabBarRef.current = false;
                NativeMobileBridge.tabBar.unhide({isAnimated: true});
            }
            return;
        }

        if (!hasDisabledNativeMobileTabBarRef.current) {
            hasDisabledNativeMobileTabBarRef.current = true;
            NativeMobileBridge.tabBar.hide({isAnimated: false});
        }

        return () => {
            // If the component unmounts, we need to enable the tab bar.
            if (!isMounted()) {
                if (hasDisabledNativeMobileTabBarRef.current) {
                    hasDisabledNativeMobileTabBarRef.current = false;
                    NativeMobileBridge!.tabBar.unhide({isAnimated: true});
                }
            }
        };
    }, [isInertNativeMobileRoute, isMounted, routeLayout, sidebarState.isOpen]);

    /* ========================================================================== *\
     *                               Navigation Bar                               *
    \* ========================================================================== */

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const isUndoDisabled = editorState.undoDepth() === 0;
    const isRedoDisabled = editorState.redoDepth() === 0;

    const hasManageAccessLevel = useMemo(
        () => hasAccessLevel(accessLevel, "Manage"),
        [accessLevel],
    );

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        `Document:${documentId}`,
        initialIsFavorite,
    );

    const cover = editorState.getDoc().attrs.cover as DocumentContentCover | null;

    const withinPeekStackOverlay = peekContext?.withinStack === true;

    const blobsScale = useRouteLayout() === "narrow" ? 0.75 : 1;
    const blobsSettings = useMemo(
        () =>
            cover?.type === "Blobs"
                ? {
                      seed: cover.seed,
                      themeColor: cover.themeColor,
                      hueSpread: cover.hueSpread,
                  }
                : null,
        [cover],
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        ref: navigationBarRef,
        title,
        getTitleBoundaryElement: useCallback(() => {
            // Assume the title `<h1>` element is always the first element in the ProseMirror
            // DOM.
            const editor = assertExists(editorRef.current);
            return editor.getEditorElement().firstElementChild! as HTMLHeadingElement;
        }, []),
        titleBoundaryMarginTop: useMemo(
            () =>
                addRemLengths(
                    contentStyles.titlePaddingTop[getPlatformRouteLayout(platform, routeLayout)],
                    "4",
                ),
            [platform, routeLayout],
        ),
        menuActions: useMemo(
            () => [
                [
                    {
                        label: "Copy link",
                        icon: <LinkIcon />,
                        iconPlacement: "end",
                        pressErrorTitle: "Couldn\u2019t copy link",
                        onPress: onCopyLink,
                    },
                    ...(favoriteMenuAction ? [favoriteMenuAction] : []),
                ],
                ...(hasAccessLevel(accessLevel, "Edit")
                    ? [
                          [
                              {
                                  label: "Undo",
                                  isDisabled: isUndoDisabled,
                                  keyboardShortcutHint: renderKeyboardShortcutHint(
                                      clientInfo,
                                      "mod",
                                      "z",
                                  ),
                                  onPress: () => assertExists(editorRef.current).undo(),
                              },
                              {
                                  label: "Redo",
                                  isDisabled: isRedoDisabled,
                                  keyboardShortcutHint: renderKeyboardShortcutHint(
                                      clientInfo,
                                      "mod",
                                      "y",
                                  ),
                                  onPress: () => assertExists(editorRef.current).redo(),
                              },
                          ],
                      ]
                    : emptyArray),
                [
                    ...(hasAccessLevel(accessLevel, "Edit")
                        ? [
                              cast<MenuAction>({
                                  label: "Cover",
                                  icon: <PanoramaIcon />,
                                  iconPlacement: "end",
                                  pressErrorTitle: "Couldn\u2019t open cover settings",
                                  onPress: () => {
                                      setIsCoverModalOpen(true);
                                  },
                              }),
                          ]
                        : []),
                    ...(platform !== "mobile"
                        ? [
                              cast<MenuAction>({
                                  label: "Present",
                                  icon: <LecturnIcon />,
                                  iconPlacement: "end",
                                  pressErrorTitle: "Couldn\u2019t open present settings",
                                  onPress: async () => {
                                      await assertExists(
                                          presentationControllerRef.current,
                                      ).present();
                                  },
                              }),
                          ]
                        : []),
                ],
                [
                    currentAccount &&
                        cast<MenuAction>({
                            label: "Duplicate",
                            iconPlacement: "end",
                            pressErrorTitle: "Couldn\u2019t duplicate document",
                            onPress: async () => {
                                // Get the current document content
                                const currentDoc = content.doc;

                                // Check for template variables
                                const schema = extractContentDuplicationVariableSchema(currentDoc);

                                // Navigate to the duplicate interstitial with schema
                                const encodedSchema =
                                    encodeContentDuplicationVariableSchemaForUrl(schema);

                                if (encodedSchema !== null) {
                                    const searchParams = new URLSearchParams();
                                    searchParams.set("title", getDocumentContentTitle(currentDoc));
                                    searchParams.set("schema", encodedSchema);

                                    await navigate(
                                        `/s/${spaceId}/documents/${documentId}/duplicate?${searchParams.toString()}`,
                                    );
                                    return;
                                }

                                // Show the instructional modal if it hasn't been dismissed
                                if (!doNotShowDuplicationInstructionalModalAgain) {
                                    setShowDuplicateInstructionalModal(true);
                                    return;
                                }

                                // No variables - duplicate directly via RPC
                                const {documentId: newDocumentId} = await duplicateDocument(
                                    context,
                                    {sourceDocumentId: documentId},
                                );

                                // Navigate to the new document. Always open in a peek on desktop. To make it clear
                                // when you're duplicating from a peek that the new document is a duplicate.
                                if (peekStackContext && platform !== "mobile") {
                                    await peekStackContext.push(
                                        `/s/${spaceId}/documents/${newDocumentId}`,
                                    );
                                } else {
                                    await navigate(`/s/${spaceId}/documents/${newDocumentId}`);
                                }
                            },
                        }),
                    cast<MenuAction>({
                        hasChildren: true,
                        placement: "left",
                        key: "export",
                        label: "Export",
                        actions: [
                            {
                                label: "Markdown",
                                pressErrorTitle: "Couldn\u2019t export to Markdown",
                                onPress: async () => {
                                    // The export function has a lot of heavy dependencies, so lazy load it.
                                    const {exportDocumentContent} =
                                        await import("~/client/web/documents/internal/export_document_content.js");

                                    const {string, html} = await exportDocumentContent({
                                        spaceId,
                                        format: "Markdown",
                                        content,
                                    });

                                    setExportModalState({
                                        format: "Markdown",
                                        string,
                                        html,
                                    });
                                },
                            },
                            {
                                label: "HTML",
                                pressErrorTitle: "Couldn\u2019t export to HTML",
                                onPress: async () => {
                                    // The export function has a lot of heavy dependencies, so lazy load it.
                                    const {exportDocumentContent} =
                                        await import("~/client/web/documents/internal/export_document_content.js");

                                    const {string, html} = await exportDocumentContent({
                                        spaceId,
                                        format: "HTML",
                                        content,
                                    });

                                    setExportModalState({
                                        format: "HTML",
                                        string,
                                        html,
                                    });
                                },
                            },
                        ],
                    }),
                ].filter(isNonNullable),
            ],
            [
                accessLevel,
                clientInfo,
                content,
                context,
                currentAccount,
                doNotShowDuplicationInstructionalModalAgain,
                documentId,
                favoriteMenuAction,
                isRedoDisabled,
                isUndoDisabled,
                navigate,
                onCopyLink,
                peekStackContext,
                platform,
                spaceId,
            ],
        ),
        contextMenuExtraBottom:
            initialDocument?.creator.from?.type === "Importer" ? (
                <>
                    <Box paddingX="1" paddingY="1">
                        <Box width="full" borderBottom="grey-5" />
                    </Box>
                    <Box paddingX="2" paddingY="1.5" fontSize="50" color="grey-50">
                        {`Imported from ${initialDocument.creator.from.source.type} on ${initialDocument.createdTime.toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"})}`}
                    </Box>
                </>
            ) : undefined,
        // Don't render the share button if the account doesn't have space access. They
        // won't be allowed to see the names of accounts in the share dialog.
        shareButton: currentAccount
            ? {
                  entityNoun: "document",
                  entityId: `Document:${documentId}`,
                  accessPolicy: content.doc.attrs.accessPolicy,
                  onAccessPolicyChange: (notification, accessPolicy) => {
                      onEditorStateChange(editorState.setAccessPolicy(accessPolicy, notification));
                  },
                  isReadOnly: !hasManageAccessLevel,
                  onCopyLink,
              }
            : undefined,
        desktopAdditionalActions: content.doc.attrs.hasPresentShortcut ? (
            <Button
                variant="neutral"
                icon={<Play size={spacing["2.5"]} weight="fill" />}
                iconGap="1"
                iconPlacement="end"
                height="6"
                paddingX="2"
                pressErrorTitle="Couldn&#x2019;t present document"
                onPress={async () => {
                    await assertExists(
                        presentationControllerRef.current,
                    ).presentWithoutConfirmation();
                }}
            >
                Present
            </Button>
        ) : undefined,
        desktopTitleMaxWidth: contentStyles.contentMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        contentCover:
            blobsSettings !== null ? (
                <BlobsArt
                    settings={blobsSettings}
                    withBezelX={withinPeekStackOverlay}
                    scale={blobsScale}
                />
            ) : null,
    });

    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "Document", documentId}),
        [documentId],
    );

    return (
        <Box
            ref={containerResizeRef}
            flexGrow="1"
            position="relative"
            zIndex="0"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            backgroundColor="grey-0"
            onScroll={event => {
                // NOTE(calebmer): I've observed sometimes Chrome scrolls this element despite
                // `overflow="hidden"`! I don't quite understand what's causing the problem but
                // resetting scroll top/left here fixes it.
                event.currentTarget.scrollTop = 0;
                event.currentTarget.scrollLeft = 0;
            }}
        >
            <Box
                ref={useMergedRefs<HTMLDivElement>(
                    editorContainerRef,
                    useScrollbar({insetTop: scrollbarInsetTop}),
                    scrollViewRef,
                )}
                id={editorContainerId}
                data-testid="DocumentContentEditorMain"
                flexGrow="1"
                position="relative"
                zIndex="0"
                overflowX="hidden"
                overflowY="auto"
                style={{
                    width:
                        routeLayout !== "narrow" && sidebarState.isOpen
                            ? `calc(100% - ${spacing[documentContentEditorSidebarWidth]})`
                            : "100%",
                }}
            >
                {blobsSettings !== null && (
                    <BlobsArt
                        settings={blobsSettings}
                        withBezelTop={withinPeekStackOverlay}
                        withBezelX={withinPeekStackOverlay}
                        scale={blobsScale}
                    />
                )}
                <OverlayScopeContextProvider>
                    <Box className={contentEditorStyles.containerClassName}>
                        <GlobalKeyDownEvent
                            onGlobalKeyDown={event => {
                                // Perform undo/redo on the document even if the document isn't focused. If the
                                // document is focused and cmd-z is pressed then the document will handle the event
                                // itself and call `event.preventDefault()` + `event.stopPropagation()`.
                                switch (event.key) {
                                    case "z": {
                                        if (
                                            clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey
                                        ) {
                                            event.preventDefault();
                                            event.stopPropagation();

                                            if (event.shiftKey) {
                                                assertExists(editorRef.current).redo();
                                            } else if (
                                                (clientInfo.isAppleDevice
                                                    ? !event.ctrlKey
                                                    : !event.metaKey) &&
                                                !event.altKey
                                            ) {
                                                assertExists(editorRef.current).undo();
                                            }
                                            break;
                                        }
                                        break;
                                    }
                                    // https://en.wikipedia.org/wiki/Control-Y
                                    case "y": {
                                        if (
                                            clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey
                                        ) {
                                            event.preventDefault();
                                            event.stopPropagation();

                                            if (
                                                (clientInfo.isAppleDevice
                                                    ? !event.ctrlKey
                                                    : !event.metaKey) &&
                                                !event.altKey &&
                                                !event.shiftKey
                                            ) {
                                                assertExists(editorRef.current).redo();
                                            }
                                            break;
                                        }
                                        break;
                                    }
                                }
                            }}
                        >
                            <ContentEditor
                                ref={editorRef}
                                state={editorState}
                                onChange={(state, transaction) => {
                                    onEditorStateChange(state);

                                    const createCommentThread: {
                                        commentThreadId: DocumentCommentThreadId;
                                        initialCommentContent: MessageContentWithReferences;
                                        initialCommentFileIds: ReadonlyArray<FileId | FileEntityId>;
                                        openCommentThreadPromiseRef?: {
                                            current: Promise<void> | null;
                                        };
                                    } | null =
                                        transaction.getMeta(createContentCommentThreadMetaKey) ??
                                        null;

                                    if (
                                        createCommentThread &&
                                        createCommentThread.openCommentThreadPromiseRef &&
                                        sidebarState.isOpen &&
                                        sidebarState.animationState !== "Closing"
                                    ) {
                                        // `<ContentEditorCommentInput>` will wait on this promise before closing after
                                        // creating a comment thread when it exists. If the sidebar is not already open
                                        // then we rely on our document's global loading indicator to tell us when comments
                                        // have successfully saved.
                                        createCommentThread.openCommentThreadPromiseRef.current =
                                            openCommentThread(createCommentThread.commentThreadId);
                                    }

                                    if (transaction.docChanged) {
                                        onContentLocalChange?.();
                                    }
                                }}
                                aria-label="Document"
                                placeholder={
                                    hasAccessLevel(accessLevel, "Edit")
                                        ? "Share your ideas, press @ to insert…"
                                        : "Share your ideas…"
                                }
                                accessLevel={accessLevel}
                                // When you're typing in the first paragraph of a document (2 child nodes, title +
                                // paragraph) you probably want to insert some formatting (like a table). This
                                // helps the user discover features of Alpine documents. Since we prompt them with
                                // "press @ to insert" as a placeholder.
                                //
                                // As you're typing a long document probably the next thing you want to do is
                                // mention another document, task, or something else.
                                //
                                // Mentioning a person is probably the last thing you want to do while working on a
                                // document since mentions won't send a notification when typing in a document.
                                mentionFloaterSectionOrder={
                                    content.doc.childCount <= 2
                                        ? "InsertSuggestedPeople"
                                        : "SuggestedInsertPeople"
                                }
                                // While the sidebar is open, don't render our document toolbar. It would be weird
                                // for it to pop up when writing a comment.
                                withoutMobileKeyboardToolbar={sidebarState.isOpen}
                                className={classNames(
                                    documentContentStyles.contentClassName,
                                    routeLayout === "wide" &&
                                        documentContentStyles.contentWithWideRouteLayoutClassName,
                                )}
                                phantomSelections={phantomSelections}
                                fileAttachmentTarget={fileAttachmentTarget}
                                commentFileAttachmentTarget={useMemo(
                                    () => ({type: "DocumentComments", documentId}),
                                    [documentId],
                                )}
                                onEnsureFileAttachmentTarget={ensureCreateDocument}
                                openCommentThread={openCommentThread}
                                onCommentThreadPressedChange={(commentThreadId, isHovered) => {
                                    setPressedCommentThreadId(pressedCommentThreadId => {
                                        if (isHovered) return commentThreadId;
                                        if (
                                            !isHovered &&
                                            pressedCommentThreadId === commentThreadId
                                        )
                                            return null;
                                        return pressedCommentThreadId;
                                    });
                                }}
                                onSelectionLeave={onClearOurPresenceState}
                                onSelectionEnter={onUnclearOurPresenceState}
                                // TODO(#spell-check): Load and pass in actual ignored lints
                                spellCheckIgnoredLints={[]}
                                onSpellCheckIgnoreLint={async ({key, kind}) => {
                                    const {eventTransaction} = await createSpellCheckIgnoredLint(
                                        context,
                                        {
                                            entityId: `Document:${documentId}`,
                                            key,
                                            kind,
                                        },
                                    );

                                    handleEventForSpellCheckIgnoredLint(eventTransaction);
                                }}
                                // Since the document content editor fills the entire screen height, it makes sense
                                // that if the user `mousedown`s in the bottom margin we should create a new
                                // paragraph and move selection there if the last item is not already a paragraph
                                // (e.g. a divider or table or something).
                                withMouseDownAtEndCreatesParagraph={true}
                            />
                        </GlobalKeyDownEvent>
                        {
                            // IMPORTANT: It's important that this element is below `<ContentEditor>` so that
                            // `<ContentEditor>` is first in the tab order! This matters when auto-focusing a
                            // document peek when we open it up.
                            navigationBar
                        }
                        {useMemo(
                            // Memoize side decorations since it can be an expensive component to re-render.
                            // Especially during animations.
                            () =>
                                platform !== "mobile" && (
                                    <DocumentContentEditorSideDecorations
                                        editorContainerWidth={editorContainerWidth}
                                        contentReferences={content.references}
                                        decorations={decorations}
                                        openCommentThread={openCommentThread}
                                    />
                                ),
                            [
                                content.references,
                                decorations,
                                editorContainerWidth,
                                openCommentThread,
                                platform,
                            ],
                        )}
                    </Box>
                </OverlayScopeContextProvider>
            </Box>
            {sidebarState.isOpen && (
                <>
                    {routeLayout === "narrow" && (
                        <Box
                            // While the mobile comment thread overlay is open render a cover to prevent the
                            // user from interacting with the underlying document. Tapping the cover will close
                            // the comment thread.
                            position="absolute"
                            zIndex="10"
                            inset="0"
                            onPointerDown={onSidebarClose}
                        />
                    )}
                    <Box
                        position="absolute"
                        zIndex="20"
                        top={routeLayout !== "narrow" ? "0" : undefined}
                        right={routeLayout !== "narrow" ? "-4" : "0"}
                        left={routeLayout !== "narrow" ? undefined : "0"}
                        paddingRight={routeLayout !== "narrow" ? "4" : undefined}
                        style={{
                            width:
                                routeLayout !== "narrow"
                                    ? // The `spacing["4"]` is a bit of grace room at the end for a spring bounce.
                                      addRemLengths(documentContentEditorSidebarWidth, "4")
                                    : "100%",
                            // In the mobile layout (mobile devices and peeks) we show the comment thread in a
                            // bottom sheet. When the comment input is focused on mobile devices we then
                            // animate the sidebar to take the full screen space since the virtual keyboard
                            // will open and the user still needs to see comments. In peeks on desktop we don't
                            // expand to fullscreen because the user can type on their physical keyboard.
                            height:
                                routeLayout !== "narrow"
                                    ? undefined
                                    : `calc(100% - (${
                                          platform === "mobile"
                                              ? spacing["1"]
                                              : spacing[documentContentEditorMobileSidebarInsetTop]
                                      } + var(--safe-area-inset-top, 0px)))`,
                            bottom:
                                platform === "mobile"
                                    ? `-${spacing[documentContentEditorMobileSidebarInsetTop]}`
                                    : 0,
                        }}
                    >
                        <ContentBlockWidthContextProvider
                            isDisabled={routeLayout === "narrow"}
                            width={documentContentEditorSidebarWidth}
                        >
                            <Box
                                ref={sidebarRef}
                                width="full"
                                height="full"
                                borderLeft={routeLayout !== "narrow" ? "grey-5" : undefined}
                                backgroundColor="grey-0"
                                borderTopRadius={routeLayout !== "narrow" ? undefined : "3"}
                                boxShadow={
                                    routeLayout !== "narrow"
                                        ? undefined
                                        : "elevation-40-from-bottom"
                                }
                                overflow="hidden"
                                style={{
                                    // Let the browser know we'll be basically immediately animating in the sidebar so
                                    // it can prepare a compositing layer.
                                    willChange: "transform",
                                }}
                            >
                                <DocumentContentEditorSidebar
                                    pinnedCommentInputRef={pinnedCommentInputRef}
                                    documentId={documentId}
                                    content={content}
                                    platform={platform}
                                    routeLayout={routeLayout}
                                    mobileState={sidebarState.mobileState}
                                    onSidebarMobileFullScreenExpand={
                                        onSidebarMobileFullScreenExpand
                                    }
                                    onSidebarMobileFullScreenContract={
                                        onSidebarMobileFullScreenContract
                                    }
                                    commentThreadId={sidebarState.commentThreadId}
                                    onCommentThreadSnippetPress={handleCommentThreadSnippetPress}
                                    initialDataPromise={sidebarState.dataPromise}
                                    isConnected={isConnected}
                                    procedures={procedures}
                                    subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                                    subscribeToPongs={subscribeToPongs}
                                    unpersistedResolutionStateByCommentThreadId={
                                        unpersistedResolutionStateByCommentThreadId
                                    }
                                    totalDecoratedCommentThreads={totalDecoratedCommentThreads}
                                    decorations={decorations}
                                    commentThreadListViewRef={commentThreadListViewRef}
                                    onClose={onSidebarClose}
                                    openCommentThread={openCommentThread}
                                />
                            </Box>
                        </ContentBlockWidthContextProvider>
                    </Box>
                    {platform === "mobile" &&
                        (!sidebarState.mobileState.isFullScreen ||
                            sidebarState.mobileState.animationState !== null) && (
                            // On mobile while the comment thread is not fullscreen, we render a fake comment
                            // input that when touched expands the comment thread to take the full screen.
                            <>
                                <Box
                                    ref={mobileFakeCommentInputRef}
                                    data-testid="DocumentContentEditorMobileFakeCommentInput"
                                    position="absolute"
                                    zIndex="30"
                                    left="0"
                                    right="0"
                                    bottom="0"
                                    backgroundColor="grey-0"
                                    style={{
                                        paddingBottom: "var(--window-safe-area-inset-bottom, 0px)",
                                    }}
                                    onPointerDown={event => {
                                        const editorElement = assertExists(
                                            mobileFakeCommentInputEditorRef.current,
                                        );

                                        if (
                                            event.target instanceof HTMLElement &&
                                            event.target !== editorElement &&
                                            !editorElement.contains(event.target)
                                        ) {
                                            onSidebarMobileFullScreenExpand();
                                        }
                                    }}
                                >
                                    <Box
                                        paddingX={screenPaddingX}
                                        paddingY={messageInputPaddingY}
                                        marginX={messageInputEditorIconButtonNegativeMarginX}
                                        style={{
                                            height: messageInputMinHeightPx[platform][spacingScale],
                                        }}
                                    >
                                        <Box
                                            ref={mobileFakeCommentInputEditorRef}
                                            className={contentStyles.docClassName}
                                            position="relative"
                                            flexGrow="1"
                                            // If the user has a mouse, make this feel like a text input.
                                            cursor="text"
                                            style={{
                                                height: messageInputEditorMinHeightPx[platform][
                                                    spacingScale
                                                ],
                                                paddingLeft: messageInputEditorPaddingX[platform],
                                                paddingRight: messageInputEditorPaddingX[platform],
                                                paddingTop:
                                                    messageInputEditorPaddingYPx[platform][
                                                        spacingScale
                                                    ],
                                                paddingBottom:
                                                    messageInputEditorPaddingYPx[platform][
                                                        spacingScale
                                                    ],
                                                borderRadius:
                                                    messageInputEditorBorderRadiusPx[platform][
                                                        spacingScale
                                                    ],
                                                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                                            }}
                                            onPointerDown={() => {
                                                onSidebarMobileFullScreenExpand({
                                                    onAnimationFinished: () => {
                                                        pinnedCommentInputRef.current?.focus();
                                                    },
                                                });
                                            }}
                                        >
                                            <Box
                                                className={paragraphClassName}
                                                userSelect="none"
                                                style={inputPlaceholderStyles}
                                            >
                                                Add a comment
                                            </Box>
                                            <Box
                                                position="absolute"
                                                top="0"
                                                left="0"
                                                display="flex"
                                                justifyContent="center"
                                                alignItems="center"
                                                style={{
                                                    height: messageInputEditorMinHeightPx[platform][
                                                        spacingScale
                                                    ],
                                                    width: messageInputEditorMinHeightPx[platform][
                                                        spacingScale
                                                    ],
                                                }}
                                            >
                                                <Box
                                                    width={messageViewAccountAvatarSize}
                                                    height={messageViewAccountAvatarSize}
                                                    color="grey-70"
                                                    borderRadius="full"
                                                    display="flex"
                                                    justifyContent="center"
                                                    alignItems="center"
                                                >
                                                    <Plus size={spacing["4"]} />
                                                </Box>
                                            </Box>
                                            <Box
                                                position="absolute"
                                                top="0"
                                                right="0"
                                                display="flex"
                                                justifyContent="center"
                                                alignItems="center"
                                                style={{
                                                    height: messageInputEditorMinHeightPx[platform][
                                                        spacingScale
                                                    ],
                                                    width: messageInputEditorMinHeightPx[platform][
                                                        spacingScale
                                                    ],
                                                }}
                                            >
                                                <Box
                                                    width={messageViewAccountAvatarSize}
                                                    height={messageViewAccountAvatarSize}
                                                    backgroundColor="grey-5"
                                                    color="grey-30"
                                                    borderRadius="full"
                                                    display="flex"
                                                    justifyContent="center"
                                                    alignItems="center"
                                                >
                                                    <ArrowUp size={spacing["4"]} />
                                                </Box>
                                            </Box>
                                        </Box>
                                    </Box>
                                </Box>
                                {isNativeMobile && !isInert && (
                                    // In our native mobile app, include an invisible bottom bar which only serves to
                                    // make sure the vertical scroll indicator insets are correct.
                                    <Box
                                        id={`nmbb-${editorContainerId}`}
                                        position="absolute"
                                        left="0"
                                        right="0"
                                        bottom="0"
                                        pointerEvents="none"
                                        style={{
                                            paddingBottom:
                                                "var(--window-safe-area-inset-bottom, 0px)",
                                            // Our native mobile wrapper looks for compositing layers created from an element
                                            // with an ID that starts with `nmbb-` and ties their position to the tab bar and
                                            // software keyboard. So we get smooth animations while the keyboard opens or the
                                            // tab bar shifts offscreen. To create a compositing layer we need to set
                                            // `will-change: transform`. It's not specified that `will-change: transform` MUST
                                            // create a compositing layer, instead some browser engines implement this hint
                                            // themselves as an optimization.
                                            //
                                            // It so happens that WebKit is one of those browsers. Here's the code in WebKit
                                            // that does this: [part 1][1], [part 2][2].
                                            //
                                            // [1]:
                                            //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                                            // [2]:
                                            //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                                            willChange: "transform",
                                        }}
                                        // Suppress React hydration warnings in our native mobile app. The native mobile
                                        // app sets the `transform` property on this element. Sometimes before React
                                        // finishes hydrating. This is expected, React can ignore the difference.
                                        suppressHydrationWarning={true}
                                    >
                                        <Box
                                            style={{
                                                height: messageInputMinHeightPx[platform][
                                                    spacingScale
                                                ],
                                            }}
                                        />
                                    </Box>
                                )}
                            </>
                        )}
                </>
            )}
            {mobileDiscardSidebarCommentInputModalState && (
                <ModalDialog
                    title="Discard comment?"
                    description="Continuing will discard your comment. Use the send button to save your comment."
                    primaryButtonLabel="Discard"
                    onClose={() => setMobileDiscardSidebarCommentInputModalState(null)}
                    onPrimaryButtonPress={() => {
                        pinnedCommentInputRef.current?.clear();
                        mobileDiscardSidebarCommentInputModalState.onDiscard();
                    }}
                />
            )}
            {useMemo(
                // We style hovered and active comments with a `<style>` element containing CSS
                // with a dynamic selector that changes when our state changes. We do this for two
                // reasons:
                //
                // 1. All marks for a `DocumentCommentThreadId` should light up when we hover even
                //    if they are different elements in the DOM
                // 2. Changing DOM properties (e.g. `class`) of comment elements triggers
                //    ProseMirror's mutation observer and since the observer doesn't know why the
                //    change happened it destroys and recreates the mark elements
                () =>
                    activeCommentThreadId && (
                        <style
                            key={activeCommentThreadId}
                            dangerouslySetInnerHTML={{
                                __html: contentStyles.commentActiveDynamicCssTemplate
                                    .replaceAll(
                                        "$containerId",
                                        editorContainerId.replaceAll(":", "\\:"),
                                    )
                                    .replaceAll("$commentThreadId", activeCommentThreadId),
                            }}
                        />
                    ),
                [activeCommentThreadId, editorContainerId],
            )}
            {platform !== "mobile" && (
                <DocumentPresentationController
                    ref={presentationControllerRef}
                    editorRef={editorRef}
                    editorContainerRef={editorContainerRef}
                    editorState={editorState}
                    accessLevel={accessLevel}
                    fileAttachmentTarget={fileAttachmentTarget}
                />
            )}
            {isCoverModalOpen && (
                <DocumentContentCoverModal
                    editorRef={editorRef}
                    editorState={editorState}
                    onClose={() => setIsCoverModalOpen(false)}
                />
            )}
            {exportModalState && (
                <DocumentContentExportModal
                    format={exportModalState.format}
                    string={exportModalState.string}
                    html={exportModalState.html}
                    onClose={() => setExportModalState(null)}
                />
            )}
            {showDuplicateInstructionalModal && (
                <ContentDuplicationInstructionalModal
                    noun="document"
                    onDuplicate={async () => {
                        const {documentId: newDocumentId} = await duplicateDocument(context, {
                            sourceDocumentId: documentId,
                        });

                        // Navigate to the new document. Always open in a peek on desktop. To make it clear
                        // when you're duplicating from a peek that the new document is a duplicate.
                        if (peekStackContext && platform !== "mobile") {
                            await peekStackContext.push(`/s/${spaceId}/documents/${newDocumentId}`);
                        } else {
                            await navigate(`/s/${spaceId}/documents/${newDocumentId}`);
                        }
                    }}
                    onClose={() => setShowDuplicateInstructionalModal(false)}
                    doNotShowAgain={doNotShowDuplicationInstructionalModalAgain}
                    onDoNotShowAgainChange={setDoNotShowDuplicationInstructionalModalAgain}
                />
            )}
        </Box>
    );
}

const collectDecorationByMarkTop = createProsemirrorIncrementalReducer<{
    get: <Value>(store: Store<Value>) => Value;
    spacingScale: SpacingScale;
    blockWidth: number;
    editorContainerElement: HTMLElement;
    editorContainerRect: DOMRect;
    editor: ContentEditorRef<DocumentContentWithReferences>;
    seenCommentThreadIds: Set<DocumentCommentThreadId>;
    decorationByMarkTop: Map<
        number,
        {markHeight: number; commentThreadIds: Set<DocumentCommentThreadId>}
    >;
    tableCacheByPos: Map<number, {totalColumnWidthPx: number}>;
}>(node => {
    const commentThreadIds = filterMapArray(node.marks, mark => {
        if (mark.type.name !== "comment") return;
        return assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId);
    });

    if (commentThreadIds.length === 0) return null;

    return (state, doc, offset) => {
        const $offset = doc.resolve(offset);

        for (let depth = $offset.depth; depth >= 1; depth--) {
            const node = $offset.node(depth);

            // If this comment is within a table then only render the comment decoration if the
            // table isn't larger than the block width. If the table is larger than the block
            // width we hide the decoration since it would otherwise render on top of the
            // table's content!
            //
            // We need to make sure we're also listening to the table's optimistic layout used
            // while resizing the table. Which is why we have to find the `HTMLTableElement`
            // associated with the table our comment is in.
            if (node.type.name === "table") {
                const tablePos = $offset.start(depth);

                // If there are many comments in the same table, only compute the table's total
                // column width once.
                const {totalColumnWidthPx} = getOrSetDefaultMapValue(
                    state.tableCacheByPos,
                    tablePos,
                    () => {
                        let tableElement: globalThis.Node | null = state.editor.nodeDom(tablePos);
                        while (tableElement && tableElement.nodeName != "TABLE")
                            tableElement = tableElement.parentNode;

                        const optimisticTableLayout = tableElement
                            ? state.get(
                                  getOptimisticContentEditorTableLayoutStore(
                                      tableElement as HTMLTableElement,
                                  ),
                              )
                            : null;

                        const columnWidthPxs = resolveContentTableColumnWidthPx(
                            state.spacingScale,
                            state.blockWidth,
                            optimisticTableLayout ?? ContentTableMap.get(node),
                        );

                        let totalColumnWidthPx = 0;
                        for (const columnWidthPx of columnWidthPxs)
                            totalColumnWidthPx += columnWidthPx;

                        return {totalColumnWidthPx};
                    },
                );

                // If the table's total column width exceeds the block width (by more than 1px to
                // account for subpixel rounding issues) then don't render this comment decoration.
                if (totalColumnWidthPx > state.blockWidth + 1) {
                    return state;
                }
            }
        }

        let coords: {top: number; bottom: number; left: number; right: number} | undefined;

        // If this is a non-text node like `file` then get the DOM element for the node and
        // use the dimensions of that element instead of the result of `coordsAtPos()`
        // which will have a height of 0.
        if (!node.type.inlineContent && !node.type.isText) {
            const nodeDom = state.editor.nodeDom(offset);
            if (nodeDom instanceof Element) {
                coords = nodeDom.getBoundingClientRect();
            }
        }

        coords ??= state.editor.coordsAtPos(offset);

        const markTop =
            coords.top - state.editorContainerRect.top + state.editorContainerElement.scrollTop;

        const markHeight = Math.min(
            coords.bottom - coords.top,
            // Max height for large nodes like files.
            convertRemLengthToPx("5", getSpacingScaleWithoutListening()),
        );

        for (const commentThreadId of commentThreadIds) {
            if (state.seenCommentThreadIds.has(commentThreadId)) continue;

            const decoration = getOrSetDefaultMapValue(state.decorationByMarkTop, markTop, () => ({
                markHeight,
                commentThreadIds: new Set<DocumentCommentThreadId>(),
            }));

            state.seenCommentThreadIds.add(commentThreadId);
            decoration.commentThreadIds.add(commentThreadId);
        }

        return state;
    };
});

function DocumentContentEditorSidebar({
    pinnedCommentInputRef,
    documentId,
    content,
    platform,
    routeLayout,
    mobileState,
    onSidebarMobileFullScreenExpand,
    onSidebarMobileFullScreenContract,
    commentThreadId,
    onCommentThreadSnippetPress,
    initialDataPromise,
    isConnected,
    procedures,
    subscribeToCommentThreadEvents,
    subscribeToPongs,
    unpersistedResolutionStateByCommentThreadId,
    totalDecoratedCommentThreads,
    decorations,
    commentThreadListViewRef,
    onClose,
    openCommentThread,
}: {
    pinnedCommentInputRef: RefObject<MessageInputRef | null>;
    documentId: DocumentId;
    content: DocumentContentWithReferences;
    platform: Platform;
    routeLayout: RouteLayout;
    mobileState: DocumentContentEditorSidebarMobileState;
    onSidebarMobileFullScreenExpand: Memo<(options?: {onAnimationFinished?: () => void}) => void>;
    onSidebarMobileFullScreenContract: Memo<() => void>;
    commentThreadId: DocumentCommentThreadId;
    onCommentThreadSnippetPress: Memo<(commentThreadId: DocumentCommentThreadId) => void>;
    initialDataPromise: PromiseImmediate<DocumentContentEditorSidebarData | null>;
    isConnected: boolean;
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
    subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
    unpersistedResolutionStateByCommentThreadId: ReadonlyMap<
        DocumentCommentThreadId,
        {readonly isResolved: boolean; readonly version: number}
    >;
    totalDecoratedCommentThreads: number;
    decorations: ReadonlyArray<DocumentContentEditorSideDecoration>;
    commentThreadListViewRef: Ref<DocumentCommentThreadListViewRef>;
    onClose: Memo<() => void>;
    openCommentThread: Memo<(commentThreadId: DocumentCommentThreadId) => Promise<void>>;
}) {
    const spacingScale = useSpacingScale();
    const reporter = useReporter();
    const clientInfo = useClientInfo();
    const {isNativeMobile} = clientInfo;

    const previousCommentThreadButtonRef = useRef<HTMLElement & {press(): void}>(null);
    const nextCommentThreadButtonRef = useRef<HTMLElement & {press(): void}>(null);

    const initialDataResult = usePromise(initialDataPromise);

    // If the comment thread finishes loading but there's no data then close the
    // comment thread.
    const initialDataResultRef = useRef<typeof initialDataResult | null>(null);
    useEffect(() => {
        if (initialDataResultRef.current === initialDataResult) return;
        initialDataResultRef.current = initialDataResult;

        if (!initialDataResult.isPending && !initialDataResult.value) {
            reporter.logErrorWithoutDisplaying(
                "Selected document comment thread couldn\u2019t be opened",
                new InternalError("Couldn\u2019t find document comment thread"),
            );

            onClose();
        }
    }, [initialDataResult, onClose, reporter]);

    const currentAdjacentCommentThreads = useMemo(() => {
        let decoratedCommentThreadIndex = 0;
        let previousCommentThreadId: DocumentCommentThreadId | null = null;
        let hasFoundCommentThread = false;

        for (const decoration of decorations) {
            for (const otherCommentThreadId of decoration.commentThreadIds) {
                if (hasFoundCommentThread) {
                    return {
                        hasFoundCommentThread,
                        decoratedCommentThreadIndex: decoratedCommentThreadIndex - 1,
                        totalDecoratedCommentThreads,
                        previousCommentThreadId,
                        nextCommentThreadId: otherCommentThreadId,
                    };
                } else if (otherCommentThreadId === commentThreadId) {
                    hasFoundCommentThread = true;
                } else {
                    previousCommentThreadId = otherCommentThreadId;
                }

                decoratedCommentThreadIndex++;
            }
        }

        return {
            hasFoundCommentThread,
            decoratedCommentThreadIndex: hasFoundCommentThread
                ? decoratedCommentThreadIndex - 1
                : null,
            totalDecoratedCommentThreads,
            previousCommentThreadId,
            nextCommentThreadId: null,
        };
    }, [commentThreadId, decorations, totalDecoratedCommentThreads]);

    // If we had previous/next comment threads and then the comment was removed from
    // the document (e.g. comment thread was resolved) then we want to keep the last
    // previous/next comment threads we've seen. This way a user can go through
    // comments in a document, resolving them one by one without losing their place
    // after resolving.
    const [originalAdjacentCommentThreads, setAdjacentCommentThreads] = useState(
        currentAdjacentCommentThreads,
    );
    let adjacentCommentThreads = originalAdjacentCommentThreads;
    if (
        currentAdjacentCommentThreads !== adjacentCommentThreads &&
        currentAdjacentCommentThreads.hasFoundCommentThread
    ) {
        setAdjacentCommentThreads(currentAdjacentCommentThreads);
        adjacentCommentThreads = currentAdjacentCommentThreads;
    }

    const {
        decoratedCommentThreadIndex,
        totalDecoratedCommentThreads: lastTotalDecoratedCommentThreads,
        previousCommentThreadId,
        nextCommentThreadId,
    } = adjacentCommentThreads;

    const header = (
        <Box
            flexShrink="0"
            height={platform === "mobile" ? "9" : "8"}
            display="flex"
            alignItems="center"
            backgroundColor="grey-0"
        >
            {routeLayout === "narrow" && (
                <>
                    {!mobileState.isFullScreen || mobileState.animationState === "Contracting" ? (
                        <Spacer space={platform === "mobile" ? "9" : "7"} />
                    ) : (
                        <Box
                            flexShrink="0"
                            paddingX="1.5"
                            width={platform === "mobile" ? "9" : "7"}
                        >
                            <IconButton
                                size={platform === "mobile" ? "md" : "xs"}
                                description="Go back"
                                withoutTooltip={true}
                                onPress={onSidebarMobileFullScreenContract}
                            >
                                <ArrowLeft />
                            </IconButton>
                        </Box>
                    )}
                    <Box flexGrow="1" height="full" />
                </>
            )}
            {(!mobileState.isFullScreen || mobileState.animationState === "Contracting") && (
                <Box flexShrink="0" paddingX="2" display="flex" alignItems="center">
                    <IconButton
                        ref={previousCommentThreadButtonRef}
                        size={platform === "mobile" ? "md" : "xs"}
                        description="Previous thread"
                        keyboardShortcutHint={renderKeyboardShortcutHint(clientInfo, "mod", ",")}
                        isDisabled={!previousCommentThreadId}
                        pressErrorTitle="Can&#x2019;t go to previous thread"
                        onPress={async () => {
                            if (!previousCommentThreadId) return;
                            await openCommentThread(previousCommentThreadId);
                        }}
                    >
                        {routeLayout !== "narrow" ? <CaretUp /> : <CaretLeft />}
                    </IconButton>
                    {routeLayout === "narrow" && (
                        <Box
                            paddingX={platform === "mobile" ? "2.5" : "2"}
                            color="grey-70"
                            textAlign="center"
                            style={{fontVariantNumeric: "tabular-nums"}}
                        >
                            {decoratedCommentThreadIndex !== null && (
                                <>
                                    {decoratedCommentThreadIndex + 1} of{" "}
                                    {lastTotalDecoratedCommentThreads}
                                </>
                            )}
                        </Box>
                    )}
                    <IconButton
                        ref={nextCommentThreadButtonRef}
                        size={platform === "mobile" ? "md" : "xs"}
                        description="Next thread"
                        keyboardShortcutHint={renderKeyboardShortcutHint(clientInfo, "mod", ".")}
                        isDisabled={!nextCommentThreadId}
                        pressErrorTitle="Can&#x2019;t go to next thread"
                        onPress={async () => {
                            if (!nextCommentThreadId) return;
                            await openCommentThread(nextCommentThreadId);
                        }}
                    >
                        {routeLayout !== "narrow" ? <CaretDown /> : <CaretRight />}
                    </IconButton>
                    {routeLayout !== "narrow" && decoratedCommentThreadIndex !== null && (
                        <Box
                            paddingLeft="2.5"
                            paddingRight="1.5"
                            color="grey-70"
                            style={{fontVariantNumeric: "tabular-nums"}}
                        >
                            {decoratedCommentThreadIndex + 1} of {lastTotalDecoratedCommentThreads}
                        </Box>
                    )}
                </Box>
            )}
            <Box flexGrow="1" height="full" />
            <Box flexShrink="0" paddingX="1.5" width={platform === "mobile" ? "9" : "8"}>
                <IconButton
                    size={platform === "mobile" ? "md" : "xs"}
                    description="Close"
                    keyboardShortcutHint="esc"
                    onPress={onClose}
                >
                    <X />
                </IconButton>
            </Box>
        </Box>
    );

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }

                if (
                    event.key === "," &&
                    event.shiftKey &&
                    (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Programmatically click the button instead of calling `openCommentThread()`
                    // directly to correctly handle loading and error states.
                    assertExists(previousCommentThreadButtonRef.current).press();
                }

                if (
                    event.key === "." &&
                    event.shiftKey &&
                    (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Programmatically click the button instead of calling `openCommentThread()`
                    // directly to correctly handle loading and error states.
                    assertExists(nextCommentThreadButtonRef.current).press();
                }
            }}
        >
            <Box height="full" width="full" overflow="hidden" display="flex" flexDirection="column">
                {header}
                {useMemo(
                    () =>
                        // TODO(calebmer): Ideally this would render shimmers instead of a loading spinner.
                        initialDataResult.isPending || !initialDataResult.value ? (
                            <Box
                                flexGrow="1"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                style={{
                                    paddingBottom:
                                        messageInputMinHeightPx[platform][spacingScale] +
                                        (platform === "mobile" &&
                                        (!mobileState.isFullScreen ||
                                            mobileState.animationState === "Expanding")
                                            ? convertRemLengthToPx(
                                                  documentContentEditorMobileSidebarInsetTop,
                                                  spacingScale,
                                              )
                                            : 0),
                                }}
                            >
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    color={colorSchemeVars["grey-70"]}
                                    size={spacing["6"]}
                                />
                            </Box>
                        ) : (
                            <DocumentCommentThreadListView
                                key={commentThreadId}
                                ref={commentThreadListViewRef}
                                documentId={documentId}
                                content={content}
                                onCommentThreadSnippetPress={onCommentThreadSnippetPress}
                                initialCommentThreadResults={[
                                    {
                                        checkpoint: initialDataResult.value.checkpoint,
                                        commentThread: initialDataResult.value.commentThread,
                                        comments: initialDataResult.value.initialComments,
                                        otherReferencedComments:
                                            initialDataResult.value.initialOtherReferencedComments,
                                        optimisticComments:
                                            initialDataResult.value.initialOptimisticComments,
                                    },
                                ]}
                                isConnected={isConnected}
                                procedures={procedures}
                                subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                                subscribeToPongs={subscribeToPongs}
                                unpersistedResolutionStateByCommentThreadId={
                                    unpersistedResolutionStateByCommentThreadId
                                }
                                withoutCommentThreadPreview={routeLayout === "narrow"}
                                // When we render the comment input in a bottom sheet on desktop we need the
                                // comment input to have a smaller max height so it doesn't completely fill the
                                // bottom sheet.
                                withCommentInputMobileMaxHeight={routeLayout === "narrow"}
                                pinnedCommentInputRef={pinnedCommentInputRef}
                                // We disable the tab bar while a comment thread is open to get more vertical
                                // space. This changes how our component should handle safe area insets.
                                isNativeMobileTabBarHidden={
                                    isNativeMobile && routeLayout === "narrow"
                                }
                                // When on mobile, add some background slop so we can easily animate our comment
                                // thread list view to the full screen size.
                                backgroundSlopBottomIfPinnedCommentInput={
                                    platform === "mobile" &&
                                    (!mobileState.isFullScreen ||
                                        mobileState.animationState === "Expanding")
                                        ? spacing[documentContentEditorMobileSidebarInsetTop]
                                        : undefined
                                }
                                // If we're focusing the pinned comment input because the user swiped to reply to a
                                // comment then we first need to make sure our sidebar is full screen, then we can
                                // focus the input after that animation finishes.
                                onBeforePinnedCommentInputFocusFromReplyOrEditingChange={() => {
                                    if (platform !== "mobile") return;
                                    if (mobileState.isFullScreen) return;

                                    onSidebarMobileFullScreenExpand({
                                        onAnimationFinished: () => {
                                            pinnedCommentInputRef.current?.focus();
                                        },
                                    });

                                    return {preventDefault: true};
                                }}
                            />
                        ),
                    [
                        commentThreadId,
                        commentThreadListViewRef,
                        content,
                        documentId,
                        initialDataResult.isPending,
                        initialDataResult.value,
                        isConnected,
                        isNativeMobile,
                        mobileState,
                        onCommentThreadSnippetPress,
                        onSidebarMobileFullScreenExpand,
                        pinnedCommentInputRef,
                        platform,
                        procedures,
                        routeLayout,
                        spacingScale,
                        subscribeToCommentThreadEvents,
                        subscribeToPongs,
                        unpersistedResolutionStateByCommentThreadId,
                    ],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}
