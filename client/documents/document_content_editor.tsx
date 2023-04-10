import {AnimationControls, spring, timeline} from "motion";
import {CaretDown, CaretUp, SpinnerGap, X} from "phosphor-react";
import {Command} from "prosemirror-state";
import {useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {updateContentEditorReferences} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px";
import {IconButton} from "~/client/design/icon_button";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view";
import {documentContentClassName, documentPaddingX} from "~/client/documents/document_content_view";
import {
    DocumentContentEditorSideDecoration,
    DocumentContentEditorSideDecorations,
} from "~/client/documents/internal/document_content_editor_side_decorations";
import {createDocumentCommentThreadMetaKey} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {useDocumentContentEditorPhantomSelections} from "~/client/documents/internal/use_document_content_editor_phantom_selections";
import {
    SendCommentThreadMessageFunction,
    SubscribeToCommentThreadMessagesFunction,
    useDocumentContentEditorWebSocket,
} from "~/client/documents/internal/use_document_content_editor_web_socket";
import {isMac} from "~/client/helpers/browser/is_mac";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {usePromise} from "~/client/helpers/use_promise";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/content/document_content_schema";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {assertId, generateId} from "~/shared/id/id";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentContentWithReferences,
    DocumentModel,
} from "~/shared/models/document_model";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range";
import {getDocumentCommentThreadAndInitialComments} from "~/shared/rpc/documents_rpc_definitions";
import {colorSchemeVars, contentSchemaStyles, spinAnimationClassName} from "~/shared/styles/styles";

const documentContentEditorSidebarWidth = spacing["96"];

export function DocumentContentEditor({
    document,
    onDocumentContentChange,
}: {
    document: DocumentModel;
    onDocumentContentChange?: (content: DocumentContent) => void;
}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different id + version is passed in then remount
            // our stateful content editor component.
            key={`${document.id}-${document.version}`}
            initialDocument={document}
            onDocumentContentChange={onDocumentContentChange}
        />
    );
}

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
          readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarTransitionData>;
      };

type DocumentContentEditorSidebarTransition = {
    readonly commentThreadId: DocumentCommentThreadId;
    readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarTransitionData>;
    // Promise that resolves when the transition finishes. This may happen before
    // the data promise resolves! Or if another transition starts cancelling our
    // previous transition.
    readonly pendingPromiseResolver: PromiseResolver<void>;
};

type DocumentContentEditorSidebarTransitionData = {
    readonly commentThread: DocumentCommentThreadModel;
    readonly initialComments: ReadonlyArray<DocumentCommentModel>;
    readonly initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
};

