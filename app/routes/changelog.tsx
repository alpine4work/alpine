import {LinkDescriptor} from "@remix-run/node";
import {ContentFileEntityRenderersContextProvider} from "~/client/web/content/file_entity/content_file_entity_renderers_context_provider.js";
import {ContextMenuContextProvider} from "~/client/web/design/context_menu.js";
import {DocumentContentEditor} from "~/client/web/documents/document_content_editor.js";
import {PeekStackContextProvider} from "~/client/web/peek/peek_stack.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/web/remix/use_update_meta_title.js";
import {GlobalLoadingIndicatorContextProvider} from "~/client/web/spaces/global_loading_indicator_context_provider.js";
import {SpaceContextProvider} from "~/client/web/spaces/space_context_provider.js";
import {getDocumentWithOptionalCommentsIfExists} from "~/server/documents/data/documents_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {createEmptySpellCheckIgnoredLintsForNewEntity} from "~/server/spell_check/get_spell_check_ignored_lints.js";
import {defaultSpaceThemeColor} from "~/shared/design/core/theme_colors.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {createDynamoGeneralRealtimeQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

/**
 * Standalone route for `/changelog` that displays a specific document.
 *
 * This route duplicates some logic from
 * `s.$spaceId.documents.$documentId._index.tsx` because we can't reuse that route
 * directly:
 *
 * 1. **URL rewriting doesn't work**: Rewriting `/changelog` to
 *    `/s/.../documents/...` in EdgeService or via Cloudflare rules causes an
 *    infinite redirect loop. Remix hydrates on the client and detects a mismatch
 *    between the browser URL (`/changelog`) and the server-rendered route,
 *    triggering navigation attempts.
 *
 * 2. **Can't reuse the document route's exports**: The document route is a child
 *    of `s.$spaceId.tsx` which provides `SpaceContext`. It uses `useParams()` to
 *    get IDs from the URL and `useSpaceContext()` from the parent layout. A
 *    root-level route like `/changelog` doesn't have access to these.
 *
 * 3. **Different data requirements**: The document route's loader assumes the
 *    parent layout already loaded space/account data. This route must load
 *    everything itself.
 */

// Hardcoded IDs for the changelog document
const changelogSpaceId = alpineCompanyKnownSpaceId;
const changelogDocumentId = "5fcpht8pr6mh52v5z6cscj08gw" as DocumentId;

const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    document: DocumentModel.schema(),
    spellCheckIgnoredLints: createDynamoGeneralRealtimeQuerySchema(
        SpellCheckIgnoredLintModel.schema(),
    ),
});

export function links(): Array<LinkDescriptor> {
    return [
        {
            rel: "stylesheet",
            href: `data:text/css,${encodeURIComponent(
                `html, body {overflow: hidden; width: 100svw; height: 100svh}`,
            )}`,
        },
    ];
}

export async function loader({context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const document = await getDocumentWithOptionalCommentsIfExists(context, changelogDocumentId);

    if (!document) {
        throw createDocumentNotFoundError(changelogDocumentId);
    }

    return jsonWithSchema(LoaderSchema, {
        space: new SpaceModel({
            id: changelogSpaceId,
            version: -1,
            name: "",
            avatars: {
                darkTheme: null,
                lightTheme: null,
            },
            themeColor: defaultSpaceThemeColor,
        }),
        document,
        spellCheckIgnoredLints: createEmptySpellCheckIgnoredLintsForNewEntity(
            `Document:${changelogDocumentId}`,
        ),
    });
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => [
    {title: document?.getTitle() ?? documentFallbackTitle},
]);

export default function ChangelogRoute() {
    const {space, document, spellCheckIgnoredLints} = useLoaderDataWithSchema(LoaderSchema);
    const updateMetaTitle = useUpdateMetaTitle();

    return (
        <ContentFileEntityRenderersContextProvider>
            <GlobalLoadingIndicatorContextProvider>
                {globalLoadingIndicator => (
                    <SpaceContextProvider
                        initialSpace={space}
                        currentAccount={null}
                        currentAccountWithoutSpace={null}
                        initialSettings={null}
                        withMyAccountWebSocket={false}
                    >
                        <PeekStackContextProvider globalLoadingIndicator={globalLoadingIndicator}>
                            <ContextMenuContextProvider>
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        height: "100svh",
                                        width: "100svw",
                                    }}
                                >
                                    <DocumentContentEditor
                                        key={changelogDocumentId}
                                        documentId={changelogDocumentId}
                                        initialDocument={document}
                                        initialCommentThreadResult={null}
                                        initialIsFavorite={false}
                                        initialScroll={null}
                                        initialSpellCheckIgnoredLints={spellCheckIgnoredLints}
                                        shouldInitiallyFocus={false}
                                        onCreate={noop}
                                        onContentChange={content => {
                                            updateMetaTitle(
                                                `${getDocumentContentTitle(content)}${metaTitlePostfix}`,
                                            );
                                        }}
                                        onContentLocalChange={noop}
                                        onCommentThreadChange={noop}
                                        shareActivationHint={null}
                                        onShareActivationHintHide={noop}
                                    />
                                </div>
                            </ContextMenuContextProvider>
                        </PeekStackContextProvider>
                    </SpaceContextProvider>
                )}
            </GlobalLoadingIndicatorContextProvider>
        </ContentFileEntityRenderersContextProvider>
    );
}
