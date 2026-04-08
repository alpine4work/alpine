import {getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import {SpinnerGap} from "phosphor-react";
import {useCallback, useEffect, useReducer, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {
    notionImportInitialState,
    notionImportReducer,
    selectedFileNameForPhase,
    teamspaceOptionsForPhase,
} from "~/client/web/importers/notion/notion_import_reducer.js";
import {NotionImportTeamspaceOptions} from "~/client/web/importers/notion/notion_import_teamspace_options.js";
import {LocalNotionImportItem} from "~/client/web/importers/notion/notion_import_types.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRevalidator} from "~/client/web/remix/use_revalidator.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {ErrorBase, UnknownError} from "~/shared/error/error.js";
import {importMultipartUploadPartSize} from "~/shared/files/file_constants.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {
    cancelNotionImport,
    createNotionImport,
    finishedNotionImportUpload,
    getNotionImport,
    startNotionImport,
} from "~/shared/rpc/notion_import_rpc_definitions.js";

export function NotionImportUploadSection({
    activeImportFromLoader,
}: {
    activeImportFromLoader: LocalNotionImportItem | null;
}) {
    const appContext = useAppContext();
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const reporter = useReporter();
    const {revalidate} = useRevalidator();

    const [state, dispatch] = useReducer(notionImportReducer, notionImportInitialState);

    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const consecutivePollingFailuresRef = useRef(0);
    const [isPollingError, setIsPollingError] = useState(false);

    // Tracks the in-flight upload before the server has acknowledged it and polling
    // begins. Once polling starts, `activeImport` (derived from reducer state or the
    // loader) takes over as the source of truth. Also serves as a guard against
    // duplicate upload requests (non-null means in-flight).
    const activeNotionImportUploadRef = useRef<{
        xhrRequests: Array<XMLHttpRequest>;
        id: NotionImportId;
    } | null>(null);

    const activeImport = state.currentImport ?? activeImportFromLoader;

    // Derive values from state
    const isUploading = state.phase.type === "Uploading";
    const uploadProgress = state.phase.type === "Uploading" ? state.phase.progress : 0;
    const isStartingImport = state.phase.type === "Starting";
    const isCanceling = state.phase.type === "Canceling";
    const selectedFileName = selectedFileNameForPhase(state.phase);
    const teamspaceImportOptions = teamspaceOptionsForPhase(state.phase);

    // Block browser navigation while uploading
    useEffect(() => {
        if (!isUploading) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [isUploading]);

    // Poll for validation status
    const pollValidationStatus = useCallback(
        async (notionImportId: NotionImportId) => {
            try {
                const {notionImport} = await getNotionImport(appContext, {
                    spaceId: space.id,
                    notionImportId,
                });

                consecutivePollingFailuresRef.current = 0;

                if (!notionImport) {
                    dispatch({type: "PollingNotFound"});
                    return;
                }

                dispatch({
                    type: "PollingUpdate",
                    notionImport: {...notionImport, notionImportId},
                });

                // Stop polling when validated or terminal
                if (
                    notionImport.status.type === "Success" ||
                    notionImport.status.type === "Failed" ||
                    notionImport.status.type === "Validated" ||
                    notionImport.status.type === "ProcessQueued" ||
                    notionImport.status.type === "Processing"
                ) {
                    if (pollingRef.current) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }

                    if (
                        notionImport.status.type === "Success" ||
                        notionImport.status.type === "Failed"
                    ) {
                        await revalidate();
                    }
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
        },
        [appContext, space.id, revalidate],
    );

    const startPolling = useCallback(
        (notionImportId: NotionImportId) => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }

            consecutivePollingFailuresRef.current = 0;
            setIsPollingError(false);

            void pollValidationStatus(notionImportId);

            pollingRef.current = setInterval(() => {
                void pollValidationStatus(notionImportId);
            }, 1000);
        },
        [pollValidationStatus],
    );

    // Clean up polling on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, []);

    // Resume dialog for validated imports on mount only. We use a ref to avoid
    // re-opening the dialog after the user has closed it.
    const hasResumedRef = useRef(false);
    useEffect(() => {
        if (hasResumedRef.current) return;
        if (!activeImportFromLoader || state.currentImport) return;

        hasResumedRef.current = true;

        if (activeImportFromLoader.status.type === "Validated") {
            dispatch({
                type: "ResumeValidated",
                rawTeamspaceOptions: activeImportFromLoader.teamspaceImportOptions,
            });
        } else if (
            activeImportFromLoader.status.type === "UploadPending" ||
            activeImportFromLoader.status.type === "ValidateQueued" ||
            activeImportFromLoader.status.type === "Validating"
        ) {
            // Resume polling for validation
            startPolling(activeImportFromLoader.notionImportId);
        }
        // Processing state is handled by the card's own polling
    }, [activeImportFromLoader, state.currentImport, startPolling]);

    const handleFileSelect = useCallback(
        async (file: File) => {
            if (activeNotionImportUploadRef.current) return;

            setIsPollingError(false);
            consecutivePollingFailuresRef.current = 0;
            dispatch({type: "StartUpload", fileName: file.name});

            try {
                const {notionImportId, uploadId, partUploadUrls} = await createNotionImport(
                    appContext,
                    {
                        spaceId: space.id,
                        fileName: file.name,
                        contentType: file.type || "application/zip",
                        contentLength: file.size,
                    },
                );

                activeNotionImportUploadRef.current = {xhrRequests: [], id: notionImportId};

                // Upload file in chunks using S3 multipart upload. Each part is 100 MB
                // (`importMultipartUploadPartSize`). We use XHR instead of fetch so we can track
                // per-part upload progress via the `xhr.upload.progress` event.
                const partSize = importMultipartUploadPartSize;
                const completedParts: Array<{partNumber: number; etag: string}> = [];

                // Track bytes uploaded per part so we can compute total progress across all
                // concurrent uploads.
                const partProgress = new Map<number, number>();

                const updateTotalProgress = () => {
                    let totalLoaded = 0;
                    for (const loaded of partProgress.values()) {
                        totalLoaded += loaded;
                    }
                    dispatch({
                        type: "UpdateUploadProgress",
                        progress: Math.min(totalLoaded / file.size, 1),
                    });
                };

                // Simple semaphore to limit concurrent part uploads. We upload up to 3 parts at a
                // time to balance throughput against memory usage (each in-flight part holds up to
                // 100 MB in memory).
                let activeCount = 0;
                const maxConcurrent = 3;
                const queue = [...partUploadUrls];
                const errors: Array<Error> = [];

                await new Promise<void>((resolve, reject) => {
                    // Recursively starts the next part upload. Called once initially and then again
                    // each time a part completes, creating a self-draining queue.
                    function startNext() {
                        // Stop starting new uploads if any part has failed.
                        if (errors.length > 0) return;

                        // All parts uploaded and all XHRs have returned.
                        if (queue.length === 0 && activeCount === 0) {
                            resolve();
                            return;
                        }

                        // Fill up to maxConcurrent active uploads.
                        while (activeCount < maxConcurrent && queue.length > 0) {
                            const part = queue.shift()!;
                            activeCount++;

                            // Slice the file into the byte range for this part. Part numbers are 1-based (S3
                            // convention).
                            const start = (part.partNumber - 1) * partSize;
                            const end = Math.min(start + partSize, file.size);
                            const blob = file.slice(start, end);

                            const xhr = new XMLHttpRequest();
                            activeNotionImportUploadRef.current?.xhrRequests.push(xhr);

                            xhr.upload.addEventListener("progress", event => {
                                if (event.lengthComputable) {
                                    partProgress.set(part.partNumber, event.loaded);
                                    updateTotalProgress();
                                }
                            });

                            xhr.addEventListener("load", () => {
                                if (xhr.status >= 200 && xhr.status < 300) {
                                    // S3 returns an ETag header for each uploaded part. We need to collect these and
                                    // send them to CompleteMultipartUpload.
                                    const etag = xhr.getResponseHeader("ETag");
                                    if (!etag) {
                                        errors.push(
                                            new UnknownError(
                                                `Missing ETag for part ${part.partNumber}`,
                                            ),
                                        );
                                        reject(errors[0]);
                                        return;
                                    }

                                    // Mark this part's progress as fully complete.
                                    partProgress.set(part.partNumber, end - start);
                                    completedParts.push({
                                        partNumber: part.partNumber,
                                        etag,
                                    });

                                    updateTotalProgress();
                                } else {
                                    errors.push(
                                        new UnknownError(
                                            `Part ${part.partNumber} upload failed with status ${xhr.status}`,
                                        ),
                                    );

                                    reject(errors[0]);
                                    return;
                                }

                                activeCount--;
                                startNext();
                            });

                            xhr.addEventListener("error", () => {
                                errors.push(
                                    new UnknownError(
                                        `Part ${part.partNumber} upload network request failed`,
                                    ),
                                );
                                reject(errors[0]);
                            });

                            xhr.open("PUT", part.presignedUrl, true);
                            xhr.send(blob);
                        }
                    }

                    startNext();
                });

                // S3 CompleteMultipartUpload requires parts in order.
                completedParts.sort((a, b) => a.partNumber - b.partNumber);

                // Tell the server to assemble the parts into the final S3 object and transition
                // the import to validation.
                await finishedNotionImportUpload(appContext, {
                    spaceId: space.id,
                    notionImportId,
                    uploadId,
                    parts: completedParts,
                });

                dispatch({type: "UploadComplete"});
                startPolling(notionImportId);
            } catch (error) {
                dispatch({type: "UploadFailed"});
                if (error instanceof ErrorBase) {
                    reporter.displayError("Couldn\u2019t upload file", error);
                }
            } finally {
                activeNotionImportUploadRef.current = null;
            }
        },
        [appContext, reporter, space.id, startPolling],
    );

    const handleStartImport = async () => {
        if (!activeImport || activeImport.status.type !== "Validated" || isStartingImport) return;
        if (!teamspaceImportOptions) return;

        dispatch({type: "BeginStartImport"});

        try {
            const teamspaceOptionsArray = assertExists(activeImport.teamspaceImportOptions).map(
                ts => ({
                    teamspaceId: ts.teamspaceId,
                    teamspaceName: ts.teamspaceName,
                    option: teamspaceImportOptions.get(ts.teamspaceId) ?? {
                        type: "Public" as const,
                    },
                }),
            );

            await startNotionImport(appContext, {
                spaceId: space.id,
                notionImportId: activeImport.notionImportId,
                teamspaceImportOptions: teamspaceOptionsArray,
            });

            dispatch({type: "ImportStarted"});
            await revalidate();
        } catch (error) {
            dispatch({type: "StartImportFailed"});
            if (error instanceof ErrorBase) {
                reporter.displayError("Couldn\u2019t start import", error);
            }
        }
    };

    const makeCancelImportNetworkRequest = async (notionImportId: NotionImportId) => {
        if (isCanceling) return;

        try {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }

            await cancelNotionImport(appContext, {
                spaceId: space.id,
                notionImportId,
            });

            dispatch({type: "CancelComplete"});
            await revalidate();
        } catch (error) {
            dispatch({type: "CancelFailed"});
            if (error instanceof ErrorBase) {
                reporter.displayError("Couldn\u2019t cancel import", error);
            }
        } finally {
            activeNotionImportUploadRef.current = null;
        }
    };

    const handleCancelImport = async () => {
        if (!activeImport || isCanceling) return;

        const isCancellable =
            activeImport.status.type === "UploadPending" ||
            activeImport.status.type === "ValidateQueued" ||
            activeImport.status.type === "Validating" ||
            activeImport.status.type === "Validated";

        if (!isCancellable) return;

        dispatch({type: "BeginCancel"});

        await makeCancelImportNetworkRequest(activeImport.notionImportId);
    };

    const handleCancelUploadOrValidation = async () => {
        if (isCanceling) return;

        // If we have an activeImport, use the standard cancel path.
        if (activeImport) {
            await handleCancelImport();
            return;
        }

        // During upload before polling has started, cancel using the ref-tracked import ID
        // and abort in-flight XHRs.
        const activeUpload = activeNotionImportUploadRef.current;
        if (!activeUpload) return;

        dispatch({type: "BeginCancel"});

        for (const xhr of activeUpload.xhrRequests) {
            xhr.abort();
        }

        await makeCancelImportNetworkRequest(activeUpload.id);
    };

    // Show the upload box when there's no active import, OR when validating
    const isValidating =
        (activeImport != null &&
            (activeImport.status.type === "UploadPending" ||
                activeImport.status.type === "ValidateQueued" ||
                activeImport.status.type === "Validating")) ||
        // Or when we have a selected file but no active import yet (just uploaded)
        (selectedFileName != null && !activeImport);
    const showUploadBox = !activeImport || isValidating || activeImport.status.type !== "Validated";

    // Upload box - shown when no active import, uploading, or validating
    if (showUploadBox) {
        return (
            <NotionImportUploadBox
                isDisabled={!!activeImport}
                isUploading={isUploading}
                isValidating={isValidating}
                isCanceling={isCanceling}
                isPollingError={isPollingError}
                selectedFileName={selectedFileName}
                uploadProgress={uploadProgress}
                onFileSelect={handleFileSelect}
                onCancel={handleCancelUploadOrValidation}
            />
        );
    }

    const showTeamspaceOptions =
        activeImport.status.type === "Validated" && activeImport.teamspaceImportOptions;

    return (
        <>
            {/* Teamspace import choices - shown when validated */}
            {showTeamspaceOptions && (
                <NotionImportTeamspaceOptions
                    workspaceName={assertExists(activeImport.workspaceName)}
                    teamspaces={activeImport.teamspaceImportOptions.map(ts => ({
                        id: ts.teamspaceId,
                        name: ts.teamspaceName,
                    }))}
                    options={teamspaceImportOptions}
                    onChange={options => dispatch({type: "UpdateTeamspaceOptions", options})}
                />
            )}

            {/* Action buttons - shown when validated */}
            {activeImport?.status.type === "Validated" && (
                <>
                    <Box
                        display="flex"
                        alignItems="center"
                        justifyContent="flex-end"
                        gap="3"
                        paddingTop="4"
                    >
                        <Button
                            fontSize="100"
                            height="9"
                            paddingX="3"
                            variant="outline"
                            color="grey-60"
                            isPending={isCanceling}
                            pressErrorTitle="Couldn&#x2019;t cancel import"
                            onPress={async () => {
                                if (isStartingImport) return;
                                await handleCancelImport();
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            fontSize="100"
                            height="9"
                            paddingX="3"
                            variant="accent"
                            isDisabled={
                                teamspaceImportOptions != null &&
                                [...teamspaceImportOptions.values()].every(
                                    v => v.type === "DoNotImport",
                                )
                            }
                            isPending={isStartingImport}
                            pressErrorTitle="Couldn&#x2019;t start import"
                            onPress={async () => {
                                if (isCanceling) return;
                                await handleStartImport();
                            }}
                        >
                            Start import
                        </Button>
                    </Box>
                </>
            )}
        </>
    );
}

function NotionImportUploadBox({
    isDisabled: isDisabledFromProps,
    isUploading,
    isValidating,
    isCanceling,
    isPollingError,
    selectedFileName,
    uploadProgress,
    onFileSelect,
    onCancel,
}: {
    isDisabled: boolean;
    isUploading: boolean;
    isValidating: boolean;
    isCanceling: boolean;
    isPollingError: boolean;
    selectedFileName: string | null;
    uploadProgress: number;
    onFileSelect: (file: File) => void | Promise<void>;
    onCancel: () => void | Promise<void>;
}) {
    const platform = usePlatform();

    const isDisabled = (isDisabledFromProps || isUploading || isValidating) && !isPollingError;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const isHighlighted = isDragging || isPressed;

    const triggerFileInput = useCallback(() => {
        const fileInputElement = fileInputRef.current;
        if (!fileInputElement) return;

        const interactionModality = getInteractionModality();
        fileInputElement.focus();
        fileInputElement.click();
        setInteractionModality(interactionModality);
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
            dragCounterRef.current = 0;

            const file = e.dataTransfer.files[0];
            if (file) {
                if (file.name.endsWith(".zip") || file.type === "application/zip") {
                    await onFileSelect(file);
                }
            }
        },
        [onFileSelect],
    );

    return (
        <Box flex="1" display="flex" flexDirection="column">
            <input
                type="file"
                accept=".zip"
                ref={fileInputRef}
                style={{
                    position: "fixed",
                    width: 0,
                    height: 0,
                    margin: 0,
                    padding: 0,
                    border: 0,
                    opacity: 0,
                    top: 0,
                }}
                disabled={isDisabled}
                aria-label="Select Notion export file"
                autoComplete="off"
                onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) {
                        // Void because we're using a native input here. We handle errors in the
                        // onFileSelect callback.
                        void onFileSelect(file);
                    }
                }}
            />

            <FocusRing>
                <Box
                    tabIndex={0}
                    role="button"
                    aria-label={selectedFileName ? `Selected: ${selectedFileName}` : "Select file"}
                    onClick={isDisabled ? undefined : triggerFileInput}
                    onMouseDown={isDisabled ? undefined : () => setIsPressed(true)}
                    onMouseUp={isDisabled ? undefined : () => setIsPressed(false)}
                    onMouseLeave={isDisabled ? undefined : () => setIsPressed(false)}
                    onKeyDown={
                        isDisabled
                            ? undefined
                            : event => {
                                  if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      triggerFileInput();
                                  }
                              }
                    }
                    onDragEnter={isDisabled ? undefined : handleDragEnter}
                    onDragLeave={isDisabled ? undefined : handleDragLeave}
                    onDragOver={isDisabled ? undefined : handleDragOver}
                    onDrop={
                        isDisabled
                            ? undefined
                            : event => {
                                  // We handle async + errors in the onFileSelect callback.
                                  void handleDrop(event);
                              }
                    }
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    justifyContent="center"
                    padding="6"
                    backgroundColor={isHighlighted ? "grey-5" : "grey-1"}
                    borderRadius="1.5"
                    cursor={isDisabled ? "default" : "pointer"}
                    flex="1"
                    style={{
                        minHeight: spacing["48"],
                        border: `1px dashed ${isHighlighted ? colorSchemeVars["grey-20"] : colorSchemeVars["grey-10"]}`,
                    }}
                >
                    {isUploading ? (
                        <>
                            <SpinnerGap
                                size={spacing["6"]}
                                className={`${sprinkles({color: "grey-50"})} ${spinAnimationClassName}`}
                            />
                            <Spacer space="2" />
                            <Box fontSize="75" color="grey-80">
                                Uploading {selectedFileName}…
                            </Box>
                            <Spacer space="1" />
                            <Box
                                fontSize="75"
                                color="grey-50"
                                style={{fontVariantNumeric: "tabular-nums"}}
                            >
                                {Math.min(99, Math.round(uploadProgress * 100))}%
                            </Box>
                            <Spacer space="5" />
                            <Button
                                fontSize="75"
                                height="7"
                                paddingX="3"
                                variant="outline"
                                color="grey-60"
                                isPending={isCanceling}
                                pressErrorTitle="Couldn&#x2019;t cancel upload"
                                onPress={onCancel}
                            >
                                Cancel
                            </Button>
                        </>
                    ) : isValidating && !isPollingError ? (
                        <>
                            <SpinnerGap
                                size={spacing["6"]}
                                className={`${sprinkles({color: "grey-50"})} ${spinAnimationClassName}`}
                            />
                            <Spacer space="2" />
                            <Box fontSize="75" color="grey-80">
                                Validating {selectedFileName}…
                            </Box>
                            <Spacer space="5" />
                            <Button
                                fontSize="75"
                                height="7"
                                paddingX="3"
                                variant="outline"
                                color="grey-60"
                                isPending={isCanceling}
                                pressErrorTitle="Couldn&#x2019;t cancel validation"
                                onPress={onCancel}
                            >
                                Cancel
                            </Button>
                        </>
                    ) : isPollingError ? (
                        <>
                            <Box fontSize="100" color="red-70" fontStyle="semi-bold">
                                Something went wrong
                            </Box>
                            <Spacer space="1" />
                            <Box fontSize="75" color="grey-60">
                                {platform === "mobile"
                                    ? "Tap to try uploading again"
                                    : "Click to try uploading again"}
                            </Box>
                            {platform === "desktop" && (
                                <>
                                    <Spacer space="1" />
                                    <Box fontSize="75" color="grey-50">
                                        or drag and drop
                                    </Box>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <Box
                                fontSize="100"
                                color={isDragging ? "grey-90" : "grey-70"}
                                fontStyle="semi-bold"
                            >
                                {platform === "mobile"
                                    ? "Tap to upload a Notion export"
                                    : "Click to upload a Notion export"}
                            </Box>
                            {platform === "desktop" && (
                                <>
                                    <Spacer space="1" />
                                    <Box fontSize="75" color={isDragging ? "grey-70" : "grey-50"}>
                                        or drag and drop
                                    </Box>
                                </>
                            )}
                        </>
                    )}
                </Box>
            </FocusRing>
        </Box>
    );
}
