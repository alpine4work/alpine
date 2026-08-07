import {useCallback, useEffect, useRef, useState} from "react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useAlignFontBaselines} from "~/client/web/design/use_align_font_baselines.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {NotionImportProgressBar} from "~/client/web/importers/notion/notion_import_progress_bar.js";
import {NotionImportProgressStore} from "~/client/web/importers/notion/notion_import_progress_store.js";
import {LocalNotionImportItem} from "~/client/web/importers/notion/notion_import_types.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentTimeRoundedToNearestTenMinutes} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useRevalidator} from "~/client/web/remix/use_revalidator.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {fontSizes} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.open_source.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.open_source.js";
import {notionImportFileRetentionDays} from "~/shared/importer/notion/notion_import_file_retention.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";
import {getNotionImport, retryNotionImport} from "~/shared/rpc/notion_import_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type NotionImportItemForCard = Omit<LocalNotionImportItem, "status"> & {
    status: Extract<
        LocalNotionImportItem["status"],
        {type: "Failed" | "Success" | "Processing" | "ProcessQueued"}
    >;
};

export function NotionImportItemCard({
    initialItem,
    startedByAccount,
}: {
    initialItem: NotionImportItemForCard;
    startedByAccount: AccountModel;
}) {
    const appContext = useAppContext();
    const {locale} = useClientInfo();
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const reporter = useReporter();
    const {revalidate} = useRevalidator();

    // Local state for the item - updated via polling
    const [item, setItem] = useState(initialItem);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const consecutivePollingFailuresRef = useRef(0);
    const [isPollingError, setIsPollingError] = useState(false);

    // Update local state when prop changes (e.g., after revalidation)
    useEffect(() => {
        setItem(initialItem);
    }, [initialItem]);

    const [isRetrying, setIsRetrying] = useState(false);

    const accountData = useAccountModel(startedByAccount);
    const isFailed = item.status.type === "Failed";
    const isProcessing = item.status.type === "ProcessQueued" || item.status.type === "Processing";

    // Poll for status updates when processing
    const pollStatus = useCallback(async () => {
        try {
            const {notionImport} = await getNotionImport(appContext, {
                spaceId: space.id,
                notionImportId: item.notionImportId,
            });

            consecutivePollingFailuresRef.current = 0;

            if (!notionImport) {
                // Import was deleted
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                await revalidate();
                return;
            }

            const {status} = notionImport;
            assert(
                status.type === "Success" ||
                    status.type === "Failed" ||
                    status.type === "Processing" ||
                    status.type === "ProcessQueued",
            );

            setItem({
                ...notionImport,
                status,
                notionImportId: item.notionImportId,
            });

            // Stop polling when import reaches a terminal state
            if (notionImport.status.type === "Success" || notionImport.status.type === "Failed") {
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                await revalidate();
            }
        } catch {
            consecutivePollingFailuresRef.current++;
            if (consecutivePollingFailuresRef.current >= 5) {
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                setIsPollingError(true);
            }
        }
    }, [appContext, space.id, item.notionImportId, revalidate]);

    // Start/stop polling based on processing state
    useEffect(() => {
        if (isProcessing && !pollingRef.current) {
            consecutivePollingFailuresRef.current = 0;
            setIsPollingError(false);

            // Poll immediately, then every second
            void pollStatus();
            pollingRef.current = setInterval(() => {
                void pollStatus();
            }, 1000);
        }

        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
        };
    }, [isProcessing, pollStatus]);

    // Check if retry is available (within 7 days)
    const currentTimeRoundedToNearestTenMinutes = useCurrentTimeRoundedToNearestTenMinutes();
    const retentionCutoff = new Date(
        currentTimeRoundedToNearestTenMinutes.getTime() -
            notionImportFileRetentionDays * 24 * 60 * 60 * 1000,
    );
    const canRetry =
        isFailed && item.createdTime >= retentionCutoff && item.teamspaceImportOptions != null;

    const handleRetry = async () => {
        if (!canRetry || isRetrying) return;

        setIsRetrying(true);
        try {
            await retryNotionImport(appContext, {
                spaceId: space.id,
                notionImportId: item.notionImportId,
            });

            // Reset the progress store so the bar starts fresh. The internal
            // ProgressValueStore finalizes at 1 and can't decrease, so we need a new instance.
            progressStoreRef.current = new NotionImportProgressStore(locale);

            await revalidate();
        } catch (error) {
            if (error instanceof ErrorBase) {
                reporter.displayError("Couldn\u2019t retry import", error);
            }
        } finally {
            setIsRetrying(false);
        }
    };

    // Get result data for display
    const result =
        item.status.type === "Success" ||
        item.status.type === "Failed" ||
        item.status.type === "Processing" ||
        item.status.type === "ProcessQueued"
            ? item.status.result
            : null;

    // Smooth progress animation via the progress store.
    const progressStoreRef = useRef<NotionImportProgressStore | null>(null);
    if (!progressStoreRef.current) {
        progressStoreRef.current = new NotionImportProgressStore(locale);
        progressStoreRef.current.update(item);
    }

    useEffect(() => {
        progressStoreRef.current!.update(item);
    }, [item]);

    useEffect(() => {
        if (isPollingError) {
            progressStoreRef.current?.stop();
        }
    }, [isPollingError]);

    const progressEstimate = useStore(progressStoreRef.current.estimate);

    const hasAnyImported =
        result != null &&
        Array.from(result.teamspaces.values()).some(
            ts =>
                ts.documents.imported > 0 ||
                Array.from(ts.files.values()).some(f => f.imported > 0),
        );

    const importedTeamspaces = (item.teamspaceImportOptions ?? []).filter(
        ts => ts.option.type !== "DoNotImport",
    );
    const hideTeamspaceNames =
        importedTeamspaces.length === 1 &&
        importedTeamspaces[0]!.teamspaceName === item.workspaceName;

    return (
        <Box
            padding="6"
            paddingBottom="5"
            boxShadow="elevation-5-with-grey-10-border"
            borderRadius="1.5"
            display="flex"
            flexDirection="column"
            gap="5"
            userSelect="text"
            data-testid={
                process.env.NODE_ENV === "production"
                    ? undefined
                    : `NotionImportItemCard:${item.status.type}`
            }
        >
            {/* Header row - always visible */}
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                marginBottom="-2"
                style={{height: fontSizes["100"].lineHeight}}
            >
                <Box flex="1">
                    {item.workspaceName && (
                        <Box fontSize="100" color="grey-100" fontStyle="semi-bold">
                            {item.workspaceName}
                        </Box>
                    )}
                </Box>
                <Box display="flex" alignItems="flex-end" gap="3">
                    <Box
                        fontSize="50"
                        color="grey-50"
                        style={{marginTop: useAlignFontBaselines("50", "100")}}
                    >
                        {progressEstimate ? (
                            <>
                                {progressEstimate.percentComplete < 100 &&
                                    (hasAnyImported
                                        ? (progressEstimate.timeRemainingDisplay ?? "Importing…")
                                        : "Starting…")}
                                {progressEstimate.percentComplete >= 100 &&
                                    progressEstimate.timeElapsedDisplay && (
                                        <>
                                            {item.status.type === "Failed" ? "Failed" : "Completed"}{" "}
                                            in {progressEstimate.timeElapsedDisplay}
                                        </>
                                    )}
                            </>
                        ) : isProcessing ? (
                            isPollingError ? (
                                "Something went wrong"
                            ) : (
                                "Starting…"
                            )
                        ) : isFailed ? (
                            "Failed"
                        ) : (
                            ""
                        )}
                    </Box>
                    {canRetry && (
                        <Box
                            display="flex"
                            alignItems="center"
                            style={{height: fontSizes["100"].lineHeight}}
                        >
                            <Button
                                height="6"
                                paddingX="2"
                                variant="neutral"
                                isPending={isRetrying}
                                onPress={handleRetry}
                                pressErrorTitle="Couldn&#x2019;t retry import"
                            >
                                Retry
                            </Button>
                        </Box>
                    )}
                </Box>
            </Box>

            {/* Progress bar as divider between header and details */}
            {progressEstimate && (
                <Box>
                    <NotionImportProgressBar
                        percentComplete={progressEstimate.percentComplete}
                        isFailed={isFailed}
                    />
                </Box>
            )}

            {item.status.type === "Failed" && item.status.error && (
                <Box fontSize="75" color="red-70">
                    {item.status.error}
                </Box>
            )}

            {isPollingError && (
                <Box fontSize="75" color="red-70">
                    Something went wrong while checking import progress. The import may still be
                    running. Try refreshing the page.
                </Box>
            )}

            {/* Statistics split by teamspace */}
            {importedTeamspaces.length > 0 && (
                <Box display="flex" flexDirection="column" gap="2.5">
                    {importedTeamspaces.map(ts => (
                        <Box
                            key={ts.teamspaceId}
                            fontSize="75"
                            color="grey-80"
                            data-testid={
                                process.env.NODE_ENV === "production"
                                    ? undefined
                                    : "NotionImportTeamspaceSummary"
                            }
                        >
                            <NotionImportTeamspaceSummary
                                name={hideTeamspaceNames ? undefined : ts.teamspaceName}
                                isPrivate={ts.option.type === "Private"}
                                stats={result?.teamspaces.get(ts.teamspaceId)}
                            />
                        </Box>
                    ))}
                </Box>
            )}
            {accountData && (
                <Box fontSize="50" color="grey-50">
                    Imported by {accountData.name} on{" "}
                    {item.createdTime.toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                    })}
                </Box>
            )}
        </Box>
    );
}

