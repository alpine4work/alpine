import classNames from "classnames";
import {useContext, useMemo, useRef} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentFileEntityRenderersContext} from "~/client/web/content/content_file_entity_renderers_context.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/web/content/internal/content_base_schema_with_files.js";
import {
    addContentFileEntityPreviewBehavior,
    renderContentFileEntityPreview,
} from "~/client/web/content/internal/content_file_entity_preview.js";
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
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Result} from "~/shared/helpers/control/result.js";
import {HtmlGenerator} from "~/shared/helpers/html/html_generator.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function ContentFileEntityPreview({
    width,
    height,
    blockWidth,
    fileEntityId,
    fileEntityResult,
}: {
    width: number;
    height: number;
    blockWidth: number;
    fileEntityId: FileEntityId;
    fileEntityResult: Result<FileEntityModel>;
}) {
    const context = useAppContext();
    const clientInfo = useClientInfo();
    const reporter = useReporter();
    const isInitialAppRender = useIsInitialAppRender();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {space, currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();
    const siteRegistry = useSiteRegistry();
    const currentDate = useCurrentDate();
    const fileEntityRenderers = useContext(ContentFileEntityRenderersContext);

    const containerRef = useRef<HTMLDivElement>(null);

    const node = useMemo(
        () => ContentBaseProsemirrorSchemaWithFiles.get().node("file", {fileId: fileEntityId}),
        [fileEntityId],
    );

    const htmlGeneratorStore = useMemo(() => {
        return computeStore(get => {
            let suppressHydrationWarning = false;

            const htmlGenerator = renderContentFileEntityPreview(get, {
                node,
                fileEntityId,
                fileEntityResult,
                fileEntityRenderers,
                layout: {width, widthFr: 1, height},
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

            htmlGenerator.setAttribute(
                "class",
                classNames(
                    htmlGenerator.getAttribute("class"),
                    contentStyles.withoutFileSelectionClassName,
                ),
            );

            return {htmlGenerator, suppressHydrationWarning};
        });
    }, [
        accountRegistry,
        blockWidth,
        clientInfo,
        context,
        currentAccount,
        currentDate,
        fileEntityId,
        fileEntityRenderers,
        fileEntityResult,
        fileRegistry,
        height,
        isInitialAppRender,
        node,
        platform,
        routeLayout,
        searchEntityRegistry,
        siteRegistry,
        space.id,
        spacingScale,
        width,
    ]);

    const {htmlGenerator, suppressHydrationWarning} = useStore(htmlGeneratorStore);

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
            assert(
                htmlGenerator.patchNode(
                    previousHtmlGenerator,
                    assertExists(containerElement.firstElementChild),
                ),
            );
        }
    }, [htmlGenerator, isInitialAppRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const cleanup = addContentFileEntityPreviewBehavior(
            () => context,
            assertExists(containerElement.firstElementChild) as HTMLElement,
            {
                spaceId: space.id,
                fileEntityId,
                fileEntityResult,
                fileEntityRenderers,
                navigate,
                getReporter: () => reporter,
            },
        );

        return () => {
            cleanup();
        };
    }, [
        context,
        fileEntityId,
        fileEntityRenderers,
        fileEntityResult,
        isInitialAppRender,
        navigate,
        node,
        reporter,
        rootNavigate,
        space.id,
    ]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                display: "grid",
                gridTemplateRows: "1fr",
                gridTemplateColumns: "1fr",
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
