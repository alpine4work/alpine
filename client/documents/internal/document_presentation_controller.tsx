import {Memo, Ref, forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {DocumentPresentationView} from "~/client/documents/internal/document_presentation_view.js";
import {GlobalKeyDownEventModal} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type DocumentPresentationControllerRef = {
    present(): Promise<void>;
};

const DocumentPresentationControllerForwardRef = forwardRef(DocumentPresentationController);
export {DocumentPresentationControllerForwardRef as DocumentPresentationController};

function DocumentPresentationController(
    {
        editorState,
        fileAttachmentTarget,
    }: {
        editorState: ContentEditorState<DocumentContentWithReferences>;
        fileAttachmentTarget: Memo<FileAttachmentTarget>;
    },
    ref: Ref<DocumentPresentationControllerRef>,
) {
    const fullscreenRef = useRef<HTMLDivElement>(null);

    const [isPresenting, setIsPresenting] = useState(false);

    const present = useEvent(async () => {
        if (isPresenting) return;

        // Render the presentation view synchronously. Since Chrome only allows
        // `requestFullscreen()` to work in response to a direct user interaction (in
        // our case, the user clicking on a menu item).
        //
        // We need to render presentation mode synchronously so that Chrome correctly
        // associates our `requestFullscreen()` call with the user's click interaction.
        // Previously we awaited a promise that was resolved in a `useEffect()` which
        // sometimes caused Chrome to consider the `requestFullscreen()` call invalid.
        flushSync(() => setIsPresenting(true));

        const fullscreenElement = assertExists(fullscreenRef.current);

        try {
            await fullscreenElement.requestFullscreen({navigationUI: "hide"});
        } catch (error) {
            setIsPresenting(false);
            throw error;
        }
    });

    useImperativeHandle(ref, () => ({present}), [present]);

    useEffect(() => {
        if (!isPresenting) return;

        const fullscreenElement = assertExists(fullscreenRef.current);

        const handleFullscreenChange = () => {
            if (document.fullscreenElement !== fullscreenElement) {
                setIsPresenting(false);
            }
        };

        fullscreenElement.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            fullscreenElement.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, [isPresenting]);

    if (!isPresenting) return null;

    return (
        <Box position="fixed" top="0" width="0" height="0" overflow="hidden">
            <Box
                ref={fullscreenRef}
                overflow="hidden"
                backgroundColor="grey-0"
                style={{width: "100vw", height: "100vh"}}
            >
                <GlobalKeyDownEventModal>
                    <DocumentPresentationView
                        initialContent={editorState.getContent()}
                        fileAttachmentTarget={fileAttachmentTarget}
                    />
                </GlobalKeyDownEventModal>
            </Box>
        </Box>
    );
}
