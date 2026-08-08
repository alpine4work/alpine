import {useMemo} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {NotionLogo} from "~/client/web/icons/socials/notion_logo.js";
import {NotionImportHelpSection} from "~/client/web/importers/notion/notion_import_help_section.js";
import {
    NotionImportItemCard,
    NotionImportItemForCard,
} from "~/client/web/importers/notion/notion_import_item_card.js";
import {LocalNotionImportItemSchema} from "~/client/web/importers/notion/notion_import_types.js";
import {NotionImportUploadSection} from "~/client/web/importers/notion/notion_import_upload_section.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeight,
    spaceBotSettingsHeadingHeightNameFontSize,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getAllNotionImportsForSpace} from "~/server/importer/notion/get_notion_import.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountIfExists} from "~/server/spaces/get_account.js";

import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const LoaderSchema = Schema.object({
    notionImports: Schema.array(LocalNotionImportItemSchema),
    importAccounts: Schema.array(AccountModel.schema),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const notionImports = await getAllNotionImportsForSpace(context, {spaceId});

    // Fetch account models for import creators so all users can see "Imported by"
    // names.
    const uniqueAccountIds = [
        ...new Set<AccountId>(notionImports.map(item => item.startedByAccountId)),
    ];
    const importAccounts = (
        await runAllPromises(
            uniqueAccountIds.map(accountId => getAccountIfExists(context, spaceId, accountId)),
        )
    ).filter(isNonNullable);

    return jsonWithSchema(LoaderSchema, {
        notionImports,
        importAccounts,
    });
}

export default function SpaceNotionIntegrationSettingsRoute() {
    const platform = usePlatform();
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const {notionImports, importAccounts} = useLoaderDataWithSchema(LoaderSchema);

    const importAccountById = useMemo(
        () => new Map(importAccounts.map(account => [account.id, account])),
        [importAccounts],
    );

    // Check if the current user has an active pre-processing import. Only
    // pre-processing imports (ValidateQueued, Validating, Validated) from the current
    // user block the upload UI. UploadPending imports are not considered active since
    // the upload was started by a different session that never completed.
    // Processing/Success/Failed imports don't block new imports.
    const activeImportFromLoader = notionImports.find(
        item =>
            item.startedByAccountId === currentAccount.id &&
            (item.status.type === "ValidateQueued" ||
                item.status.type === "Validating" ||
                item.status.type === "Validated"),
    );

    // Imports that have progressed past the setup flow (processing, success, failed).
    const completedOrProcessingImports = useMemo(() => {
        return [...notionImports]
            .filter(
                (item): item is NotionImportItemForCard =>
                    item.status.type === "ProcessQueued" ||
                    item.status.type === "Processing" ||
                    item.status.type === "Success" ||
                    item.status.type === "Failed",
            )
            .sort((a, b) => b.updatedTime.getTime() - a.updatedTime.getTime());
    }, [notionImports]);

    const hasImportHistory = completedOrProcessingImports.length > 0;

    return (
        <Box display="flex" flexDirection="column" width="full">
            {/* Header */}
            <Box
                display="flex"
                alignItems="center"
                height={spaceBotSettingsHeadingHeight}
                gap={spaceBotSettingsHeadingGap}
            >
                <Box
                    width="12"
                    height="12"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                >
                    <NotionLogo />
                </Box>
                <Box display="flex" flexDirection="column" gap="1">
                    <Box
                        fontSize={spaceBotSettingsHeadingHeightNameFontSize}
                        fontStyle="truncate-bold"
                        userSelect="text"
                    >
                        Notion
                    </Box>
                    <Box fontSize="100" userSelect="text" color="grey-60">
                        Import documents from Notion into Alpine
                    </Box>
                </Box>
            </Box>
            <Spacer space="8" />
            {/* Upload section or disabled message */}
            {platform === "mobile" ? (
                <Box
                    flex="1"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    padding="6"
                    backgroundColor="grey-5"
                    borderRadius="1.5"
                    fontSize="100"
                    color="grey-70"
                >
                    To import from Notion, please sign in on a desktop browser.
                </Box>
            ) : (
                <NotionImportUploadSection
                    activeImportFromLoader={activeImportFromLoader ?? null}
                />
            )}
            {hasImportHistory && (
                <>
                    <Spacer space="8" />
                    <Box fontSize="300" fontStyle="bold" marginBottom="3" userSelect="text">
                        Import history
                    </Box>
                    <Box display="flex" flexDirection="column" gap="3">
                        {completedOrProcessingImports.map(item => (
                            <NotionImportItemCard
                                key={item.notionImportId}
                                initialItem={item}
                                startedByAccount={assertExists(
                                    importAccountById.get(item.startedByAccountId),
                                )}
                            />
                        ))}
                    </Box>
                </>
            )}
            <Spacer space="20" />
            <Box
                fontSize="300"
                fontStyle="bold"
                userSelect="text"
                marginBottom={contentStyles.paragraphMargin}
            >
                How to export from Notion
            </Box>
            <NotionImportHelpSection />
        </Box>
    );
}
