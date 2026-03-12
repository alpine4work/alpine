import {ShouldRevalidateFunction} from "@remix-run/router";
import {assignInlineVars} from "@vanilla-extract/dynamic";
import {CaretRight} from "phosphor-react";
import {useMemo, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Link} from "~/client/web/design/link.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {NotionIcon} from "~/client/web/icons/notion_icon.js";
import {SlackLogo} from "~/client/web/icons/socials/slack_logo.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    spaceListSettingsHeadingSettingsRowAvatarSize,
    spaceListSettingsHeadingSettingsRowGap,
    spaceListSettingsHeadingSettingsRowPaddingY,
    spaceListSettingsHeadingSettingsRowTaglineFontSize,
    spaceListSettingsHeadingSettingsRowTitleFontSize,
    spaceListSettingsHeadingSettingsRowTitleMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {hasSlackIntegrationSettingsFeature} from "~/shared/integrations/has_slack_integration_settings_feature.js";
import {hasNotionImportFeature} from "~/shared/spaces/has_notion_import_feature.js";

// We don't need to reload if the URL doesn't change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

interface IntegrationData {
    slug: string;
    name: string;
    tagline: string;
    icon: React.ReactNode;
    isAvailable: (spaceId: SpaceId) => boolean;
}

const integrations: Array<IntegrationData> = [
    {
        slug: "slack",
        name: "Slack",
        tagline: "Get notifications in Slack",
        icon: <SlackLogo />,
        isAvailable: (spaceId: SpaceId) => hasSlackIntegrationSettingsFeature(spaceId),
    },
    {
        slug: "import/notion",
        name: "Notion",
        tagline: "Import documents from Notion",
        icon: <NotionIcon size={spacing[spaceListSettingsHeadingSettingsRowAvatarSize]} />,
        isAvailable: hasNotionImportFeature,
    },
];

export default function SpaceIntegrationListSettingsRoute() {
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const availableIntegrations = useMemo(
        () => integrations.filter(integration => integration.isAvailable(space.id)),
        [space.id],
    );

    return (
        <Box position="relative" zIndex="0" display="flex" flexDirection="column" gap="6">
            <Box fontSize="75" color="grey-60" userSelect="text">
                Want an integration you don’t see here? Let us know:{" "}
                <Link color="inherit" url="mailto:feedback@alpine.inc">
                    feedback@alpine.inc
                </Link>
            </Box>
            <Box>
                {availableIntegrations.map(integration => (
                    <SpaceIntegrationSettingsRow key={integration.slug} integration={integration} />
                ))}
            </Box>
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
                    width="10"
                    height="10"
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
