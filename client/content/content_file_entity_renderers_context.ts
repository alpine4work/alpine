import {CalendarDate} from "@internationalized/date";
import {createContext} from "react";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {Reporter} from "~/client/design/reporter.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityType} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * Renderers for each file entity. These must be provided to `<ContentEditor>`
 * via dependency injection because the `//client/content` package can't depend
 * on all the UI packages we would need to render each file entity without
 * creating cycles between packages (e.g. `//client/tasks` and
 * `//client/documents`).
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
                fileRegistry: FileRegistry;
                currentAccount: AccountModel | null;
                blockWidth: number;
                transformScale: number;
                platform: Platform;
                spacingScale: SpacingScale;
                isInitialAppRender: boolean;
                currentDate: CalendarDate;
                fileEntityRenderers: ContentFileEntityRenderers | null;
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
                },
            ) => () => void
        >
    >;
};

export const ContentFileEntityRenderersContext = createContext<ContentFileEntityRenderers | null>(
    null,
);
