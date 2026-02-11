import {getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import {CaretDown, SpinnerGap} from "phosphor-react";
import {useCallback, useEffect, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRevalidator} from "~/client/web/remix/use_revalidator.js";
import {uploadFileToPresignedUrl} from "~/client/web/settings/upload_file_to_presigned_url.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getAllNotionImportsForSpace} from "~/server/importer/notion/get_notion_import.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {ErrorBase, NotFoundError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId, NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    NotionImportStatusSchema,
    NotionImportTeamspaceOptionsSchema,
} from "~/shared/importer/notion/notion_import_item.js";
import {
    cancelNotionImport,
    createNotionImport,
    finishedNotionImportUpload,
    getNotionImport,
    startNotionImport,
} from "~/shared/rpc/notion_import_rpc_definitions.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {hasNotionImportFeature} from "~/shared/spaces/has_notion_import_feature.js";

/** Local UI state for teamspace import choices. Maps teamspaceId to visibility option. */
type TeamspaceImportOptionsMap = Map<
    string,
    {type: "Private"} | {type: "Public"} | {type: "DoNotImport"}
>;

const LocalNotionImportItemSchema = Schema.object({
    notionImportId: Schema.id<NotionImportId>(),
    spaceId: Schema.id<SpaceId>(),
    workspaceName: Schema.string.nullable(),
    startedByAccountId: Schema.id<AccountId>(),
    createdTime: Schema.date,
    updatedTime: Schema.date,
    teamspaceImportOptions: NotionImportTeamspaceOptionsSchema.nullable(),
    status: NotionImportStatusSchema,
    importedCount: Schema.integer,
});

const LoaderSchema = Schema.object({
    notionImports: Schema.array(LocalNotionImportItemSchema),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    if (!hasNotionImportFeature(spaceId)) {
        throw new NotFoundError("Page not found");
    }

    const notionImports = await getAllNotionImportsForSpace(context, {spaceId});

    return jsonWithSchema(LoaderSchema, {
        notionImports: notionImports.map(item => ({
            notionImportId: item.notionImportId,
            spaceId: item.spaceId,
            workspaceName: item.workspaceName,
            startedByAccountId: item.startedByAccountId,
            createdTime: item.createdTime,
            updatedTime: item.updatedTime,
            teamspaceImportOptions: item.teamspaceImportOptions,
            status: item.status,
            importedCount: item.importedCount,
        })),
    });
}

export default function SpaceIntegrationsSettingsRoute() {
    const context = useAppContext();
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const reporter = useReporter();
    const {revalidate} = useRevalidator();

    const {notionImports} = useLoaderDataWithSchema(LoaderSchema);

    // Current import being created/validated by this user
    const [currentImport, setCurrentImport] = useState<SchemaType<
        typeof LocalNotionImportItemSchema
    > | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isStartingImport, setIsStartingImport] = useState(false);
    const [isCanceling, setIsCanceling] = useState(false);
    const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
    // User's teamspace choices (built from server data, modified by user)
    const [teamspaceImportOptions, setTeamspaceImportOptions] =
        useState<TeamspaceImportOptionsMap | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Check if there's an active import from the loader (for imports already in progress)
    const activeImportFromLoader = notionImports.find(
        item => item.status.type !== "Success" && item.status.type !== "Failed",
    );
    const completedImports = notionImports.filter(
        item => item.status.type === "Success" || item.status.type === "Failed",
    );

    // The active import is either the one we're currently creating or one from the loader
    const activeImport = currentImport ?? activeImportFromLoader;

    // Poll for import status updates
    const pollImportStatus = useCallback(
        async (notionImportId: NotionImportId) => {
            try {
                const {notionImport} = await getNotionImport(context, {
                    spaceId: space.id,
                    notionImportId,
                });

                if (!notionImport) {
                    // Import was deleted or doesn't exist
                    setCurrentImport(null);
                    return;
                }

                setCurrentImport({
                    ...notionImport,
                    notionImportId,
                });

                // When validated, initialize teamspace options from server data
                // Server already applies smart defaults based on teamspace names
                if (
                    notionImport.status.type === "Validated" &&
                    notionImport.teamspaceImportOptions
                ) {
                    // Convert server teamspace options to the Map format used by the UI
                    const options: TeamspaceImportOptionsMap = new Map();
                    for (const ts of notionImport.teamspaceImportOptions) {
                        options.set(ts.teamspaceId, ts.option);
                    }
                    setTeamspaceImportOptions(options);
                }

                // Stop polling when import reaches a terminal state or is ready for user input
                if (
                    notionImport.status.type === "Success" ||
                    notionImport.status.type === "Failed" ||
                    notionImport.status.type === "Validated"
                ) {
                    if (pollingRef.current) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }

                    // If finished, clear current import and revalidate loader
                    if (
                        notionImport.status.type === "Success" ||
                        notionImport.status.type === "Failed"
                    ) {
                        setCurrentImport(null);
                        setSelectedFileName(null);
                        setTeamspaceImportOptions(null);
                        if (fileInputRef.current) {
                            fileInputRef.current.value = "";
                        }
                        void revalidate();
                    }
                }
            } catch {
                // Silently ignore polling errors
            }
        },
        [context, space.id, revalidate],
    );

    // Start polling for a specific import
    const startPolling = useCallback(
        (notionImportId: NotionImportId) => {
            // Clear any existing polling
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }

            // Poll immediately
            void pollImportStatus(notionImportId);

            // Then poll every second
            pollingRef.current = setInterval(() => {
                void pollImportStatus(notionImportId);
            }, 1000);
        },
        [pollImportStatus],
    );

    // Clean up polling on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, []);

    // Resume polling for active import from loader on mount
    useEffect(() => {
        if (activeImportFromLoader && !currentImport) {
            if (activeImportFromLoader.status.type === "Validated") {
                // For validated imports, just initialize the teamspace options without polling
                if (activeImportFromLoader.teamspaceImportOptions) {
                    const options: TeamspaceImportOptionsMap = new Map();
                    for (const ts of activeImportFromLoader.teamspaceImportOptions) {
                        options.set(ts.teamspaceId, ts.option);
                    }
                    setTeamspaceImportOptions(options);
                }
            } else {
                startPolling(activeImportFromLoader.notionImportId);
            }
        }
    }, [activeImportFromLoader, currentImport, startPolling]);

    const triggerFileInput = () => {
        const fileInputElement = assertExists(fileInputRef.current);

        const interactionModality = getInteractionModality();
        fileInputElement.focus();
        fileInputElement.click();
        setInteractionModality(interactionModality);
    };

    const handleFileSelect = async (file: File) => {
        if (isUploading) return;

        // If there's an existing import in a cancellable state, cancel it first
        if (activeImport) {
            const isCancellable =
                activeImport.status.type === "UploadPending" ||
                activeImport.status.type === "ValidateQueued" ||
                activeImport.status.type === "Validating" ||
                activeImport.status.type === "Validated";

            if (!isCancellable) {
                // Can't cancel imports that are already processing
                return;
            }

            // Stop any active polling
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }

            // Cancel the existing import silently
            try {
                await cancelNotionImport(context, {
                    spaceId: space.id,
                    notionImportId: activeImport.notionImportId,
                });
            } catch {
                // Ignore cancel errors and proceed with new upload
            }

            setCurrentImport(null);
        }

        setSelectedFileName(file.name);
        setTeamspaceImportOptions(null);

        // Upload immediately - server will validate the zip
        setIsUploading(true);
        setUploadProgress(0);
        try {
            const {notionImportId, presignedUploadUrl} = await createNotionImport(context, {
                spaceId: space.id,
                fileName: file.name,
                contentType: file.type || "application/zip",
                contentLength: file.size,
            });

            await new Promise<void>((resolve, reject) => {
                uploadFileToPresignedUrl({
                    file,
                    presignedUrl: presignedUploadUrl,
                    contentType: file.type || "application/zip",
                    onProgress: setUploadProgress,
                    onSuccess: resolve,
                    onError: reject,
                });
            });

            // Notify the server that upload is complete to trigger validation
            await finishedNotionImportUpload(context, {
                spaceId: space.id,
                notionImportId,
            });

            // Start polling for validation status
            startPolling(notionImportId);
        } catch (error) {
            setSelectedFileName(null);
            setTeamspaceImportOptions(null);
            if (error instanceof ErrorBase) {
                reporter.displayError("Couldn’t upload file", error);
            }
        } finally {
            setIsUploading(false);
        }
    };

    const handleStartImport = async () => {
        if (!activeImport || activeImport.status.type !== "Validated" || isStartingImport) return;
        if (!teamspaceImportOptions) return;

        setIsStartingImport(true);

        try {
            // Convert Map to array format expected by the RPC
            const teamspaceOptionsArray = assertExists(activeImport.teamspaceImportOptions).map(
                ts => ({
                    teamspaceId: ts.teamspaceId,
                    teamspaceName: ts.teamspaceName,
                    option: teamspaceImportOptions.get(ts.teamspaceId) ?? {type: "Public" as const},
                }),
            );

            await startNotionImport(context, {
                spaceId: space.id,
                notionImportId: activeImport.notionImportId,
                teamspaceImportOptions: teamspaceOptionsArray,
            });

            // Start polling for import progress
            startPolling(activeImport.notionImportId);
        } catch (error) {
            if (error instanceof ErrorBase) {
                reporter.displayError("Couldn’t start import", error);
            }
        } finally {
            setIsStartingImport(false);
        }
    };

    const handleCancelImport = async () => {
        if (!activeImport || isCanceling) return;

        // Can only cancel imports that haven't started processing
        const isCancellable =
            activeImport.status.type === "UploadPending" ||
            activeImport.status.type === "ValidateQueued" ||
            activeImport.status.type === "Validating" ||
            activeImport.status.type === "Validated";

        if (!isCancellable) return;

        setIsCanceling(true);

        try {
            // Stop any active polling
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }

            await cancelNotionImport(context, {
                spaceId: space.id,
                notionImportId: activeImport.notionImportId,
            });

            // Clear local state
            setCurrentImport(null);
            setSelectedFileName(null);
            setTeamspaceImportOptions(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
            void revalidate();
        } catch (error) {
            if (error instanceof ErrorBase) {
                reporter.displayError("Couldn’t cancel import", error);
            }
        } finally {
            setIsCanceling(false);
        }
    };

    // Determine what to show based on current state
    const showFileUpload = !activeImport || activeImport.status.type === "Validated";
    const showValidatingStatus =
        activeImport &&
        (activeImport.status.type === "UploadPending" ||
            activeImport.status.type === "ValidateQueued" ||
            activeImport.status.type === "Validating");
    const showTeamspaceOptions =
        activeImport?.status.type === "Validated" && activeImport.teamspaceImportOptions;
    const showImportProgress =
        activeImport &&
        (activeImport.status.type === "ProcessQueued" || activeImport.status.type === "Processing");

    return (
        <Box display="flex" flexDirection="column" gap="6" width="full">
            <Box>
                <label
                    className={sprinkles({
                        display: "block",
                        fontSize: "100",
                        fontStyle: "semi-bold",
                        userSelect: "text",
                        marginBottom: "2",
                    })}
                >
                    Import from Notion
                </label>
                <Box fontSize="75" color="grey-60" marginBottom="3">
                    Upload a Notion export zip file to import your content.
                </Box>
            </Box>

            {/* File upload section - shown when no active import or when validated (to allow changing file) */}
            {showFileUpload && !showImportProgress && (
                <Box>
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
                        disabled={isUploading}
                        aria-label="Select Notion export file"
                        autoComplete="off"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) {
                                void handleFileSelect(file);
                            }
                        }}
                    />

                    <FocusRing>
                        <Box
                            tabIndex={0}
                            role="button"
                            aria-label={
                                selectedFileName ? `Selected: ${selectedFileName}` : "Select file"
                            }
                            onClick={triggerFileInput}
                            onKeyDown={event => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    triggerFileInput();
                                }
                            }}
                            display="flex"
                            flexDirection="column"
                            alignItems="center"
                            justifyContent="center"
                            padding="6"
                            border="grey-10"
                            borderRadius="1.5"
                            cursor={isUploading ? "not-allowed" : "pointer"}
                            opacity={isUploading ? "50" : undefined}
                            style={{
                                minHeight: spacing["24"],
                            }}
                        >
                            {isUploading ? (
                                <>
                                    <SpinnerGap
                                        size={spacing["6"]}
                                        className={sprinkles({color: "grey-50"})}
                                        style={{animation: "spin 1s linear infinite"}}
                                    />
                                    <Spacer space="2" />
                                    <Box fontSize="75" color="grey-60">
                                        {`Uploading ${selectedFileName}... (${Math.min(99, Math.round(uploadProgress * 100))}%)`}
                                    </Box>
                                </>
                            ) : activeImport?.status.type === "Validated" ? (
                                <>
                                    {activeImport.workspaceName && (
                                        <>
                                            <Box fontSize="100" fontStyle="semi-bold">
                                                {activeImport.workspaceName}
                                            </Box>
                                            <Spacer space="1" />
                                        </>
                                    )}
                                    <Box
                                        fontSize={activeImport.workspaceName ? "75" : "100"}
                                        fontStyle={
                                            activeImport.workspaceName ? undefined : "semi-bold"
                                        }
                                        color={activeImport.workspaceName ? "grey-60" : undefined}
                                    >
                                        Ready to import
                                    </Box>
                                    <Spacer space="1" />
                                    <Box fontSize="75" color="grey-50">
                                        Click to change file
                                    </Box>
                                </>
                            ) : (
                                <>
                                    <Box fontSize="100" color="grey-70">
                                        Click to select a .zip file
                                    </Box>
                                    <Spacer space="1" />
                                    <Box fontSize="75" color="grey-50">
                                        Or drag and drop
                                    </Box>
                                </>
                            )}
                        </Box>
                    </FocusRing>
                </Box>
            )}

            {/* Validating status - shown while waiting for server validation */}
            {showValidatingStatus && (
                <Box
                    padding="4"
                    backgroundColor="grey-5"
                    borderRadius="1.5"
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Box display="flex" alignItems="center" gap="3">
                        <SpinnerGap
                            size={spacing["5"]}
                            className={sprinkles({color: "grey-70"})}
                            style={{animation: "spin 1s linear infinite"}}
                        />
                        <Box>
                            <Box fontSize="100" fontStyle="semi-bold">
                                {activeImport.status.type === "UploadPending"
                                    ? "Waiting for upload..."
                                    : activeImport.status.type === "ValidateQueued"
                                      ? "Queued for validation..."
                                      : "Validating..."}
                            </Box>
                            <Box fontSize="75" color="grey-60">
                                Checking your Notion export
                            </Box>
                        </Box>
                    </Box>
                    <Button
                        variant="quiet"
                        isDisabled={isCanceling}
                        onPress={handleCancelImport}
                        pressErrorTitle={"Couldn\u2019t cancel import"}
                    >
                        {isCanceling ? "Canceling…" : "Cancel"}
                    </Button>
                </Box>
            )}

            {/* Teamspace import choices - shown when validated */}
            {showTeamspaceOptions && (
                <TeamspaceImportOptions
                    teamspaces={activeImport.teamspaceImportOptions.map(ts => ({
                        id: ts.teamspaceId,
                        name: ts.teamspaceName,
                    }))}
                    options={teamspaceImportOptions}
                    onChange={setTeamspaceImportOptions}
                />
            )}

            {/* Start import button - shown when validated */}
            {activeImport?.status.type === "Validated" && (
                <Box display="flex" alignItems="center" gap="3">
                    <Button
                        variant="accent"
                        isDisabled={
                            isStartingImport ||
                            isCanceling ||
                            (teamspaceImportOptions != null &&
                                [...teamspaceImportOptions.values()].every(
                                    v => v.type === "DoNotImport",
                                ))
                        }
                        onPress={handleStartImport}
                        pressErrorTitle="Couldn’t start import"
                    >
                        {isStartingImport ? "Starting..." : "Start Import"}
                    </Button>
                    <Button
                        variant="quiet"
                        isDisabled={isStartingImport || isCanceling}
                        onPress={handleCancelImport}
                        pressErrorTitle="Couldn’t cancel import"
                    >
                        {isCanceling ? "Canceling..." : "Cancel"}
                    </Button>
                </Box>
            )}

            {/* Import progress - shown when queued or processing */}
            {showImportProgress && (
                <Box
                    padding="4"
                    backgroundColor="grey-5"
                    borderRadius="1.5"
                    display="flex"
                    alignItems="center"
                    gap="3"
                >
                    <SpinnerGap
                        size={spacing["5"]}
                        className={sprinkles({color: "grey-70"})}
                        style={{animation: "spin 1s linear infinite"}}
                    />
                    <Box>
                        <Box fontSize="100" fontStyle="semi-bold">
                            {activeImport.status.type === "ProcessQueued"
                                ? "Import queued"
                                : "Importing..."}
                        </Box>
                        <Box fontSize="75" color="grey-60">
                            {activeImport.importedCount} items imported
                        </Box>
                    </Box>
                </Box>
            )}

            {completedImports.length > 0 && (
                <NotionImportHistory notionImports={completedImports} />
            )}
        </Box>
    );
}