function DocumentContentEditorStateful({
    initialDocument,
    onDocumentContentChange,
}: {
    initialDocument: DocumentModel;
    onDocumentContentChange?: (content: DocumentContent) => void;
}) {
    const {id: documentId} = initialDocument;

    const isInitialAppRender = useIsInitialAppRender();
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const editorRef = useRef<ContentEditorRef>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const containerId = useId();
    const [containerResizeRef, containerSize] = useResizeObserver();

    const {
        isConnected,
        editorState,
        onChangeEditorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
        toggleShouldConnect,
        sendCommentThreadMessage,
        subscribeToCommentThreadMessages,
    } = useDocumentContentEditorWebSocket(initialDocument.id, initialDocument);

    const phantomSelections = useDocumentContentEditorPhantomSelections({
        editorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
    });

    useDevConsoleTool(
        "documentContentEditor",
        useCallback(
            () => ({
                prosemirrorSchema: DocumentContentProsemirrorSchema,
                toggleShouldConnect,
            }),
            [toggleShouldConnect],
        ),
    );

    const content = editorState.getContent();
    const lastContentDocRef = useRef(content.doc);
    useEffect(() => {
        if (content.doc !== lastContentDocRef.current) {
            onDocumentContentChange?.(content.doc);
            lastContentDocRef.current = content.doc;
        }
    }, [content.doc, onDocumentContentChange]);

    // This command was adapted from `createToggleMarkCommand()`.
    const addCommentCommand: Command = (state, dispatch) => {
        let doesAnyNodeAllowMarkType = false;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            // If we have found at least one node that can become our mark type we don't
            // need to keep iterating.
            if (doesAnyNodeAllowMarkType) return false;

            // Ignore nodes that aren't inline.
            if (!node.isInline) return;

            // Ignore nodes that don't support our mark type.
            const $pos = state.doc.resolve(pos);
            if (!$pos.parent.type.allowsMarkType(DocumentContentProsemirrorSchema.marks.comment))
                return;

            doesAnyNodeAllowMarkType = true;
        });

        if (!doesAnyNodeAllowMarkType) return false;

        if (dispatch) {
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
            dispatch(
                updateContentEditorReferences(
                    state.tr
                        .addMark(
                            range.from,
                            range.to,
                            state.schema.mark("comment", {commentThreadId}),
                        )
                        .setMeta(createDocumentCommentThreadMetaKey, {
                            commentThreadId,
                            initialCommentContent: createSimpleMessageContent("test"),
                        })
                        .scrollIntoView(),
                    {
                        type: "UpdateDocumentCommentThread",
                        commentThreadId,
                        commentCount: 1,
                        addCommentAuthor: currentAccount,
                    },
                ),
            );
        }

        return true;
    };

    /* ========================================================================== *\
     *                            Sidebar animations                              *
    \* ========================================================================== */

    const [sidebarState, setSidebarState] = useState<DocumentContentEditorSidebarState>({
        isOpen: false,
        transition: null,
    });

    const sidebarAnimationInRef = useRef<AnimationControls | null>(null);
    const sidebarAnimationOutRef = useRef<AnimationControls | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!(sidebarState.isOpen && sidebarState.animationState === "Opening")) {
            sidebarAnimationInRef.current?.cancel();
            sidebarAnimationInRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarAnimationInRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const remPx = getRemPxWithoutListening();
        const blockMaxWidth = convertRemLengthToPx(contentSchemaStyles.blockMaxWidth, remPx);
        const paddingX = convertRemLengthToPx(spacing[documentPaddingX], remPx) * 2;
        const sidebarWidth = convertRemLengthToPx(documentContentEditorSidebarWidth, remPx);
        const sidebarOffscreenBufferWidth = convertRemLengthToPx(spacing["10"], remPx);

        const oldContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingX + sidebarWidth - blockMaxWidth) / 2,
        );
        const newContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingX - blockMaxWidth) / 2,
        );

        const animation = timeline(
            [
                [sidebarElement, {x: [sidebarWidth + sidebarOffscreenBufferWidth, 0]}],
                [editorContainerElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
            ],
            {
                defaultOptions: {
                    easing: spring({
                        stiffness: 300,
                        damping: 31,
                    }),
                },
                delay: 0.002,
            },
        );

        // Wait for React to finish rendering before playing our animation. We need to
        // start our animation in a layout effect to apply the initial transform in the
        // right paint, but React may need to re-render again before releasing control
        // to the browser. So wait for React to finish rendering before starting our
        // animation.
        animation.pause();
        scheduleAfterNextBrowserPaint(() => {
            animation.play();
        });

        animation.finished.finally(() => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Opening")
                    return sidebarState;

                return {...sidebarState, animationState: null};
            });
        });

        sidebarAnimationInRef.current = animation;
    }, [sidebarState]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!(sidebarState.isOpen && sidebarState.animationState === "Closing")) {
            sidebarAnimationOutRef.current?.cancel();
            sidebarAnimationOutRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarAnimationOutRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const remPx = getRemPxWithoutListening();
        const blockMaxWidth = convertRemLengthToPx(contentSchemaStyles.blockMaxWidth, remPx);
        const paddingX = convertRemLengthToPx(spacing[documentPaddingX], remPx) * 2;
        const sidebarWidth = convertRemLengthToPx(documentContentEditorSidebarWidth, remPx);
        const sidebarOffscreenBufferWidth = convertRemLengthToPx(spacing["10"], remPx);

        const oldContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingX - sidebarWidth - blockMaxWidth) / 2,
        );
        const newContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingX - blockMaxWidth) / 2,
        );

        const animation = timeline(
            [
                [sidebarElement, {x: [0, sidebarWidth + sidebarOffscreenBufferWidth]}],
                [editorContainerElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
            ],
            {
                defaultOptions: {
                    easing: spring({
                        stiffness: 420,
                        damping: 35,
                    }),
                },
            },
        );

        // Wait for React to finish rendering before playing our animation. We need to
        // start our animation in a layout effect to apply the initial transform in the
        // right paint, but React may need to re-render again before releasing control
        // to the browser. So wait for React to finish rendering before starting our
        // animation.
        animation.pause();
        scheduleAfterNextBrowserPaint(() => {
            animation.play();
        });

        animation.finished.finally(() => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Closing")
                    return sidebarState;

                return {isOpen: false, transition: null};
            });
        });

        sidebarAnimationOutRef.current = animation;
    }, [sidebarState]);

    /* ========================================================================== *\
     *                     Comment thread sidebar navigation                      *
    \* ========================================================================== */

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const openCommentThread = useEvent((commentThreadId: DocumentCommentThreadId) => {
        // If this comment thread is already open or in the process of opening then
        // don't open it again.
        if (
            sidebarState.transition?.commentThreadId === commentThreadId ||
            (sidebarState.isOpen &&
                sidebarState.commentThreadId === commentThreadId &&
                !sidebarState.transition)
        ) {
            return Promise.resolve();
        }

        const dataPromise = getDocumentCommentThreadAndInitialComments(context, {
            documentId,
            commentThreadId,
            limit: getInitialLoadMessageCount(getClientInfoWithoutListening()),
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

        const acceptTransition = () => {
            if (isCancelled) return;

            transition.pendingPromiseResolver.resolve();

            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen) {
                    return {
                        isOpen: true,
                        animationState: "Opening",
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                    };
                } else {
                    return {
                        isOpen: true,
                        animationState: sidebarState.animationState,
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                    };
                }
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our data promise resolves
        // - Our loading indicator delay finishes
        transition.dataPromise.then(acceptTransition, acceptTransition);

        return () => {
            isCancelled = true;
            transition.pendingPromiseResolver.resolve();
        };
    }, [sidebarState.transition]);

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
    >(() => new Map());

    useLayoutEffectWithoutServerSideWarning(() => {
        // Our editor won't be able to determine positions of comment marks until after
        // the initial render.
        if (isInitialAppRender) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const editor = assertExists(editorRef.current);

        const {decorationByMarkTop} = collectDecorationByMarkTop(
            {
                editorContainerElement,
                editorContainerRect: editorContainerElement.getBoundingClientRect(),
                editor,
                seenCommentThreadIds: new Set(),
                decorationByMarkTop: new Map(),
            },
            content.doc,
        );

        setDecorationByMarkTop(previousDecorationByMarkTop => {
            // Often the document will change but our decorations will not change. Do not
            // re-render the component if our decorations did not change.
            if (isDeepEqual(previousDecorationByMarkTop, decorationByMarkTop))
                return previousDecorationByMarkTop;

            return decorationByMarkTop;
        });
    }, [editorContainerRef, content.doc, editorRef, isInitialAppRender]);

    const decorations = useMemo(
        () =>
            Array.from(decorationByMarkTop, ([markTop, decoration]) => ({
                markTop,
                markHeight: decoration.markHeight,
                commentThreadIds: decoration.commentThreadIds,
            })).sort((a, b) => a.markTop - b.markTop),
        [decorationByMarkTop],
    );

    const documentContentEditorSidebarWidthPx = convertRemLengthToPx(
        documentContentEditorSidebarWidth,
        useRemPx(),
    );

    // We compute the *editor* container size from the container size so that when
    // the sidebar opens/closes we don't need to re-render side decorations when the
    // resize observer changes.
    const editorContainerWidth =
        containerSize && sidebarState.isOpen && sidebarState.animationState !== "Closing"
            ? containerSize.width - documentContentEditorSidebarWidthPx
            : containerSize?.width ?? null;

    const [pressedCommentThreadId, setPressedCommentThreadId] =
        useState<DocumentCommentThreadId | null>(null);

    const activeCommentThreadId =
        pressedCommentThreadId ??
        (sidebarState.isOpen && sidebarState.animationState !== "Closing"
            ? sidebarState.commentThreadId
            : null);

    return (
        <Box
            ref={containerResizeRef}
            flexGrow="1"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            display="flex"
            flexDirection="column"
            backgroundColor="grey-0"
        >
            <Box
                ref={editorContainerRef}
                id={containerId}
                flexGrow="1"
                position="relative"
                zIndex="0"
                overflowX="hidden"
                overflowY="scroll"
                style={{
                    width:
                        sidebarState.isOpen && sidebarState.animationState !== "Closing"
                            ? `calc(100% - ${documentContentEditorSidebarWidth})`
                            : "100%",
                }}
            >
                <OverlayScopeContextProvider>
                    <ContentEditor
                        ref={editorRef}
                        state={editorState}
                        onChange={onChangeEditorState}
                        aria-label="Document"
                        placeholder="Share your ideas…"
                        className={documentContentClassName}
                        phantomSelections={phantomSelections}
                        addCommentCommand={addCommentCommand}
                        openCommentThread={openCommentThread}
                        onCommentThreadPressedChange={(commentThreadId, isHovered) => {
                            setPressedCommentThreadId(pressedCommentThreadId => {
                                if (isHovered) return commentThreadId;
                                if (!isHovered && pressedCommentThreadId === commentThreadId)
                                    return null;
                                return pressedCommentThreadId;
                            });
                        }}
                    />
                    {useMemo(
                        // Memoize side decorations since it can be an expensive component
                        // to re-render. Especially during animations.
                        () => (
                            <DocumentContentEditorSideDecorations
                                editorContainerWidth={editorContainerWidth}
                                contentReferences={content.references}
                                decorations={decorations}
                            />
                        ),
                        [content.references, decorations, editorContainerWidth],
                    )}
                </OverlayScopeContextProvider>
            </Box>
            {sidebarState.isOpen && (
                <Box
                    ref={sidebarRef}
                    position="absolute"
                    top="0"
                    bottom="0"
                    // A bit of grace room at the end for a spring bounce.
                    right="-4"
                    paddingRight="4"
                    borderLeft="grey-10"
                    backgroundColor="grey-0"
                    style={{
                        width: addRemLengths(documentContentEditorSidebarWidth, spacing["4"]),
                    }}
                >
                    <DocumentContentEditorSidebar
                        documentId={documentId}
                        content={content}
                        commentThreadId={sidebarState.commentThreadId}
                        initialDataPromise={sidebarState.dataPromise}
                        isConnected={isConnected}
                        sendCommentThreadMessage={sendCommentThreadMessage}
                        subscribeToCommentThreadMessages={subscribeToCommentThreadMessages}
                        decorations={decorations}
                        onClose={() => {
                            setSidebarState(sidebarState => {
                                if (!sidebarState.isOpen) return sidebarState;
                                return {...sidebarState, animationState: "Closing" as const};
                            });
                        }}
                        openCommentThread={openCommentThread}
                    />
                </Box>
            )}
            {useMemo(
                // We style hovered and active comments with a `<style>` element containing
                // CSS with a dynamic selector that changes when our state changes. We do this
                // for two reasons:
                //
                // 1. All marks for a `DocumentCommentThreadId` should light up when we hover
                //    even if they are different elements in the DOM
                // 2. Changing DOM properties (e.g. `class`) of comment elements triggers
                //    ProseMirror's mutation observer and since the observer doesn't know why
                //    the change happened it destroys and recreates the mark elements
                () =>
                    activeCommentThreadId && (
                        <style key={activeCommentThreadId}>
                            {contentSchemaStyles.commentActiveDynamicCssTemplate
                                .replaceAll("$containerId", containerId.replaceAll(":", "\\:"))
                                .replaceAll("$commentThreadId", activeCommentThreadId)}
                        </style>
                    ),
                [activeCommentThreadId, containerId],
            )}
        </Box>
    );
}

const collectDecorationByMarkTop = createProsemirrorIncrementalReducer<{
    editorContainerElement: HTMLElement;
    editorContainerRect: DOMRect;
    editor: ContentEditorRef;
    seenCommentThreadIds: Set<DocumentCommentThreadId>;
    decorationByMarkTop: Map<
        number,
        {markHeight: number; commentThreadIds: Set<DocumentCommentThreadId>}
    >;
}>(node => {
    const commentThreadIds = filterMapArray(node.marks, mark => {
        if (mark.type.name !== "comment") return null;
        return assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId);
    });

    if (commentThreadIds.length === 0) return null;

    return (state, doc, offset) => {
        const coords = state.editor.coordsAtPos(offset);
        const markTop =
            coords.top - state.editorContainerRect.top + state.editorContainerElement.scrollTop;
        const markHeight = coords.bottom - coords.top;

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
    documentId,
    content,
    commentThreadId,
    initialDataPromise,
    isConnected,
    sendCommentThreadMessage,
    subscribeToCommentThreadMessages,
    decorations,
    onClose,
    openCommentThread,
}: {
    documentId: DocumentId;
    content: DocumentContentWithReferences;
    commentThreadId: DocumentCommentThreadId;
    initialDataPromise: PromiseImmediate<DocumentContentEditorSidebarTransitionData>;
    isConnected: boolean;
    sendCommentThreadMessage: SendCommentThreadMessageFunction;
    subscribeToCommentThreadMessages: SubscribeToCommentThreadMessagesFunction;
    decorations: ReadonlyArray<DocumentContentEditorSideDecoration>;
    onClose: () => void;
    openCommentThread: (commentThreadId: DocumentCommentThreadId) => Promise<void>;
}) {
    const previousCommentThreadButtonRef = useRef<HTMLButtonElement>(null);
    const nextCommentThreadButtonRef = useRef<HTMLButtonElement>(null);

    const initialDataResult = usePromise(initialDataPromise);

    const {previousCommentThreadId, nextCommentThreadId} = useMemo(() => {
        let previousCommentThreadId: DocumentCommentThreadId | null = null;
        let hasFoundCommentThread = false;
        for (const decoration of decorations) {
            for (const otherCommentThreadId of decoration.commentThreadIds) {
                if (hasFoundCommentThread) {
                    return {previousCommentThreadId, nextCommentThreadId: otherCommentThreadId};
                } else if (otherCommentThreadId === commentThreadId) {
                    hasFoundCommentThread = true;
                } else {
                    previousCommentThreadId = otherCommentThreadId;
                }
            }
        }
        return {previousCommentThreadId, nextCommentThreadId: null};
    }, [commentThreadId, decorations]);

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
                    (isMac ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Programmatically click the button instead of calling `openCommentThread()`
                    // directly to correctly handle loading and error states.
                    assertExists(previousCommentThreadButtonRef.current).click();
                }

                if (
                    event.key === "." &&
                    event.shiftKey &&
                    (isMac ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Programmatically click the button instead of calling `openCommentThread()`
                    // directly to correctly handle loading and error states.
                    assertExists(nextCommentThreadButtonRef.current).click();
                }
            }}
        >
            <Box height="full" width="full" overflow="hidden" display="flex" flexDirection="column">
                <Box
                    flexShrink="0"
                    height="8"
                    borderBottom="grey-10"
                    display="flex"
                    alignItems="center"
                >
                    <Box flexShrink="0" paddingX="1.5" display="flex" gap="1">
                        <IconButton
                            ref={previousCommentThreadButtonRef}
                            size="xs"
                            description="Previous comment"
                            keyboardShortcutHint={isMac ? "⌘+Shift+," : "Ctrl+Shift+,"}
                            isDisabled={!previousCommentThreadId}
                            pressErrorTitle="Can’t go to previous comment"
                            onPress={async () => {
                                if (!previousCommentThreadId) return;
                                await openCommentThread(previousCommentThreadId);
                            }}
                        >
                            <CaretUp />
                        </IconButton>
                        <IconButton
                            ref={nextCommentThreadButtonRef}
                            size="xs"
                            description="Next comment"
                            keyboardShortcutHint={isMac ? "⌘+Shift+." : "Ctrl+Shift+."}
                            isDisabled={!nextCommentThreadId}
                            pressErrorTitle="Can’t go to next comment"
                            onPress={async () => {
                                if (!nextCommentThreadId) return;
                                await openCommentThread(nextCommentThreadId);
                            }}
                        >
                            <CaretDown />
                        </IconButton>
                    </Box>
                    <Box flexGrow="1" height="full" />
                    <Box flexShrink="0" paddingX="1.5" display="flex" gap="1">
                        <IconButton
                            size="xs"
                            description="Close"
                            keyboardShortcutHint="esc"
                            onPress={onClose}
                        >
                            <X />
                        </IconButton>
                    </Box>
                </Box>
                {useMemo(
                    () =>
                        initialDataResult.isPending ? (
                            <Box
                                flexGrow="1"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
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
                                documentId={documentId}
                                content={content}
                                initialCommentThreadsResult={{
                                    commentThread: initialDataResult.value.commentThread,
                                    comments: initialDataResult.value.initialComments,
                                    otherReferencedComments:
                                        initialDataResult.value.initialOtherReferencedComments,
                                }}
                                isConnected={isConnected}
                                sendCommentThreadMessage={sendCommentThreadMessage}
                                subscribeToCommentThreadMessages={subscribeToCommentThreadMessages}
                                withMobileLayout={true}
                            />
                        ),
                    [
                        commentThreadId,
                        content,
                        documentId,
                        initialDataResult,
                        isConnected,
                        sendCommentThreadMessage,
                        subscribeToCommentThreadMessages,
                    ],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}
