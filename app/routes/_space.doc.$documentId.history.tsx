import {useEffect, useMemo} from "react";
import {createHeadMetaForDocument} from "~/app/helpers/create_head_meta.js";
import {deserializeDocumentIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceAndSiteDiscovery} from "~/app/helpers/load_with_space_and_site_discovery.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {DocumentHistoryDiffView} from "~/client/web/documents/document_history_diff_view.js";
import {
    DocumentHistoryListView,
    DocumentHistoryListViewSelection,
} from "~/client/web/documents/document_history_list_view.js";
import {DocumentHistorySelection} from "~/client/web/documents/document_history_selection.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {
    documentContentEditorSidebarMaxWidth,
    documentContentEditorSidebarWidth,
} from "~/client/web/styles/document_shared_styles.js";
import {expensivelyGetDocumentHistory} from "~/server/documents/data/expensively_get_document_history.js";
import {getDocumentHistoryDiff} from "~/server/documents/data/get_document_history_diff.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {groupDocumentHistoryTransactions} from "~/shared/documents/document_history_grouping.js";
import {
    DocumentHistoryDiffSchema,
    DocumentHistoryGroup,
    DocumentHistoryGroupSchema,
    DocumentHistoryVersionRange,
    DocumentHistoryVersionRangeSchema,
} from "~/shared/documents/document_history_model.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const DocumentHistoryRouteSelectionSchema = Schema.union({
    None: Schema.object({type: Schema.value("None")}),
    Group: Schema.object({
        type: Schema.value("Group"),
        endVersion: Schema.integer,
        range: DocumentHistoryVersionRangeSchema,
        diff: DocumentHistoryDiffSchema,
    }),
    Entry: Schema.object({
        type: Schema.value("Entry"),
        endVersion: Schema.integer,
        parentGroupEndVersion: Schema.integer,
        range: DocumentHistoryVersionRangeSchema,
        diff: DocumentHistoryDiffSchema,
    }),
});

type DocumentHistoryRouteSelection = SchemaType<typeof DocumentHistoryRouteSelectionSchema>;

const LoaderSchema = Schema.object({
    documentId: Schema.id<DocumentId>(),
    documentTitle: Schema.string,
    groups: Schema.array(DocumentHistoryGroupSchema),
    accounts: Schema.array(AccountModel.schema),
    selection: DocumentHistoryRouteSelectionSchema,
});

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const url = new URL(request.url);
    const version = parseDocumentHistoryVersionSearchParam(url.searchParams.get("version"));
    const isGroupSelection = url.searchParams.has("group");

    const {data1, siteLoaderData} = await loadWithSpaceAndSiteDiscovery(context, {
        request,
        entityId: `Document:${documentId}`,
        load1: async ({onSiteId}) => {
            const history = await expensivelyGetDocumentHistory(context, {
                id: documentId,
                onSiteId,
            });
            const groups = groupDocumentHistoryTransactions(history.transactions);
            const selectedRange = getDocumentHistorySelectedRange({
                groups,
                version,
                isGroupSelection,
            });

            // TODO(#optimize-document-history): Let the paged history list render before
            // loading the default diff, which may reconstruct up to 10,000 document steps.
            const selection: DocumentHistoryRouteSelection =
                selectedRange === null
                    ? {type: "None"}
                    : {
                          ...selectedRange,
                          diff: await getDocumentHistoryDiff(context, {
                              id: documentId,
                              ...selectedRange.range,
                          }),
                      };

            return {documentTitle: history.title, groups, accounts: history.accounts, selection};
        },
        load2: async () => null,
    });

    const {documentTitle, groups, accounts, selection} = data1;
    return jsonWithSchema(
        LoaderSchema,
        {
            documentId,
            documentTitle,
            groups,
            accounts,
            selection,
        },
        {siteLoaderData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {documentTitle}}) =>
    createHeadMetaForDocument({title: `Version history | ${documentTitle}`, openGraph: null}),
);

export default function DocumentHistoryRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const navigate = useRootNavigate();
    const routeLayout = useRouteLayout();

    useEffect(() => {
        if (routeLayout !== "narrow") return;
        // TODO(#narrow-document-history): Support version history on narrow layouts.
        void navigate(`/doc/${loaderData.documentId}`, {replace: true});
    }, [loaderData.documentId, navigate, routeLayout]);

    if (routeLayout === "narrow") return null;

    return <DocumentHistoryRouteWide {...loaderData} />;
}

