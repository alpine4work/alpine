import classNames from "classnames";
import {useEffect, useMemo, useRef} from "react";
import {flushSync} from "react-dom";
import {createHeadMetaForDocument} from "~/app/helpers/create_head_meta.js";
import {deserializeDocumentIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {ContentFileEntityRenderersContextProvider} from "~/client/web/content/file_entity/content_file_entity_renderers_context_provider.js";
import {waitForContentFileImagePreviewContentsToLoad} from "~/client/web/content/wait_for_content_file_image_preview_contents_to_load.js";
import {Box} from "~/client/web/design/box.js";
import {overrideColorScheme} from "~/client/web/helpers/color_scheme.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {overridePlatform} from "~/client/web/remix/platform_context.js";
import {overrideSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {SpaceContextProvider} from "~/client/web/spaces/space_context_provider.js";
import {documentContentStyles} from "~/client/web/styles/styles.js";
import {getDocumentWithOptionalComments} from "~/server/documents/data/documents_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getOwnAccountAndSettingsIfExists} from "~/server/spaces/get_own_account_and_settings_if_exists.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {AccountSettingsSchema} from "~/shared/accounts/accounts_settings.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {stripDocumentContentCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    currentAccount: AccountModel.schema,
    currentAccountSettings: AccountSettingsSchema,
    document: DocumentModel.schema(),
});

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) =>
    createHeadMetaForDocument({title: document.getTitle(), openGraph: null}),
);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const documentId = deserializeDocumentIdForLoader(params.documentId);

    const document = await getDocumentWithOptionalComments(context, documentId);

    // TODO(calebmer): This isn't very efficient. Ideally we'd load the space as soon
    // as we discover the document's `SpaceId` instead of here which is after we've
    // loaded the full document and all its references. I'm planning a project to
    // change routes to `/doc/:documentId` for SEO. This project would need the space
    // to be loaded earlier. When we do this project we can update this code here to
    // support whatever early scheme we come up with for `/doc/:documentId` paths.
    const [space, currentAccountAndSettings] = await runAllPromises([
        getSpace(context, document.spaceId),
        getOwnAccountAndSettingsIfExists(context, document.spaceId, context.actor.getAccountId()),
    ]);

    assert(currentAccountAndSettings);

    return jsonWithSchema(LoaderSchema, {
        space,
        currentAccount: currentAccountAndSettings.account,
        currentAccountSettings: currentAccountAndSettings.settings,
        document,
    });
}

const printDocumentRouteCss = `\
@page {
    size: letter;
    margin: 0.5in;
}

body {
    margin-top: 0.25in;
}

html {
    margin: 0.5in;
}

@media print {
    html {
        margin: 0;
    }
}
`;

export default function PrintDocumentRoute() {
    const isInitialAppRender = useIsInitialAppRender();

    const {space, currentAccount, currentAccountSettings, document} =
        useLoaderDataWithSchema(LoaderSchema);

    // `letter` is 8.5in wide and we have 0.5in of margin. There are 96 CSS pixels per
    // inch. That gives us a 720px block width.
    const blockWidthPx = 720;

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        // We don't render images until after the initial app render.
        if (isInitialAppRender) return;

        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        void waitForContentFileImagePreviewContentsToLoad().finally(() => {
            // Make sure we're rendering with a `small` `SpacingScale` and `desktop` `Platform`
            // while printing. Our font size while printing shouldn't be affected by window
            // size.
            flushSync(() => {
                overrideSpacingScale("small");
                overridePlatform("desktop");
                overrideColorScheme("light");
            });

            // Tell `<DocumentContentEditor>` (which mounted this page in an `<iframe>`) when
            // we're done printing.
            const handleAfterPrint = () => {
                window.parent.postMessage("cyberworlds/printed", "/");
                window.removeEventListener("afterprint", handleAfterPrint);
            };

            window.addEventListener("afterprint", handleAfterPrint);

            window.print();

            flushSync(() => {
                overrideSpacingScale(null);
                overridePlatform(null);
                overrideColorScheme(null);
            });
        });
    }, [isInitialAppRender]);

    return (
        <>
            <style>{printDocumentRouteCss}</style>
            <ContentFileEntityRenderersContextProvider>
                <SpaceContextProvider
                    initialSpace={space}
                    currentAccount={currentAccount}
                    currentAccountWithoutSpace={currentAccount}
                    initialSettings={currentAccountSettings}
                    withMyAccountWebSocket={false}
                >
                    <Box style={{width: blockWidthPx, margin: "0 auto"}}>
                        <ContentBlockWidthContextProvider
                            width={blockWidthPx}
                            withoutAssumedPadding={true}
                        >
                            <ContentView
                                className={classNames(
                                    documentContentStyles.contentClassName,
                                    documentContentStyles.contentWithWideRouteLayoutClassName,
                                    documentContentStyles.printContentClassName,
                                )}
                                isInert={true}
                                withoutBlockMaxWidth={true}
                                content={useMemo(
                                    () => ({
                                        doc: stripDocumentContentCommentMarks(document.content.doc),
                                        references: document.content.references,
                                    }),
                                    [document.content],
                                )}
                                fileAttachmentTarget={useMemo(
                                    () => ({type: "Document", documentId: document.id}),
                                    [document.id],
                                )}
                            />
                        </ContentBlockWidthContextProvider>
                    </Box>
                </SpaceContextProvider>
            </ContentFileEntityRenderersContextProvider>
        </>
    );
}
