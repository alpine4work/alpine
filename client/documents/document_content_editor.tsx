import {AnimationControls, spring, timeline} from "motion";
import {Command} from "prosemirror-state";
import {useCallback, useEffect, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {updateContentEditorReferences} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {documentContentClassName, documentPaddingX} from "~/client/documents/document_content_view";
import {DocumentContentEditorSideDecorations} from "~/client/documents/internal/document_content_editor_side_decorations";
import {createDocumentCommentThreadMetaKey} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {useDocumentContentEditorPhantomSelections} from "~/client/documents/internal/use_document_content_editor_phantom_selections";
import {useDocumentContentEditorWebSocket} from "~/client/documents/internal/use_document_content_editor_web_socket";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/content/document_content_schema";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {generateId} from "~/shared/id/id";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {DocumentModel} from "~/shared/models/document_model";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range";
import {contentSchemaStyles} from "~/shared/styles/styles";

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
      }
    | {
          readonly isOpen: true;
          readonly animationState: "Opening" | "Closing" | null;
      };

function DocumentContentEditorStateful({
    initialDocument,
    onDocumentContentChange,
}: {
    initialDocument: DocumentModel;
    onDocumentContentChange?: (content: DocumentContent) => void;
}) {
    const {spaceId, id: documentId} = initialDocument;

    const {currentAccount} = useSpaceContext();
    const editorRef = useRef<ContentEditorRef>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const [contentResizeRef, editorContainerSize] = useResizeObserver();

    const {
        editorState,
        onChangeEditorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
        toggleShouldConnect,
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
                toggleSidebar: () => {
                    setSidebarState(sidebarState => {
                        if (sidebarState.isOpen) {
                            if (sidebarState.animationState === "Closing") {
                                return {isOpen: true, animationState: "Opening"};
                            }
                            return {isOpen: true, animationState: "Closing"};
                        } else {
                            return {isOpen: true, animationState: "Opening"};
                        }
                    });
                },
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

    const [sidebarState, setSidebarState] = useState<DocumentContentEditorSidebarState>({
        isOpen: false,
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

        sidebarAnimationInRef.current = timeline(
            [
                [sidebarElement, {x: [sidebarWidth + sidebarOffscreenBufferWidth, 0]}],
                [editorContainerElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
            ],
            {
                defaultOptions: {
                    easing: spring({
                        stiffness: 300,
                        damping: 28,
                    }),
                },
            },
        );

        sidebarAnimationInRef.current.finished.finally(() => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Opening")
                    return sidebarState;
                return {isOpen: true, animationState: null};
            });
        });
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

        sidebarAnimationOutRef.current = timeline(
            [
                [sidebarElement, {x: [0, sidebarWidth + sidebarOffscreenBufferWidth]}],
                [editorContainerElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
            ],
            {
                defaultOptions: {
                    easing: spring({
                        stiffness: 300,
                        damping: 28,
                    }),
                },
            },
        );

        sidebarAnimationOutRef.current.finished.finally(() => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Closing")
                    return sidebarState;
                return {isOpen: false};
            });
        });
    }, [sidebarState]);

    return (
        <Box
            flexGrow="1"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            display="flex"
            flexDirection="column"
            backgroundColor="grey-0"
        >
            <Box
                ref={useMergedRefs<HTMLDivElement>(editorContainerRef, contentResizeRef)}
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
                    />
                    <DocumentContentEditorSideDecorations
                        editorContainerRef={editorContainerRef}
                        editorContainerSize={editorContainerSize}
                        editorRef={editorRef}
                        content={content}
                    />
                </OverlayScopeContextProvider>
            </Box>
            {sidebarState.isOpen && (
                // TODO(calebmer): Mobile version of this...
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
                    Sidebar
                </Box>
            )}
        </Box>
    );
}
