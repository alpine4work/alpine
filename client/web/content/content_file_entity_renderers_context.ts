import {CalendarDate} from "@internationalized/date";
import {createContext, useContext} from "react";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_layout.js";
import {Platform} from "~/shared/design/core/platform.open_source.js";
import {RouteLayout} from "~/shared/design/core/route_layout.open_source.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import {UnimplementedError} from "~/shared/error/error.open_source.js";
import {FileEntityType} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * Renderers for each file entity. These must be provided to `<ContentEditor>` via
 * dependency injection because the `//client/web/content` package can't depend on
 * all the UI packages we would need to render each file entity without creating
 * cycles between packages (e.g. `//client/web/tasks` and
 * `//client/web/documents`).
 */
export type ContentFileEntityRenderers = {
    readonly renderPreviewByType: Record<
        FileEntityType,
        (
            get: <Value>(store: Store<Value>) => Value,
            html: HtmlElementGenerator,
            options: {
                fileEntity: FileEntityModel;
                layout: ContentFileLayout;
                getContext: () => AppContext;
                clientInfo: ClientInfo;
                spaceId: SpaceId | null;
                accountRegistry: AccountRegistry;
                searchEntityRegistry: SearchEntityRegistry;
                fileRegistry: FileRegistry;
                siteRegistry: SiteRegistry;
                currentAccount: AccountModel | null;
                blockWidth: number;
                transformScale: number;
                platform: Platform;
                spacingScale: SpacingScale;
                routeLayout: RouteLayout;
                isInitialAppRender: boolean;
                currentDate: CalendarDate;
                fileEntityRenderers: ContentFileEntityRenderers;
                suppressHydrationWarning: () => void;
            },
        ) => void
    >;
    readonly addPreviewBehaviorByType: Partial<
        Record<
            FileEntityType,
            (
                getContext: () => AppContext,
                element: HTMLElement,
                options: {
                    fileEntity: FileEntityModel;
                    spaceId: SpaceId;
                    getReporter: () => Reporter;
                    isInert: boolean;
                    fileEntityRenderers: ContentFileEntityRenderers;
                },
            ) => () => void
        >
    >;
};

export const ContentFileEntityRenderersContext = createContext<ContentFileEntityRenderers | null>(
    null,
);

function throwCantRenderFileEntityInUnitTest(): never {
    throw new UnimplementedError("Can\u2019t render file entities in unit tests");
}

/**
 * File entity renderers used when `ContentFileEntityRenderersContext` is `null`
 * (only in unit tests). Every renderer throws a clear error rather than leaving
 * holes that surface as confusing "x is not a function" failures — unit tests
 * shouldn't be rendering file entities.
 */
export const contentFileEntityRenderersForTest: ContentFileEntityRenderers = {
    renderPreviewByType: {
        Channel: throwCantRenderFileEntityInUnitTest,
        Chat: throwCantRenderFileEntityInUnitTest,
        Document: throwCantRenderFileEntityInUnitTest,
        Post: throwCantRenderFileEntityInUnitTest,
        Site: throwCantRenderFileEntityInUnitTest,
        Task: throwCantRenderFileEntityInUnitTest,
        TaskCollection: throwCantRenderFileEntityInUnitTest,
    },
    addPreviewBehaviorByType: {
        Channel: throwCantRenderFileEntityInUnitTest,
        Chat: throwCantRenderFileEntityInUnitTest,
        Document: throwCantRenderFileEntityInUnitTest,
        Post: throwCantRenderFileEntityInUnitTest,
        Site: throwCantRenderFileEntityInUnitTest,
        Task: throwCantRenderFileEntityInUnitTest,
        TaskCollection: throwCantRenderFileEntityInUnitTest,
    },
};

export function useContentFileEntityRenderers(): ContentFileEntityRenderers {
    const fileEntityRenderers = useContext(ContentFileEntityRenderersContext);

    if (fileEntityRenderers !== null) return fileEntityRenderers;

    // File entity renderers context should only ever be null in a test environment.
    assert(import.meta.jest);
    return contentFileEntityRenderersForTest;
}
