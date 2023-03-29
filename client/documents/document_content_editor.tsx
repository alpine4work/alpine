import {Command} from "prosemirror-state";
import {useEffect, useMemo, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {Box} from "~/client/design/box";
import {documentContentClassName} from "~/client/documents/document_content_view";
import {
    DocumentCommentThreadDecoration,
    DocumentContentEditorSideDecorations,
} from "~/client/documents/internal/document_content_editor_side_decorations";
import {
    createDocumentCommentThreadMetaKey,
    useDocumentContentEditorState,
} from "~/client/documents/internal/document_content_editor_state";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/content/document_content_schema";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {assertId, generateId} from "~/shared/id/id";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {DocumentModel} from "~/shared/models/document_model";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range";

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

function DocumentContentEditorStateful({
    initialDocument,
    onDocumentContentChange,
}: {
    initialDocument: DocumentModel;
    onDocumentContentChange?: (content: DocumentContent) => void;
}) {
    const editorRef = useRef<ContentEditorRef>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerResizeRef, containerSize] = useResizeObserver();

    const {editorState, onChangeEditorState, phantomSelections} =
        useDocumentContentEditorState(initialDocument);

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
                state.tr
                    .addMark(range.from, range.to, state.schema.mark("comment", {commentThreadId}))
                    .setMeta(createDocumentCommentThreadMetaKey, {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("test"),
                    })
                    .scrollIntoView(),
            );
        }

        return true;
    };

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(containerRef, containerResizeRef)}
            position="relative"
            height="full"
            backgroundColor="grey-0"
        >
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
                containerRef={containerRef}
                containerSize={containerSize}
                editorRef={editorRef}
                content={content}
            />
        </Box>
    );
}
