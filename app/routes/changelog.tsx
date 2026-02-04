import {useMemo} from "react";
import {ContentView} from "~/client/web/content/content_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {SpaceContextProvider} from "~/client/web/spaces/space_context_provider.js";
import {getDocumentWithOptionalCommentsIfExists} from "~/server/documents/data/documents_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

/**
 * Standalone route for `/changelog` that displays a specific document.
 *
 * This route duplicates some logic from `s.$spaceId.documents.$documentId._index.tsx`
 * because we can't reuse that route directly:
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

// Hardcoded IDs for the release notes document
const changelogSpaceId = alpineCompanyKnownSpaceId;
const changelogDocumentId = "5fcpht8pr6mh52v5z6cscj08gw" as DocumentId;

const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    document: DocumentModel.schema(),
});

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
        }),
        document,
    });
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => [
    {title: document?.getTitle() ?? documentFallbackTitle},
]);

export default function ChangelogRoute() {
    const {space, document} = useLoaderDataWithSchema(LoaderSchema);
    const fileAttachmentTarget = useMemo(
        () => ({type: "Document", documentId: changelogDocumentId}) as const,
        [],
    );

    return (
        <SpaceContextProvider
            initialSpace={space}
            currentAccount={null}
            currentAccountWithoutSpace={null}
        >
            <div
                style={{
                    height: "100svh",
                    width: "100svw",
                    overflow: "auto",
                    padding: "24px",
                }}
            >
                <ContentView
                    content={document.content}
                    isInert={true}
                    fileAttachmentTarget={fileAttachmentTarget}
                />
            </div>
        </SpaceContextProvider>
    );
}
