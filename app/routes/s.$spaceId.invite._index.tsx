import {redirect} from "@remix-run/node";
import {useMemo, useState} from "react";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {BlobsArt} from "~/client/blobs/blobs_art.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useInitialAppRenderId} from "~/client/helpers/lifecycle/initial_app_render.js";
import {BrandLogoIcon} from "~/client/icons/brand/brand_logo_icon.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    if (context.actor.type !== "Session") {
        throw new PermissionDeniedError("Can’t load the invite page with a non-Session account");
    }

    const currentAccountResult = assertExists(
        await getAccountIfExists(context, spaceId, context.actor.getAccountId(), {
            disableOwnAccountAccessCheck: true,
        }),
    );

    if (currentAccountResult.initialData.space.state.type !== "InvitePending") {
        return redirect(`/s/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {});
}

export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    return [{title: `Join ${spaceRouteData?.space.name ?? "Space"}`}];
});

export default function HomeRoute() {
    const navigate = useNavigate();
    const appContext = useAppContext();
    const context = useSpaceContext();

    // TODO(#theme-color) - support theme color via hook
    const themeColor = defaultThemeColor;

    const onRejectInviteAndMarkAsSpam = async () => {
        // Let the sub route handle the rejection.
        navigate(`/s/${context.space.id}/invite/reject-and-mark-as-spam`);
    };

    const onAcceptInvite = async () => {
        // We want to manually handle the invite acceptance here
        // to avoid another redirect to /accept and then home.
        await acceptSpaceAccountInvite(appContext, {
            spaceId: context.space.id,
        });

        const urlParams = new URLSearchParams(window.location.search);
        const to = urlParams.get("to");
        const destination = to ? `/s/${context.space.id}${to}` : `/s/${context.space.id}`;

        // TODO(imjoshin, #permissions-stale-on-navigate): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/h6q3njtjbdmwwz13w1es8sbavw
        // hard set the URL to the space index after accepting the invite
        // to avoid any issues with auth state updates.
        window.location.href = destination;
    };

    const initialAppRenderId = useInitialAppRenderId();
    const [idForGeneration] = useState(initialAppRenderId ?? generateId());
    const blobsSettings = useMemo(() => {
        return {
            seed: idForGeneration.replaceAll(/[^a-zA-Z0-9]/g, ""),
            hueSpread: 10,
            themeColor,
        };
    }, [idForGeneration, themeColor]);

    return (
        <Box width="full" height="full" paddingY="safe-area-inset">
            <BlobsArt settings={blobsSettings} />
            <Box
                display="flex"
                height="full"
                justifyContent="center"
                alignItems="center"
                flexDirection="column"
                gap="4"
            >
                <BrandLogoIcon size="32" />
                <Box
                    display="flex"
                    flexDirection="column"
                    gap="4"
                    width="full"
                    maxWidth="96"
                    backgroundColor="grey-0"
                    borderRadius="2"
                    boxShadow="elevation-30"
                    padding="8"
                    textAlign="center"
                    alignItems="center"
                >
                    <SpaceAvatar space={context.space} size="16" />
                    <Box textAlign="center">You’ve been invited to join</Box>
                    <Box fontStyle="semi-bold" textAlign="center" fontSize="300">
                        {context.space.name}
                    </Box>
                    <Box>
                        Someone has added you to their workspace. Accept to start collaborating.
                    </Box>
                    <Box marginTop="4" width="full">
                        <Button
                            variant="accent"
                            height="8"
                            paddingX="3"
                            fullWidth
                            pressErrorTitle="Couldn’t accept invite"
                            onPress={onAcceptInvite}
                        >
                            Join {context.space.name}
                        </Button>
                    </Box>
                </Box>
                <Button
                    variant="quieter"
                    height="6"
                    paddingX="2"
                    pressErrorTitle="Couldn’t reject invite"
                    onPress={onRejectInviteAndMarkAsSpam}
                    fontSize="50"
                >
                    Report this invitation as spam
                </Button>
            </Box>
        </Box>
    );
}
