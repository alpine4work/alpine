import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createHeadMetaForDocument} from "~/app/helpers/create_head_meta.js";
import {
    deserializeDocumentIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
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
import {useFetcherWithSchema} from "~/client/web/remix/use_fetcher_with_schema.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {
    documentContentEditorSidebarMaxWidth,
    documentContentEditorSidebarWidth,
} from "~/client/web/styles/document_shared_styles.js";
import {getDocumentWithOptionalCommentsIfExists} from "~/server/documents/data/documents_actions.js";
import {expensivelyGetDocumentHistory} from "~/server/documents/data/expensively_get_document_history.js";
import {getDocumentHistoryDiff} from "~/server/documents/data/get_document_history_diff.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {createEmptyDocumentContent} from "~/shared/documents/document_content_schema.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {groupDocumentHistoryTransactions} from "~/shared/documents/document_history_grouping.js";
import {
    DocumentHistoryAuthor,
    DocumentHistoryDiffForRangeSchema,
    DocumentHistoryDiffSchema,
    DocumentHistoryGroup,
    DocumentHistoryGroupSchema,
    DocumentHistoryVersionRange,
    DocumentHistoryVersionRangeSchema,
} from "~/shared/documents/document_history_model.js";
import {
    DocumentHistorySelectedRange,
    getDocumentHistorySelectedRange,
} from "~/shared/documents/document_history_selected_range.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
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
        showInitialContentAsAdditions: Schema.boolean,
        diff: DocumentHistoryDiffSchema,
    }),
    Entry: Schema.object({
        type: Schema.value("Entry"),
        endVersion: Schema.integer,
        parentGroupEndVersion: Schema.integer,
        range: DocumentHistoryVersionRangeSchema,
        showInitialContentAsAdditions: Schema.boolean,
        diff: DocumentHistoryDiffSchema,
    }),
});

type DocumentHistoryRouteSelection = SchemaType<typeof DocumentHistoryRouteSelectionSchema>;
type DocumentHistoryRouteSelectedHistory = Exclude<DocumentHistoryRouteSelection, {type: "None"}>;

const LoaderSchema = Schema.object({
    documentId: Schema.id<DocumentId>(),
    documentTitle: Schema.string,
    groups: Schema.array(DocumentHistoryGroupSchema),
    accounts: Schema.array(AccountModel.schema),
    initialVersionCreatedTime: Schema.date.nullable(),
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
            const document = await getDocumentWithOptionalCommentsIfExists(context, documentId, {
                onSiteId,
            });

            if (!document) {
                const createSearchParam = url.searchParams.get("create");
                if (createSearchParam === null) throw createDocumentNotFoundError(documentId);

                const spaceId = deserializeSpaceIdForLoader(createSearchParam);
                context.discovery.discoverSpaceId(spaceId, "CreateSearchParam");
                const sessionContext = context.actor.authorizeSession();
                const accountId = sessionContext.actor.getAccountId();
                const content = createEmptyDocumentContent(accountId);
                const initialVersionCreatedTime = new Date();

                const groups = [
                    createInitialDocumentHistoryGroup({
                        createdTime: initialVersionCreatedTime,
                        author: {id: accountId, from: null},
                    }),
                ];

                const selectedRange = getDocumentHistorySelectedRange({
                    groups,
                    version,
                    isGroupSelection,
                    initialVersionCreatedTime,
                });
                if (version !== null && selectedRange === null) {
                    throw createDocumentHistoryVersionNotFoundError();
                }

                const selection: DocumentHistoryRouteSelection =
                    selectedRange === null
                        ? {type: "None"}
                        : {
                              ...selectedRange,
                              diff: {
                                  startContent: content,
                                  steps: [],
                                  contentReferences: emptyDocumentContentReferences,
                              },
                          };

                return {
                    documentTitle: getDocumentContentTitle(content),
                    groups,
                    accounts: [await getAccount(sessionContext, spaceId, accountId)],
                    initialVersionCreatedTime,
                    selection,
                };
            }

            const history = await expensivelyGetDocumentHistory(context, {
                id: documentId,
                onSiteId,
            });

            const groups = groupDocumentHistoryTransactions([
                ...(history.initialVersion
                    ? [
                          {
                              startVersion: 0,
                              endVersion: 0,
                              createdTime: history.initialVersion.createdTime,
                              author: history.initialVersion.author,
                          },
                      ]
                    : []),
                ...history.transactions,
            ]);

            const selectedRange = getDocumentHistorySelectedRange({
                groups,
                version,
                isGroupSelection,
                initialVersionCreatedTime: history.initialVersion?.createdTime ?? null,
            });
            if (version !== null && selectedRange === null) {
                throw createDocumentHistoryVersionNotFoundError();
            }

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
                              showInitialContentAsAdditions:
                                  selectedRange.showInitialContentAsAdditions,
                          }),
                      };

            return {
                documentTitle: history.title,
                groups,
                accounts: history.accounts,
                initialVersionCreatedTime: history.initialVersion?.createdTime ?? null,
                selection,
            };
        },
        load2: async () => null,
    });

    const {documentTitle, groups, accounts, initialVersionCreatedTime, selection} = data1;
    return jsonWithSchema(
        LoaderSchema,
        {
            documentId,
            documentTitle,
            groups,
            accounts,
            initialVersionCreatedTime,
            selection,
        },
        {siteLoaderData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {documentTitle}}) =>
    createHeadMetaForDocument({title: `Version history | ${documentTitle}`, openGraph: null}),
);

