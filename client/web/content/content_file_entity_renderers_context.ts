import {CalendarDate} from "@internationalized/date";
import {createContext} from "react";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {ContentFileLayout} from "~/client/web/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityType} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
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
                currentAccount: AccountModel | null;
                blockWidth: number;
                transformScale: number;
                platform: Platform;
                spacingScale: SpacingScale;
                routeLayout: RouteLayout;
                isInitialAppRender: boolean;
                currentDate: CalendarDate;
                fileEntityRenderers: ContentFileEntityRenderers | null;
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
                    fileEntityRenderers: ContentFileEntityRenderers | null;
                },
            ) => () => void
        >
    >;
};

export const ContentFileEntityRenderersContext = createContext<ContentFileEntityRenderers | null>(
    null,
);
