// To update generated snapshots run:
//
// ```
// bazel run //client/web/content/file_entity:internal/content_file_channel_entity_preview_test -- --updateSnapshot
// ```

import {CalendarDate} from "@internationalized/date";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {renderContentFileChannelEntityPreview} from "~/client/web/content/file_entity/internal/content_file_channel_entity_preview.js";
import {normalizeHtmlForFileEntityTest} from "~/client/web/content/file_entity/internal/test_helpers/normalize_html_for_file_entity_test.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {getSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {assertId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {defaultClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

// Fixed IDs for deterministic snapshots
const spaceId = assertId<SpaceId>("2pm2pfcv5b2r52nkz2yy1r2x4c");
const currentDate = new CalendarDate(2025, 5, 1);

function getContext(): AppContext {
    throw new UnimplementedError("`getContext()` is unimplemented in this test file");
}

function createBasicChannelEntityModel({
    id,
    name,
    description = "Channel description",
    isPrivate = false,
    isSubscribed = false,
    contributorCount = 0,
    topContributors = [],
}: {
    id: ChannelId;
    name: string;
    description?: string | null;
    isPrivate?: boolean;
    isSubscribed?: boolean;
    contributorCount?: number;
    topContributors?: Array<AccountModel>;
}): FileEntityModel {
    const doc = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node(
                "paragraph",
                {},
                description ? [MessageContentProsemirrorSchema.text(description)] : [],
            ),
        ]),
    );

    const baseModel = {
        type: "Channel" as const,
        versions: [1],
        id,
        createdTime: new Date("2025-01-01T00:00:00Z"),
        name,
        isPrivate,
        description: {
            doc,
            references: emptyDocumentContentReferences,
        },
        isSubscribed,
        contributorCount,
        topContributors,
    };

    return new FileEntityModel(FileChannelEntityModelSchema, baseModel);
}

// Fixed channel ID for deterministic snapshots
const channelId = assertId<ChannelId>("rkb0rfnty8jc5p5trcp3nmwq68");

describe("renderContentFileChannelEntityPreview - HTML Snapshots", () => {
    const basicParams = {
        getContext,
        clientInfo: defaultClientInfo,
        spaceId,
        accountRegistry: getAccountRegistry(spaceId),
        searchEntityRegistry: getSearchEntityRegistry(spaceId),
        fileRegistry: getFileRegistry(spaceId),
        siteRegistry: getSiteRegistry(spaceId),
        currentAccount: null,
        transformScale: 1,
        routeLayout: "wide" as const,
        isInitialAppRender: false,
        currentDate,
        fileEntityRenderers: null as ContentFileEntityRenderers | null,
    };

    const spacingScales = ["small", "medium", "large"] as const;
    const layouts = [
        {width: 100, name: "fourth-width", height: 200},
        {width: 200, name: "third-width", height: 300},
        {width: 300, name: "half-width", height: 400},
        {width: 800, name: "full-width", height: 500},
    ] as const;
    const platforms = ["desktop", "mobile"] as const;

    const testCases = [
        {
            name: "basic-channel",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Test Channel",
                }),
        },
        {
            name: "subscribed-channel",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Subscribed Channel",
                    isSubscribed: true,
                }),
        },
        {
            name: "unsubscribed-channel",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Unsubscribed Channel",
                }),
        },
        {
            name: "channel-with-contributors",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Channel with Contributors",
                    isSubscribed: false,
                    contributorCount: 2,
                    topContributors: [],
                }),
        },
        {
            name: "channel-with-overflow-contributors",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Overflow Contributors",
                    isSubscribed: false,
                    contributorCount: 10,
                    topContributors: [],
                }),
        },
        {
            name: "empty-description-channel",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Empty Description Channel",
                    description: null,
                }),
        },
        {
            name: "private-channel",
            createEntity: () =>
                createBasicChannelEntityModel({
                    id: channelId,
                    name: "Private Channel",
                    isPrivate: true,
                }),
        },
    ] as const;

    spacingScales.forEach(spacingScale => {
        describe(`spacingScale: ${spacingScale}`, () => {
            layouts.forEach(layout => {
                platforms.forEach(platform => {
                    testCases.forEach(testCase => {
                        test(`${layout.name} ${platform} ${testCase.name}`, async () => {
                            const fileEntity = testCase.createEntity();
                            const html = new HtmlElementGenerator("div");

                            renderContentFileChannelEntityPreview(
                                store => store.getSnapshot(),
                                html,
                                {
                                    ...basicParams,
                                    fileEntity,
                                    layout: {
                                        width: layout.width,
                                        widthFr: 1,
                                        height: layout.height,
                                    },
                                    platform,
                                    spacingScale,
                                    suppressHydrationWarning: noop,
                                },
                            );

                            expect(
                                await normalizeHtmlForFileEntityTest(html.generateHtml()),
                            ).toMatchSnapshot();
                        });
                    });
                });
            });
        });
    });
});