function DocumentHistoryRouteWide({
    documentId,
    groups,
    accounts,
    selection,
}: SchemaType<typeof LoaderSchema>) {
    const navigate = useRootNavigate();
    const accountById = useMemo(
        () => new Map(accounts.map(account => [account.id, account])),
        [accounts],
    );
    const listSelection = getDocumentHistoryListViewSelection(selection);
    const selectedHistory: DocumentHistorySelection | null =
        selection.type === "None" ? null : selection;
    const noSelectionNavigationBar = useNavigationBar({
        defaultPreviousRoute: `/doc/${documentId}`,
    });
    const noSelectionScrollViewRef = useMergedRefs(
        noSelectionNavigationBar.scrollViewRef,
        useScrollbar({insetTop: noSelectionNavigationBar.scrollbarInsetTop}),
    );
    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "Document", documentId}),
        [documentId],
    );

    return (
        <Box height="full" width="full" minWidth="0" display="flex" backgroundColor="grey-0">
            {selectedHistory ? (
                <Box flexGrow="1" minWidth="0">
                    <ContentBlockWidthContextProvider
                        width="5/8"
                        maxWidth={documentContentEditorSidebarMaxWidth}
                    >
                        <DocumentHistoryDiffView
                            documentId={documentId}
                            selection={selectedHistory}
                            fileAttachmentTarget={fileAttachmentTarget}
                        />
                    </ContentBlockWidthContextProvider>
                </Box>
            ) : (
                <Box
                    ref={noSelectionScrollViewRef}
                    flexGrow="1"
                    minWidth="0"
                    overflowY="auto"
                    position="relative"
                >
                    <Box padding="6" color="grey-60">
                        Select a version to inspect its changes.
                    </Box>
                    {noSelectionNavigationBar.navigationBar}
                </Box>
            )}
            <Box
                flexShrink="0"
                height="full"
                style={{
                    width: `min(${documentContentEditorSidebarWidth}, ${spacing[documentContentEditorSidebarMaxWidth]})`,
                }}
                borderLeft="grey-5"
            >
                <DocumentHistoryListView
                    groups={groups}
                    accountById={accountById}
                    selection={listSelection}
                    onSelectGroup={group => {
                        void navigate(
                            `/doc/${documentId}/history?version=${group.endVersion}&group`,
                        );
                    }}
                    onSelectEntry={entry => {
                        void navigate(`/doc/${documentId}/history?version=${entry.endVersion}`);
                    }}
                    onClose={() => {
                        void navigate(`/doc/${documentId}`);
                    }}
                />
            </Box>
        </Box>
    );
}

function parseDocumentHistoryVersionSearchParam(version: string | null): number | null {
    if (version === null) return null;
    if (!/^(0|[1-9][0-9]*)$/.test(version)) {
        throw createDocumentHistoryVersionNotFoundError();
    }

    const parsedVersion = Number(version);
    if (!Number.isSafeInteger(parsedVersion)) {
        throw createDocumentHistoryVersionNotFoundError();
    }
    return parsedVersion;
}

function getDocumentHistorySelectedRange({
    groups,
    version,
    isGroupSelection,
}: {
    groups: ReadonlyArray<DocumentHistoryGroup>;
    version: number | null;
    isGroupSelection: boolean;
}):
    | {
          readonly type: "Group";
          readonly endVersion: number;
          readonly range: DocumentHistoryVersionRange;
      }
    | {
          readonly type: "Entry";
          readonly endVersion: number;
          readonly parentGroupEndVersion: number;
          readonly range: DocumentHistoryVersionRange;
      }
    | null {
    if (version === null) {
        const firstGroup = groups[0];
        if (!firstGroup) return null;

        return {
            type: "Group",
            endVersion: firstGroup.endVersion,
            range: {
                startVersion: firstGroup.startVersion,
                endVersion: firstGroup.endVersion,
            },
        };
    }

    if (isGroupSelection) {
        const group = findDocumentHistoryItemAtVersion(groups, version);
        if (!group) throw createDocumentHistoryVersionNotFoundError();
        return {
            type: "Group",
            endVersion: group.endVersion,
            range: {startVersion: group.startVersion, endVersion: group.endVersion},
        };
    }

    const entry = findDocumentHistoryEntryAtVersion(groups, version);
    if (entry) {
        return {
            type: "Entry",
            endVersion: entry.endVersion,
            parentGroupEndVersion: entry.parentGroupEndVersion,
            range: {startVersion: entry.startVersion, endVersion: entry.endVersion},
        };
    }

    throw createDocumentHistoryVersionNotFoundError();
}

function createDocumentHistoryVersionNotFoundError() {
    return new NotFoundError("Document history version not found", {
        displayMessage: errorDisplayMessage`This document version doesn\u2019t exist.`,
    });
}

type DocumentHistoryEntryWithParentGroup = DocumentHistoryGroup["entries"][number] & {
    readonly parentGroupEndVersion: number;
};

function findDocumentHistoryEntryAtVersion(
    groups: ReadonlyArray<DocumentHistoryGroup>,
    version: number,
): DocumentHistoryEntryWithParentGroup | undefined {
    const entries = groups.flatMap(group =>
        group.entries.map(
            (entry): DocumentHistoryEntryWithParentGroup => ({
                ...entry,
                parentGroupEndVersion: group.endVersion,
            }),
        ),
    );
    return findDocumentHistoryItemAtVersion(entries, version);
}

function findDocumentHistoryItemAtVersion<Item extends DocumentHistoryVersionRange>(
    items: ReadonlyArray<Item>,
    version: number,
): Item | undefined {
    return (
        // Adjacent ranges share a boundary: the earlier range ends at the version where
        // the following range starts. A selected version identifies a document state, so
        // prefer the range which ends at that state over the subsequent change that starts
        // there.
        items.find(item => item.endVersion === version) ??
        items.find(item => item.startVersion < version && version < item.endVersion) ??
        items.find(item => item.startVersion === version)
    );
}

function getDocumentHistoryListViewSelection(
    selection: DocumentHistoryRouteSelection,
): DocumentHistoryListViewSelection {
    switch (selection.type) {
        case "None":
            return selection;
        case "Group":
            return {type: selection.type, endVersion: selection.endVersion};
        case "Entry":
            return {
                type: selection.type,
                endVersion: selection.endVersion,
                parentGroupEndVersion: selection.parentGroupEndVersion,
            };
        default:
            throw exhaustive(selection);
    }
}
