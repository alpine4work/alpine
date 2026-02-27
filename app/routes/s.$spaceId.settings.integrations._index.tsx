import {ShouldRevalidateFunction} from "@remix-run/router";
import {assignInlineVars} from "@vanilla-extract/dynamic";
import {CaretRight, SlackLogo} from "phosphor-react";
import {useMemo, useState} from "react";
import {usePress} from "react-aria";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Link} from "~/client/web/design/link.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {NotionIcon} from "~/client/web/icons/notion_icon.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    spaceListSettingsHeadingFontSize,
    spaceListSettingsHeadingMarginBottom,
    spaceListSettingsHeadingSettingsRowAvatarSize,
    spaceListSettingsHeadingSettingsRowGap,
    spaceListSettingsHeadingSettingsRowPaddingY,
    spaceListSettingsHeadingSettingsRowTaglineFontSize,
    spaceListSettingsHeadingSettingsRowTitleFontSize,
    spaceListSettingsHeadingSettingsRowTitleMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {hasSlackIntegrationSettingsFeature} from "~/shared/integrations/has_slack_integration_settings_feature.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasNotionImportFeature} from "~/shared/spaces/has_notion_import_feature.js";

const LoaderSchema = Schema.object({
    hasSlackIntegrationConfigured: Schema.boolean,
});

// We don't need to reload if the URL doesn't change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const slackIntegration = await getConnectedSlackWorkspaceIfExists(context, {spaceId});

    return jsonWithSchema(LoaderSchema, {
        hasSlackIntegrationConfigured: slackIntegration !== null,
    });
}

interface IntegrationData {
    slug: string;
    name: string;
    tagline: string;
    icon: React.ReactNode;
    isConfigured: boolean;
    isAvailable: boolean;
}

interface ImporterData {
    slug: string;
    name: string;
    tagline: string;
    icon: React.ReactNode;
    isAvailable: (spaceId: SpaceId) => boolean;
}

const availableImporters: Array<ImporterData> = [
    {
        slug: "import/notion",
        name: "Notion",
        tagline: "Import documents from Notion",
        icon: <NotionIcon size={spacing[spaceListSettingsHeadingSettingsRowAvatarSize]} />,
        isAvailable: hasNotionImportFeature,
    },
];

export default function SpaceIntegrationListSettingsRoute() {
    const {hasSlackIntegrationConfigured} = useLoaderDataWithSchema(LoaderSchema);
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const configuredIntegrations: Array<IntegrationData> = [];
    const availableIntegrations: Array<IntegrationData> = [];
    const importers: Array<ImporterData> = useMemo(() => {
        return availableImporters.filter(importer => importer.isAvailable(space.id));
    }, [space.id]);

    const slackIntegration: IntegrationData = {
        slug: "slack",
        name: "Slack",
        tagline: hasSlackIntegrationConfigured
            ? "Connected to your Slack workspace"
            : "Connect your Slack workspace",
        icon: <SlackLogo size={spacing[spaceListSettingsHeadingSettingsRowAvatarSize]} />,
        isConfigured: hasSlackIntegrationConfigured,
        isAvailable: hasSlackIntegrationSettingsFeature(space.id),
    };
    if (slackIntegration.isConfigured) {
        configuredIntegrations.push(slackIntegration);
    } else if (slackIntegration.isAvailable) {
        availableIntegrations.push(slackIntegration);
    }

    const integrationFeedbackPrompt = (
        <Box fontSize="75" color="grey-60" userSelect="text">
            Want an integration you don’t see here? Let us know:{" "}
            <Link color="inherit" url="mailto:feedback@alpine.inc">
                feedback@alpine.inc
            </Link>
        </Box>
    );

    return (
        <Box position="relative" zIndex="0" display="flex" flexDirection="column" gap="10">
            <Box>
                <Box display="flex" flexDirection="column" gap="1">
                    <Box
                        fontSize={spaceListSettingsHeadingFontSize}
                        fontStyle="bold"
                        userSelect="text"
                    >
                        Configured
                    </Box>
                    {configuredIntegrations.length === 0 ? (
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            No integrations configured.
                        </Box>
                    ) : availableIntegrations.length === 0 ? (
                        integrationFeedbackPrompt
                    ) : null}
                </Box>
                <Spacer space={spaceListSettingsHeadingMarginBottom} />
                {configuredIntegrations.map(integration => (
                    <SpaceIntegrationSettingsRow key={integration.slug} integration={integration} />
                ))}
            </Box>
            {availableIntegrations.length > 0 && (
                <Box>
                    <Box display="flex" flexDirection="column" gap="1">
                        <Box
                            fontSize={spaceListSettingsHeadingFontSize}
                            fontStyle="bold"
                            userSelect="text"
                        >
                            Available
                        </Box>
                        {integrationFeedbackPrompt}
                    </Box>
                    <Spacer space={spaceListSettingsHeadingMarginBottom} />
                    {availableIntegrations.map(integration => (
                        <SpaceIntegrationSettingsRow
                            key={integration.slug}
                            integration={integration}
                        />
                    ))}
                </Box>
            )}
            {importers.length > 0 && (
                <Box>
                    <Box display="flex" flexDirection="column" gap="1">
                        <Box
                            fontSize={spaceListSettingsHeadingFontSize}
                            fontStyle="bold"
                            userSelect="text"
                        >
                            Import
                        </Box>
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            Import data from other services
                        </Box>
                    </Box>
                    <Spacer space={spaceListSettingsHeadingMarginBottom} />
                    {importers.map(importer => (
                        <SpaceImporterSettingsRow key={importer.slug} importer={importer} />
                    ))}
                </Box>
            )}
        </Box>
    );
}