type TeamspaceStats =
    NotionImportProcessingOrDoneResult["teamspaces"] extends ReadonlyMap<string, infer V>
        ? V
        : never;

function NotionImportTeamspaceSummary({
    name,
    isPrivate,
    stats,
}: {
    name: string | undefined;
    isPrivate: boolean;
    stats: TeamspaceStats | undefined;
}) {
    const {locale} = useClientInfo();

    const parts: Array<string> = [];
    if (stats) {
        if (stats.documents.imported > 0) {
            parts.push(printPrettyNumber(locale, stats.documents.imported, "document"));
        }

        let imageCount = 0;
        let videoCount = 0;
        let otherFileCount = 0;

        for (const [contentType, fileStats] of stats.files.entries()) {
            if (contentType.startsWith("image/")) {
                imageCount += fileStats.imported;
            } else if (contentType.startsWith("video/")) {
                videoCount += fileStats.imported;
            } else {
                otherFileCount += fileStats.imported;
            }
        }

        if (imageCount > 0) {
            parts.push(printPrettyNumber(locale, imageCount, "image"));
        }

        if (videoCount > 0) {
            parts.push(printPrettyNumber(locale, videoCount, "video"));
        }

        if (otherFileCount > 0) {
            parts.push(printPrettyNumber(locale, otherFileCount, "file"));
        }
    }

    return (
        <>
            {name && (
                <Box as="span" fontStyle="bold">
                    {isPrivate && (
                        <LockBoldFillIcon
                            size={spacing["3"]}
                            style={{
                                display: "inline",
                                verticalAlign: "middle",
                                marginRight: spacing["1"],
                                marginTop: `-${spacing["0.5"]}`,
                            }}
                        />
                    )}
                    {name}:
                </Box>
            )}
            {parts.length > 0 ? (
                <>
                    {name ? " imported" : "Imported"} {joinPrettyConjunctionList(parts, "and")}
                </>
            ) : (
                <>{name ? " nothing" : "Nothing"} imported</>
            )}
        </>
    );
}
