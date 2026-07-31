import classNames from "classnames";
import {Node} from "prosemirror-model";
import {EditorView, __serializeForClipboard as serializeForClipboard} from "prosemirror-view";
import {Memo, useMemo, useRef, useState} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useContentBlockWidth} from "~/client/web/content/content_block_width.js";
import {useContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {registerClipboardSerializer} from "~/client/web/content/handle_copy_event_if_not_text_input_element.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/web/content/internal/content_base_schema_with_files.js";
import {ContentEditorDomClipboardSerializer} from "~/client/web/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/web/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/web/content/internal/content_editor_text_clipboard_serializer.js";
import {
    addContentFileEntityPreviewBehavior,
    renderContentFileEntityPreview,
} from "~/client/web/content/internal/content_file_entity_preview.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/web/content/internal/content_file_preview.js";
import {useMediaDebugModeEnabled} from "~/client/web/content/media_debug_mode.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {computeContentFileRowLikeLayout} from "~/client/web/content/state/content_file_layout_computations.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {ContentFileLayout, fileRowMaxFileCount} from "~/shared/content/compute_file_row_layout.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
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
import {toFixedWithoutTrailingZeros} from "~/shared/helpers/number/to_fixed_without_trailing_zeros.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadModelFile} from "~/shared/messaging/message_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function MessageViewFiles({
    attachmentTarget,
    files,
    paddingTop,
}: {
    attachmentTarget: Memo<FileAttachmentTarget>;
    files: ReadonlyArray<MessageContentPayloadModelFile>;
    paddingTop?: Spacing;
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
    const siteRegistry = useSiteRegistry();
    const fileEntityRenderers = useContentFileEntityRenderers();
    const currentDate = useCurrentDate();
    const blockWidth = useContentBlockWidth();
    const isMediaDebugModeEnabled = useMediaDebugModeEnabled();

    const [nodeByFileId] = useState(
        () =>
            new DefaultMap<FileId | FileEntityId, Node>(fileId =>
                ContentBaseProsemirrorSchemaWithFiles.get().node("file", {fileId}),
            ),
    );

    const containerRef = useRef<HTMLDivElement>(null);

    const {
        fileRows,
        html: htmlGenerator,
        suppressHydrationWarning,
    } = useStore(
        useMemo(() => {
            return computeStore(get => {
                let suppressHydrationWarning = false;

                const maxFileCount = fileRowMaxFileCount;

                const html = new HtmlFragmentGenerator();
                const fileRows: Array<{
                    files: Array<MessageContentPayloadModelFile>;
                    fileDatas: Array<FileModelRegistryData | FileEntityId | null>;
                    fileLayouts: ReadonlyArray<ContentFileLayout>;
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

                return {fileRows, html, suppressHydrationWarning};

                function pushNextFileRow(files: Array<MessageContentPayloadModelFile>) {
                    const fileDatas = files.map(file => {
                        if (file.type === "Null") return null;
                        if (file.type === "FileEntity") return file.fileEntityId;
                        return get(fileRegistry.getFileStore(file));
                    });

                    const fileLayouts = computeContentFileRowLikeLayout(fileDatas, {
                        maxFileCount,
                        blockWidth,
                        platform,
                        spacingScale,
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
                            `height: ${toFixedWithoutTrailingZeros(Math.max(...fileLayouts.map(({height}) => height)), 3)}px`,
                            "display: grid",
                            "grid-template-rows: 1fr",
                            `grid-template-columns: ${fileLayouts
                                .map(({widthFr}) => `${toFixedWithoutTrailingZeros(widthFr, 6)}fr`)
                                .join(" ")}`,
                            // Left align message files instead of center aligning message files. This matches
                            // the more conversational format of messages as opposed to the carefully edited
                            // prose format of documents.
                            //
                            // NOTE(calebmer, 2026-03-12): I don't think this matters anymore now that we
                            // layout file rows with the requirement that we always fills the block width.
                            "justify-content: start",
                        ].join("; "),
                    );

                    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                        const file = files[fileIndex]!;
                        const fileData = fileDatas[fileIndex];
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
                                siteRegistry,
                                currentAccount,
                                blockWidth,
                                transformScale: 1,
                                platform,
                                spacingScale,
                                routeLayout,
                                isInitialAppRender,
                                currentDate,
                                suppressHydrationWarning: () => {
                                    suppressHydrationWarning = true;
                                },
                            });
                        } else {
                            assert(file.type !== "FileEntity");

                            fileHtml = renderContentFilePreview({
                                spaceId: space.id,
                                node: nodeByFileId.getOrSetDefault(
                                    file.type === "Null" ? file.fileId : file.file.id,
                                ),
                                file: fileData ?? undefined,
                                layout: fileLayout,
                                blockWidth,
                                transformScale: 1,
                                platform,
                                spacingScale,
                                isInitialAppRender,
                                // Disable video and audio file interactivity. When pressed we should always open
                                // the post in a peek.
                                withoutInteractivity: true,
                                isMediaDebugModeEnabled,
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
            blockWidth,
            clientInfo,
            context,
            currentAccount,
            currentDate,
            fileEntityRenderers,
            fileRegistry,
            files,
            isMediaDebugModeEnabled,
            isInitialAppRender,
            nodeByFileId,
            platform,
            routeLayout,
            searchEntityRegistry,
            siteRegistry,
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
            // This case happens during a hot reload. We need to remove the children currently
            // in the DOM.
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
                const fileData = fileDatas[fileIndex];

                const fileElement = assertExists(
                    containerElement.childNodes[fileRowIndex]?.childNodes[fileIndex],
                );
                assert(fileElement instanceof HTMLElement);

                if (typeof fileData === "string") {
                    assert(file.type === "FileEntity");

                    cleanups.push(
                        addContentFileEntityPreviewBehavior(() => context, fileElement, {
                            spaceId: space.id,
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
                            file: fileData ?? undefined,
                            attachmentTarget,
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
                const {files} = fileRows[fileRowIndex]!;
                const clipboardFileRow: Array<Node> = [];

                for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                    const file = files[fileIndex]!;

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
                                    file.type === "Null"
                                        ? file.fileId
                                        : file.type === "FileEntity"
                                          ? file.fileEntityId
                                          : file.file.id,
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

                    if (file.type === "Null") {
                        // noop
                    } else if (file.type === "FileEntity") {
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
                spaceId: space.id,
                content: {
                    doc: clipboardSchema.node("doc", {}, clipboardFileRows),
                    references: contentReferences,
                },
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
            // characteristics then let's unwrap the wrapper `<div>` so it won't be included in
            // the copied output.
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
            // If our content HTML renderer called `suppressHydrationWarning` then pass the
            // prop into React to suppress hydration warnings (e.g. blobs need to suppress
            // hydration warnings because there's a `<script>` which adds a `style` prop to
            // blobs).
            //
            // Don't suppress hydration warnings all the time, they're useful for detecting
            // errors!
            suppressHydrationWarning={suppressHydrationWarning}
        />
    );
}
