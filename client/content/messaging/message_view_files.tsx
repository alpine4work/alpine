import classNames from "classnames";
import {Node} from "prosemirror-model";
import {EditorView, __serializeForClipboard as serializeForClipboard} from "prosemirror-view";
import {Memo, useContext, useMemo, useRef, useState} from "react";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {ContentFileEntityRenderersContext} from "~/client/content/content_file_entity_renderers_context.js";
import {FileModelRegistryData} from "~/client/content/file_registry.js";
import {useFileRegistry} from "~/client/content/file_registry_context.js";
import {registerClipboardSerializer} from "~/client/content/handle_copy_event_if_not_text_input_element.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/content/internal/content_base_schema_with_files.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {
    addContentFileEntityPreviewBehavior,
    renderContentFileEntityPreview,
} from "~/client/content/internal/content_file_entity_preview.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/content/internal/content_file_preview.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {
    ContentFileLayout,
    computeContentFileRowLikeLayout,
} from "~/client/content/state/content_file_layout_computations.js";
import {getContentBlockWidth} from "~/client/content/state/get_content_block_width.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {messageViewMarginLeft} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModelResult} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadModelFile} from "~/shared/messaging/message_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function MessageViewFiles({
    attachmentTarget,
    files,
    paddingTop,
    availableWidth,
}: {
    attachmentTarget: Memo<FileAttachmentTarget>;
    files: ReadonlyArray<MessageContentPayloadModelFile>;
    paddingTop?: Spacing;
    availableWidth?: number;
}) {
    assert(files.length > 0);

    const isInitialAppRender = useIsInitialAppRender();
    const context = useAppContext();
    const reporter = useReporter();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {space, currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();
    const fileEntityRenderers = useContext(ContentFileEntityRenderersContext);
    const currentDate = useCurrentDate();

    const [nodeByFileId] = useState(
        () =>
            new DefaultMap<FileId | FileEntityId, Node>(fileId =>
                ContentBaseProsemirrorSchemaWithFiles.get().node("file", {fileId}),
            ),
    );

    const containerRef = useRef<HTMLDivElement>(null);

    const {fileRows, html: htmlGenerator} = useStore(
        useMemo(() => {
            const blockWidth =
                getContentBlockWidth({
                    spacingScale,
                    platform,
                    routeLayout,
                    clientInfo,
                    availableWidth,
                }) - convertRemLengthToPx(messageViewMarginLeft, spacingScale);

            return computeStore(get => {
                const maxFileCount = 3;

                const html = new HtmlFragmentGenerator();
                const fileRows: Array<{
                    files: Array<MessageContentPayloadModelFile>;
                    fileDatas: Array<FileModelRegistryData | FileEntityId>;
                    fileLayouts: Array<ContentFileLayout>;
                }> = [];
                let nextFileRow: Array<MessageContentPayloadModelFile> = [];

                for (const file of files) {
                    if (nextFileRow.length < maxFileCount) {
                        nextFileRow.push(file);
                    } else {
                        pushNextFileRow(nextFileRow);
                        nextFileRow = [file];
                    }
                }

                pushNextFileRow(nextFileRow);
                nextFileRow = [];

                return {fileRows, html};

                function pushNextFileRow(files: Array<MessageContentPayloadModelFile>) {
                    const fileDatas = files.map(file => {
                        if (file.type === "FileEntity") return file.fileEntityId;
                        return get(fileRegistry.getFileStore(file));
                    });

                    const fileLayouts = computeContentFileRowLikeLayout(fileDatas, {
                        maxFileCount,
                        blockWidth,
                        platform,
                        spacingScale,
                        // Smaller max height than we have for content file row nodes so tall images
                        // don't take up too much of the screen.
                        maxHeight: "20rem",
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
                        const file = files[fileIndex]!;
                        const fileData = fileDatas[fileIndex]!;
                        const fileLayout = fileLayouts[fileIndex]!;

                        let fileHtml: HtmlElementGenerator;

                        if (typeof fileData === "string") {
                            assert(file.type === "FileEntity");

                            fileHtml = renderContentFileEntityPreview(get, {
                                node: nodeByFileId.getOrSetDefault(file.fileEntityId),
                                fileEntityId: file.fileEntityId,
                                fileEntityResult: file.fileEntityResult,
                                fileEntityRenderers,
                                layout: fileLayout,
                                getContext: () => context,
                                clientInfo,
                                spaceId: space.id,
                                accountRegistry,
                                searchEntityRegistry,
                                fileRegistry,
                                currentAccount,
                                blockWidth,
                                transformScale: 1,
                                platform,
                                spacingScale,
                                routeLayout,
                                isInitialAppRender,
                                currentDate,
                            });
                        } else {
                            fileHtml = renderContentFilePreview({
                                spaceId: space.id,
                                node: nodeByFileId.getOrSetDefault(fileData.id),
                                file: fileData,
                                layout: fileLayout,
                                blockWidth,
                                transformScale: 1,
                                platform,
                                spacingScale,
                                isInitialAppRender,
                                // Disable video and audio file interactivity. When pressed we should always
                                // open the post in a peek.
                                withoutInteractivity: true,
                            });
                        }

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
            accountRegistry,
            availableWidth,
            clientInfo,
            context,
            currentAccount,
            currentDate,
            fileEntityRenderers,
            fileRegistry,
            files,
            isInitialAppRender,
            nodeByFileId,
            platform,
            routeLayout,
            searchEntityRegistry,
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
                const file = files[fileIndex]!;
                const fileData = fileDatas[fileIndex]!;

                const fileElement = assertExists(
                    containerElement.childNodes[fileRowIndex]?.childNodes[fileIndex],
                );
                assert(fileElement instanceof HTMLElement);

                if (typeof fileData === "string") {
                    assert(file.type === "FileEntity");

                    cleanups.push(
                        addContentFileEntityPreviewBehavior(() => context, fileElement, {
                            spaceId: space.id,
                            node: nodeByFileId.getOrSetDefault(file.fileEntityId),
                            fileEntityId: file.fileEntityId,
                            fileEntityResult: file.fileEntityResult,
                            fileEntityRenderers,
                            navigate,
                            getReporter: () => reporter,
                        }),
                    );
                } else {
                    cleanups.push(
                        addContentFilePreviewBehavior(() => context, fileElement, {
                            spaceId: space.id,
                            node: nodeByFileId.getOrSetDefault(fileData.id),
                            file: fileData,
                            attachmentTarget,
                            isInitialAppRender,
                            rootNavigate,
                            getReporter: () => reporter,
                        }),
                    );
                }
            }
        }

        return () => {
            for (const cleanup of cleanups) {
                cleanup();
            }
        };
    }, [
        attachmentTarget,
        context,
        fileEntityRenderers,
        fileRows,
        isInitialAppRender,
        navigate,
        nodeByFileId,
        reporter,
        rootNavigate,
        space.id,
    ]);

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
                        clipboardFileRow.push(
                            clipboardSchema.node("file", {
                                fileId: cast<FileId | FileEntityId>(
                                    typeof file === "string" ? file : file.id,
                                ),
                            }),
                        );
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

            const fileById = new Map<FileId, {signedUrlSearch: string; file: FileModel}>();
            const fileEntityById = new Map<FileEntityId, FileEntityModelResult>();

            for (const fileRow of fileRows) {
                for (let fileIndex = 0; fileIndex < fileRow.files.length; fileIndex++) {
                    const file = fileRow.files[fileIndex]!;

                    if (file.type === "FileEntity") {
                        fileEntityById.set(file.fileEntityId, file.fileEntityResult);
                    } else {
                        fileById.set(file.file.id, file);
                    }
                }
            }

            const contentReferences: ContentReferences = {
                ...emptyContentReferences,
                fileById,
                fileEntityById,
            };

            const state = ContentEditorState.create({
                doc: clipboardSchema.node("doc", {}, clipboardFileRows),
                references: contentReferences,
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
