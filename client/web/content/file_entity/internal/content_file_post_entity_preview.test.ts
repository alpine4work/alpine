// To update generated snapshots run:
//
// ```
// bazel run //client/web/content/file_entity:internal/content_file_post_entity_preview_test -- --updateSnapshot
// ```

import {CalendarDate} from "@internationalized/date";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {renderContentFilePostEntityPreview} from "~/client/web/content/file_entity/internal/content_file_post_entity_preview.js";
import {normalizeHtmlForFileEntityTest} from "~/client/web/content/file_entity/internal/test_helpers/normalize_html_for_file_entity_test.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {getSiteRegistry} from "~/client/web/sites/site_registry_context.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FilePostEntityModelSchema} from "~/shared/forum/file_post_entity_model_schema.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
} from "~/shared/forum/post_content_schema.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {defaultClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

// Fixed IDs for deterministic snapshots
const spaceId = assertId<SpaceId>("ynfzf5f2djp2yq7gv7bde2zqy8");
const currentDate = new CalendarDate(2025, 5, 1);

function getContext(): AppContext {
    throw new UnimplementedError("`getContext()` is unimplemented in this test file");
}

function createBasicPostEntityPreviewModel({
    id,
    author,
    content = "Sample post content",
    channelName = "General",
}: {
    id: PostId;
    author: AccountModel;
    content?: string;
    channelName?: string | null;
}): FileEntityModel {
    const doc = assertPostContent(
        PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node(
                "paragraph",
                {},
                content.length > 0 ? [PostContentProsemirrorSchema.text(content)] : [],
            ),
        ]),
    );

    const baseModel = {
        type: "Post" as const,
        versions: [1],
        id,
        author,
        createdTime: new Date("2025-01-01T12:00:00Z"),
        channelName,
        content: {
            doc,
            references: emptyContentReferences,
        },
    };

    return new FileEntityModel(FilePostEntityModelSchema, baseModel);
}

// Fixed post ID for deterministic snapshots
const postId = assertId<PostId>("4ch98kddfs9vhz3qhdh4k7j5tc");
const authorId = assertId<AccountId>("ne9xp93dwgcwccj661x3ntdb9w");

describe("renderContentFilePostEntityPreview - HTML Snapshots", () => {
    const author = createTestAccountModel({
        name: "Test Author",
        id: authorId,
        reactionCharacter: null,
    });

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
            name: "basic-post",
            createEntity: () =>
                createBasicPostEntityPreviewModel({
                    id: postId,
                    author,
                }),
        },
        {
            name: "post-with-channel",
            createEntity: () =>
                createBasicPostEntityPreviewModel({
                    id: postId,
                    author,
                    channelName: "Announcements",
                }),
        },
        {
            name: "post-without-channel",
            createEntity: () =>
                createBasicPostEntityPreviewModel({
                    id: postId,
                    author,
                    channelName: null,
                }),
        },
        {
            name: "post-with-long-content",
            createEntity: () =>
                createBasicPostEntityPreviewModel({
                    id: postId,
                    author,
                    content: `
                    This is a very long post content that should be truncated properly in the preview and demonstrate how the post preview handles overflow text content.
                    This is a very long post content that should be truncated properly in the preview and demonstrate how the post preview handles overflow text content.
                    This is a very long post content that should be truncated properly in the preview and demonstrate how the post preview handles overflow text content.
                    This is a very long post content that should be truncated properly in the preview and demonstrate how the post preview handles overflow text content.
                    `,
                }),
        },
        {
            name: "empty-content-post",
            createEntity: () =>
                createBasicPostEntityPreviewModel({
                    id: postId,
                    author,
                    content: "",
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

                            renderContentFilePostEntityPreview(store => store.getSnapshot(), html, {
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
                            });

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
