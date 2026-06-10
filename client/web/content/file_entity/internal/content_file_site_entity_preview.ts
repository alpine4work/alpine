import {CalendarDate} from "@internationalized/date";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {renderContentFileErrorPreview} from "~/client/web/content/internal/content_file_error_preview.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_widths.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {FileSiteEntityModelSchema} from "~/shared/sites/file_site_entity_model_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFileSiteEntityPreview(
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
) {
    const fileEntity = options.fileEntity.deserialize(FileSiteEntityModelSchema);

    if (!fileEntity.firstEntity) {
        // Reuse the deleted/permission-denied "error preview" layout (no icon) so an empty
        // site has the same compact, centered chrome as other unrenderable file entities.
        // The title already shows the site name, so the message stays generic.
        html.appendChild(
            renderContentFileErrorPreview({
                layout: options.layout,
                icon: null,
                title: fileEntity.name,
                displayMessage: errorDisplayMessage`This site is empty.`,
                platform: options.platform,
                spacingScale: options.spacingScale,
            }),
        );
        return;
    }

    // Render the first entity directly into our slot. The inner entity already
    // surfaces a site breadcrumb (sourced from the same `SitePreviewModel` the server
    // passes down), so no wrapping site header is needed.
    options.fileEntityRenderers.renderPreviewByType[fileEntity.firstEntity.type](get, html, {
        ...options,
        fileEntity: fileEntity.firstEntity,
    });
}