// A selected version changes only the diff. Keep the loaded history and its
// mounted sidebar while the fetcher loads that diff separately.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: originalCurrentUrl,
    nextUrl: originalNextUrl,
}) => {
    const currentUrl = new URL(originalCurrentUrl);
    const nextUrl = new URL(originalNextUrl);

    currentUrl.searchParams.delete("version");
    currentUrl.searchParams.delete("group");
    nextUrl.searchParams.delete("version");
    nextUrl.searchParams.delete("group");

    return currentUrl.toString() !== nextUrl.toString();
};

export default function DocumentHistoryRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const navigate = useRootNavigate();
    const routeLayout = useRouteLayout();
    const [searchParams] = useSearchParams();
    const createSearchParam = searchParams.get("create");

    useEffect(() => {
        if (routeLayout !== "narrow") return;
        // TODO(#narrow-document-history): Support version history on narrow layouts.
        void navigate(
            appendDocumentCreateSearchParam(`/doc/${loaderData.documentId}`, createSearchParam),
            {replace: true},
        );
    }, [createSearchParam, loaderData.documentId, navigate, routeLayout]);

    if (routeLayout === "narrow") return null;

    return <DocumentHistoryRouteWide {...loaderData} createSearchParam={createSearchParam} />;
}

function DocumentHistoryRouteWide({
    documentId,
    groups,
    accounts,
    initialVersionCreatedTime,
    selection,
    createSearchParam,
}: SchemaType<typeof LoaderSchema> & {readonly createSearchParam: string | null}) {
    const navigate = useRootNavigate();
    const [searchParams] = useSearchParams();
    const diffFetcher = useFetcherWithSchema(DocumentHistoryDiffForRangeSchema);
    const lastRequestedDiffUrlRef = useRef<string | null>(null);
    const accountById = useMemo(
        () => new Map(accounts.map(account => [account.id, account])),
        [accounts],
    );

    const version = parseDocumentHistoryVersionSearchParam(searchParams.get("version"));
    const isGroupSelection = searchParams.has("group");
    const selectedRange = useMemo(
        () =>
            getDocumentHistorySelectedRange({
                groups,
                version,
                isGroupSelection,
                initialVersionCreatedTime,
            }),
        [groups, initialVersionCreatedTime, isGroupSelection, version],
    );

    if (version !== null && selectedRange === null) {
        throw createDocumentHistoryVersionNotFoundError();
    }

    const listSelection = getDocumentHistoryListViewSelection(selectedRange);
    const initialSelectedHistory = selection.type === "None" ? null : selection;

    const selectedHistory = useMemo(
        () =>
            getDocumentHistorySelectedHistory({
                selectedRange,
                initialSelectedHistory,
                fetchedDiff: diffFetcher.data,
            }),
        [diffFetcher.data, initialSelectedHistory, selectedRange],
    );

    const [lastSelectedHistory, setLastSelectedHistory] = useState<DocumentHistorySelection | null>(
        initialSelectedHistory,
    );

    useEffect(() => {
        if (selectedHistory === null) return;

        setLastSelectedHistory(previous =>
            previous &&
            previous.diff === selectedHistory.diff &&
            documentHistoryRangesAreEqual(previous.range, selectedHistory.range)
                ? previous
                : selectedHistory,
        );
    }, [selectedHistory]);

    const displayedHistory =
        selectedRange === null ? null : (selectedHistory ?? lastSelectedHistory);
    const diffUrl = selectedRange ? getDocumentHistoryDiffUrl({documentId, selectedRange}) : null;

    useEffect(() => {
        if (!diffUrl || selectedHistory) return;
        if (lastRequestedDiffUrlRef.current === diffUrl) return;

        lastRequestedDiffUrlRef.current = diffUrl;
        diffFetcher.load(diffUrl);
    }, [diffFetcher, diffUrl, selectedHistory]);

    const noSelectionNavigationBar = useNavigationBar({
        defaultPreviousRoute: appendDocumentCreateSearchParam(
            `/doc/${documentId}`,
            createSearchParam,
        ),
    });
    const noSelectionScrollViewRef = useMergedRefs(
        noSelectionNavigationBar.scrollViewRef,
        useScrollbar({insetTop: noSelectionNavigationBar.scrollbarInsetTop}),
    );
    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "Document", documentId}),
        [documentId],
    );

    const selectEntry = useCallback(
        (entry: DocumentHistoryVersionRange, isGroup = false) => {
            void navigate(
                appendDocumentCreateSearchParam(
                    `/doc/${documentId}/history?version=${entry.endVersion}${isGroup ? "&group" : ""}`,
                    createSearchParam,
                ),
            );
        },
        [createSearchParam, documentId, navigate],
    );

    const close = useCallback(() => {
        void navigate(appendDocumentCreateSearchParam(`/doc/${documentId}`, createSearchParam));
    }, [createSearchParam, documentId, navigate]);

    return (
        <Box height="full" width="full" minWidth="0" display="flex" backgroundColor="grey-0">
            {displayedHistory ? (
                <Box flexGrow="1" minWidth="0">
                    <ContentBlockWidthContextProvider
                        width="5/8"
                        maxWidth={documentContentEditorSidebarMaxWidth}
                    >
                        <DocumentHistoryDiffView
                            documentId={documentId}
                            selection={displayedHistory}
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
                    onSelectGroup={group => selectEntry(group, true)}
                    onSelectEntry={selectEntry}
                    onClose={close}
                />
            </Box>
        </Box>
    );
}

function appendDocumentCreateSearchParam(url: string, createSearchParam: string | null) {
    if (createSearchParam === null) return url;
    return `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams({create: createSearchParam})}`;
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

function createInitialDocumentHistoryGroup({
    createdTime,
    author,
}: {
    createdTime: Date;
    author: DocumentHistoryAuthor;
}): DocumentHistoryGroup {
    return {
        startVersion: 0,
        endVersion: 0,
        startTime: createdTime,
        endTime: createdTime,
        contributors: [author],
        entries: [
            {
                startVersion: 0,
                endVersion: 0,
                startTime: createdTime,
                endTime: createdTime,
                contributors: [author],
            },
        ],
    };
}

function createDocumentHistoryVersionNotFoundError() {
    return new NotFoundError("Document history version not found", {
        displayMessage: errorDisplayMessage`This document version doesn\u2019t exist.`,
    });
}

function getDocumentHistoryListViewSelection(
    selection: DocumentHistorySelectedRange | null,
): DocumentHistoryListViewSelection {
    if (selection === null) return {type: "None"};

    switch (selection.type) {
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

function getDocumentHistorySelectedHistory({
    selectedRange,
    initialSelectedHistory,
    fetchedDiff,
}: {
    selectedRange: DocumentHistorySelectedRange | null;
    initialSelectedHistory: DocumentHistoryRouteSelectedHistory | null;
    fetchedDiff: SchemaType<typeof DocumentHistoryDiffForRangeSchema> | undefined;
}): DocumentHistorySelection | null {
    if (selectedRange === null) return null;

    if (
        initialSelectedHistory &&
        documentHistoryDiffRequestsAreEqual(initialSelectedHistory, selectedRange)
    ) {
        return {range: selectedRange.range, diff: initialSelectedHistory.diff};
    }

    if (fetchedDiff && documentHistoryDiffRequestsAreEqual(fetchedDiff, selectedRange)) {
        return {range: selectedRange.range, diff: fetchedDiff.diff};
    }

    return null;
}

function getDocumentHistoryDiffUrl({
    documentId,
    selectedRange,
}: {
    documentId: DocumentId;
    selectedRange: DocumentHistorySelectedRange;
}): string {
    const searchParams = new URLSearchParams({
        startVersion: selectedRange.range.startVersion.toString(),
        endVersion: selectedRange.range.endVersion.toString(),
    });
    if (selectedRange.showInitialContentAsAdditions) {
        searchParams.set("showInitialContentAsAdditions", "true");
    }
    return `/doc/${documentId}/history/diff?${searchParams}`;
}

function documentHistoryDiffRequestsAreEqual(
    request1: {
        readonly range: DocumentHistoryVersionRange;
        readonly showInitialContentAsAdditions: boolean;
    },
    request2: {
        readonly range: DocumentHistoryVersionRange;
        readonly showInitialContentAsAdditions: boolean;
    },
): boolean {
    return (
        request1.range.startVersion === request2.range.startVersion &&
        request1.range.endVersion === request2.range.endVersion &&
        request1.showInitialContentAsAdditions === request2.showInitialContentAsAdditions
    );
}

function documentHistoryRangesAreEqual(
    range1: DocumentHistoryVersionRange,
    range2: DocumentHistoryVersionRange,
): boolean {
    return range1.startVersion === range2.startVersion && range1.endVersion === range2.endVersion;
}