function TeamspaceImportOptions({
    teamspaces,
    options,
    onChange,
}: {
    teamspaces: Array<{id: string; name: string}>;
    options: TeamspaceImportOptionsMap | null;
    onChange: (options: TeamspaceImportOptionsMap) => void;
}) {
    return (
        <Box display="flex" flexDirection="column" gap="3">
            <Box fontSize="100" fontStyle="semi-bold">
                {teamspaces.length === 1 ? "Import visibility" : "Teamspaces"}
            </Box>
            {teamspaces.map(ts => {
                const choice = options?.get(ts.id);
                return (
                    <Box
                        key={ts.id}
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        padding="3"
                        border="grey-10"
                        borderRadius="1"
                    >
                        <Box fontSize="100">{ts.name}</Box>
                        <MenuButton
                            placement="bottom-end"
                            actions={[
                                {
                                    label: "Private",
                                    isSelected: choice?.type === "Private",
                                    onPress: () => {
                                        onChange(new Map(options).set(ts.id, {type: "Private"}));
                                    },
                                },
                                {
                                    label: "Public",
                                    isSelected: choice?.type === "Public",
                                    onPress: () => {
                                        onChange(new Map(options).set(ts.id, {type: "Public"}));
                                    },
                                },
                                ...(teamspaces.length > 1
                                    ? [
                                          {
                                              label: "Do not import",
                                              isSelected: choice?.type === "DoNotImport",
                                              onPress: () => {
                                                  onChange(
                                                      new Map(options).set(ts.id, {
                                                          type: "DoNotImport" as const,
                                                      }),
                                                  );
                                              },
                                          },
                                      ]
                                    : []),
                            ]}
                        >
                            <Button variant="quiet" icon={<CaretDown />} iconPlacement="end">
                                {choice?.type === "DoNotImport"
                                    ? "Do not import"
                                    : choice?.type === "Public"
                                      ? "Public"
                                      : "Private"}
                            </Button>
                        </MenuButton>
                    </Box>
                );
            })}
        </Box>
    );
}

function NotionImportHistory({
    notionImports,
}: {
    notionImports: Array<SchemaType<typeof LocalNotionImportItemSchema>>;
}) {
    // Sort by last updated, newest first
    const sortedImports = [...notionImports].sort(
        (a, b) => b.updatedTime.getTime() - a.updatedTime.getTime(),
    );

    return (
        <Box>
            <Box fontSize="100" fontStyle="semi-bold" marginBottom="3">
                Import History
            </Box>
            <Box display="flex" flexDirection="column" gap="2">
                {sortedImports.map((item, index) => (
                    <Box
                        key={index}
                        padding="3"
                        border="grey-10"
                        borderRadius="1"
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                    >
                        <Box>
                            <Box fontSize="75">{item.createdTime.toLocaleDateString()}</Box>
                            <Box fontSize="75" color="grey-60">
                                {item.importedCount} items imported
                            </Box>
                        </Box>
                        <Box
                            fontSize="75"
                            color={item.status.type === "Success" ? "green-70" : "red-70"}
                        >
                            {item.status.type === "Success" ? "Completed" : "Failed"}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
