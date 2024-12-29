import classNames from "classnames";
import {Node} from "prosemirror-model";
import {EditorView, serializeForClipboard} from "prosemirror-view";
import {Memo, useMemo, useRef} from "react";
import {
    ContentEditorState,
    reduceContentReferencesWithFiles,
} from "~/client/content/content_editor_state.js";
import {FileClientStoreData} from "~/client/content/file_client_store.js";
import {useFileClientStore} from "~/client/content/file_client_store_context.js";
import {registerClipboardSerializer} from "~/client/content/handle_copy_event_if_not_text_input_element.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/content/internal/content_base_schema_with_files.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {
    ContentFileLayout,
    computeContentFileRowLayout,
} from "~/client/content/internal/content_file_layout_computations.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/content/internal/content_file_preview.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {messageViewMarginLeft} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ContentReferencesWithFiles} from "~/shared/content/content_references_with_files.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function MessageViewFiles({
    attachmentTarget,
    files,
    paddingTop,
    screenWidth,
}: {
    attachmentTarget: Memo<FileAttachmentTarget>;
    files: ReadonlyArray<{signedUrlSearch: string; file: FileModel}>;
    paddingTop?: Spacing;
    screenWidth?: number;
}) {
    assert(files.length > 0);

    const isInitialAppRender = useIsInitialAppRender();
    const context = useAppContext();
    const reporter = useReporter();
    const rootNavigate = useRootNavigate();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {space} = useSpaceContext();
    const fileStore = useFileClientStore();

    const containerRef = useRef<HTMLDivElement>(null);

    const {fileRows, html: htmlGenerator} = useStore(
        useMemo(() => {
            return computeStore(get => {
                const html = new HtmlFragmentGenerator();
                const fileRows: Array<{
                    files: Array<{signedUrlSearch: string; file: FileModel}>;
                    fileDatas: Array<FileClientStoreData>;
                    fileLayouts: Array<ContentFileLayout>;
                }> = [];
                let nextFileRow: Array<{signedUrlSearch: string; file: FileModel}> = [];

                for (const file of files) {
                    if (nextFileRow.length < 3) {
                        nextFileRow.push(file);
                    } else {
                        pushNextFileRow(nextFileRow);
                        nextFileRow = [file];
                    }
                }

                pushNextFileRow(nextFileRow);
                nextFileRow = [];

                return {fileRows, html};

                function pushNextFileRow(files: Array<{signedUrlSearch: string; file: FileModel}>) {
                    const fileDatas = files.map(file => get(fileStore.getFileStore(file)));

                    const fileLayouts = computeContentFileRowLayout(fileDatas, {
                        screenWidth: screenWidth ?? clientInfo.screenWidth,
                        platform,
                        spacingScale,
                        // Smaller max height than we have for content file row nodes so tall images
                        // don't take up too much of the screen.
                        maxHeight: "20rem",
                        marginLeft: messageViewMarginLeft,
                    });

                    fileRows.push({files, fileDatas, fileLayouts});

                    const fileRowHtml = new HtmlElementGenerator("div");
                    html.appendChild(fileRowHtml);

                    fileRowHtml.setAttribute(
                        "class",
                        sprinkles({
                            width: "full",
                            userSelect: "none",
                            gap: contentStyles.fileRowGapWidth,
                        }),
                    );

                    fileRowHtml.setAttribute(
                        "style",
                        [
                            `height: ${Math.max(...fileLayouts.map(({height}) => height))}px`,
                            "display: grid",
                            "grid-template-rows: 1fr",
                            `grid-template-columns: ${fileLayouts
                                .map(({widthFr}) => `${widthFr}fr`)
                                .join(" ")}`,
                            // Left align message files instead of center aligning message files. This
                            // matches the more conversational format of messages as opposed to the
                            // carefully edited prose format of documents.
                            "justify-content: start",
                        ].join("; "),
                    );

                    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                        const file = fileDatas[fileIndex]!;
                        const layout = fileLayouts[fileIndex]!;

                        const fileHtml = renderContentFilePreview({
                            spaceId: space.id,
                            node: ContentBaseProsemirrorSchemaWithFiles.get().node("file", {
                                fileId: file.id,
                            }),
                            file,
                            layout,
                            screenWidth: screenWidth ?? clientInfo.screenWidth,
                            screenScale: 1,
                            platform,
                            spacingScale,
                            isInitialAppRender,
                            // Disable video and audio file interactivity. When pressed we should always
                            // open the post in a peek.
                            withoutInteractivity: true,
                        });

                        fileHtml.setAttribute(
                            "class",
                            classNames(
                                fileHtml.getAttribute("class"),
                                contentStyles.alwaysShowFileBorderClassName,
                            ),
                        );

                        fileRowHtml.appendChild(fileHtml);
                    }
                }
            });
        }, [
            clientInfo.screenWidth,
            fileStore,
            files,
            isInitialAppRender,
            platform,
            screenWidth,
            space.id,
            spacingScale,
        ]),
    );

    const previousHtmlGeneratorRef = useRef<HtmlGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const previousHtmlGenerator = previousHtmlGeneratorRef.current;
        previousHtmlGeneratorRef.current = htmlGenerator;

        if (previousHtmlGenerator === htmlGenerator) return;

        if (!previousHtmlGenerator) {
            // This case happens during a hot reload. We need to remove the children
            // currently in the DOM.
            while (containerElement.hasChildNodes()) {
                containerElement.firstChild!.remove();
            }

            containerElement.appendChild(htmlGenerator.generateNode());
        } else {
            assert(htmlGenerator.patchNode(previousHtmlGenerator, containerElement));
        }
    }, [htmlGenerator, isInitialAppRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);
        const cleanups: Array<() => void> = [];

        for (let fileRowIndex = 0; fileRowIndex < fileRows.length; fileRowIndex++) {
            const {files, fileDatas} = fileRows[fileRowIndex]!;

            for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                const file = fileDatas[fileIndex]!;

                const fileElement = assertExists(
                    containerElement.childNodes[fileRowIndex]?.childNodes[fileIndex],
                );
                assert(fileElement instanceof HTMLElement);

                cleanups.push(
                    addContentFilePreviewBehavior(() => context, fileElement, {
                        spaceId: space.id,
                        node: ContentBaseProsemirrorSchemaWithFiles.get().node("file", {
                            fileId: file.id,
                        }),
                        file,
                        attachmentTarget,
                        isInitialAppRender,
                        rootNavigate,
                        getReporter: () => reporter,
                    }),
                );
            }
        }

        return () => {
            for (const cleanup of cleanups) {
                cleanup();
            }
        };
    }, [attachmentTarget, context, fileRows, isInitialAppRender, reporter, rootNavigate, space.id]);

    useLayoutEffectWithoutServerSideWarning(() => {
        const containerElement = assertExists(containerRef.current);

        return registerClipboardSerializer(containerElement, ({startNode, endNode}) => {
            let hasStarted = !containerElement.contains(startNode);
            let hasEnded = false;

            const clipboardSchema = ContentBaseProsemirrorSchemaWithFiles.get();
            const clipboardFileRows: Array<Node> = [];

            for (let fileRowIndex = 0; fileRowIndex < fileRows.length; fileRowIndex++) {
                const {files, fileDatas} = fileRows[fileRowIndex]!;
                const clipboardFileRow: Array<Node> = [];

                for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                    const file = fileDatas[fileIndex]!;

                    const fileElement = assertExists(
                        containerElement.childNodes[fileRowIndex]?.childNodes[fileIndex],
                    );
                    assert(fileElement instanceof HTMLElement);

                    if (!hasStarted && startNode.contains(fileElement)) {
                        hasStarted = true;
                    }

                    if (hasStarted && !hasEnded) {
                        clipboardFileRow.push(clipboardSchema.node("file", {fileId: file.id}));
                    }

                    if (hasEnded || endNode.contains(fileElement)) {
                        hasEnded = true;
                        break;
                    }
                }

                if (clipboardFileRow.length > 0) {
                    clipboardFileRows.push(clipboardSchema.node("fileRow", {}, clipboardFileRow));
                }

                if (hasEnded) break;
            }

            const contentReferences: ContentReferencesWithFiles = {
                ...emptyContentReferences,
                fileById: new Map(
                    fileRows.flatMap(fileRow => fileRow.files).map(file => [file.file.id, file]),
                ),
            };

            const state = ContentEditorState.create({
                content: {
                    doc: clipboardSchema.node("doc", {}, clipboardFileRows),
                    references: contentReferences,
                },
                reduceReferences: reduceContentReferencesWithFiles,
            })._getInternalState();
            const {schema} = state.doc.type;

            const view = new EditorView(null, {
                state,
                domParser: ContentEditorDomParser.fromSchema(schema),
                clipboardSerializer:
                    ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                        schema,
                        () => space.id,
                        () => contentReferences,
                        () => assertExists(attachmentTarget),
                    ),
                clipboardTextSerializer: slice =>
                    contentEditorTextClipboardSerializer(
                        slice,
                        () => space.id,
                        () => contentReferences,
                    ),
            });

            const {dom, text} = serializeForClipboard(view, state.doc.slice(0));

            let html: globalThis.Node = dom;

            // If the clipboard content was wrapped in a `<div>` with no identifying
            // characteristics then let's unwrap the wrapper `<div>` so it won't be
            // included in the copied output.
            if (
                html instanceof Element &&
                html.tagName === "DIV" &&
                !html.hasAttribute("class") &&
                !html.hasAttribute("style")
            ) {
                const htmlFragment = document.createDocumentFragment();
                while (dom.firstChild) {
                    htmlFragment.appendChild(dom.firstChild);
                }
                html = htmlFragment;
            }

            return {
                requiredLineBreakAroundCount: 1,
                text,
                html,
            };
        });
    }, [attachmentTarget, fileRows, space.id]);

    return (
        <div
            ref={containerRef}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: spacing[contentStyles.fileRowGapWidth],
                paddingTop: paddingTop ? spacing[paddingTop] : undefined,
            }}
            dangerouslySetInnerHTML={
                isInitialAppRender ? {__html: htmlGenerator.generateHtml()} : undefined
            }
        />
    );
}