function SpaceIntegrationSettingsRow({integration}: {integration: IntegrationData}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const [isNavigating, setIsNavigating] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isNavigating) return;

            setIsNavigating(true);

            navigate(`/s/${space.id}/settings/integrations/${integration.slug}`).finally(() => {
                setIsNavigating(false);
            });
        },
    });

    return (
        <FocusRing offset="border" insetX="-4">
            <Box
                {...pressProps}
                tabIndex={0}
                position="relative"
                zIndex="0"
                display="flex"
                alignItems="center"
                gap={spaceListSettingsHeadingSettingsRowGap}
                paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
                cursor="pointer"
                style={{
                    ...(isPressed
                        ? assignInlineVars({[backgroundColorVar]: colorSchemeVars["grey-5"]})
                        : {}),
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        zIndex="-10"
                        top="0"
                        bottom="0"
                        left={routeLayout === "wide" ? "-4" : `-${screenPaddingX[platform]}`}
                        right={routeLayout === "wide" ? "-4" : `-${screenPaddingX[platform]}`}
                        borderRadius={routeLayout === "wide" ? "1.5" : undefined}
                        backgroundColor="grey-5"
                        style={{top: -1}}
                    />
                )}
                <Box
                    width={spaceListSettingsHeadingSettingsRowAvatarSize}
                    height={spaceListSettingsHeadingSettingsRowAvatarSize}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    color="grey-70"
                >
                    {integration.icon}
                </Box>
                <Box flexGrow="1">
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTitleFontSize}
                        fontStyle="semi-bold"
                    >
                        {integration.name}
                    </Box>
                    <Spacer space={spaceListSettingsHeadingSettingsRowTitleMarginBottom} />
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTaglineFontSize}
                        color="grey-50"
                    >
                        {integration.tagline}
                    </Box>
                </Box>
                <CaretRight size={spacing["4"]} color={colorSchemeVars["grey-60"]} />
            </Box>
        </FocusRing>
    );
}

function SpaceImporterSettingsRow({importer}: {importer: ImporterData}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const [isNavigating, setIsNavigating] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isNavigating) return;

            setIsNavigating(true);

            navigate(`/s/${space.id}/settings/integrations/${importer.slug}`).finally(() => {
                setIsNavigating(false);
            });
        },
    });

    return (
        <FocusRing offset="border" insetX="-4">
            <Box
                {...pressProps}
                tabIndex={0}
                position="relative"
                zIndex="0"
                display="flex"
                alignItems="center"
                gap={spaceListSettingsHeadingSettingsRowGap}
                paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
                cursor="pointer"
                style={{
                    ...(isPressed
                        ? assignInlineVars({[backgroundColorVar]: colorSchemeVars["grey-5"]})
                        : {}),
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        zIndex="-10"
                        top="0"
                        bottom="0"
                        left={routeLayout === "wide" ? "-4" : `-${screenPaddingX[platform]}`}
                        right={routeLayout === "wide" ? "-4" : `-${screenPaddingX[platform]}`}
                        borderRadius={routeLayout === "wide" ? "1.5" : undefined}
                        backgroundColor="grey-5"
                        style={{top: -1}}
                    />
                )}
                <Box
                    width={spaceListSettingsHeadingSettingsRowAvatarSize}
                    height={spaceListSettingsHeadingSettingsRowAvatarSize}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    color="grey-70"
                >
                    {importer.icon}
                </Box>
                <Box flexGrow="1">
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTitleFontSize}
                        fontStyle="semi-bold"
                    >
                        {importer.name}
                    </Box>
                    <Spacer space={spaceListSettingsHeadingSettingsRowTitleMarginBottom} />
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTaglineFontSize}
                        color="grey-50"
                    >
                        {importer.tagline}
                    </Box>
                </Box>
                <CaretRight size={spacing["4"]} color={colorSchemeVars["grey-60"]} />
            </Box>
        </FocusRing>
    );
}
