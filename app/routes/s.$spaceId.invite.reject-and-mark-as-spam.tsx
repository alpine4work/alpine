import {redirect} from "@remix-run/node";
import {useEffect, useMemo, useState} from "react";
import {BlobsArt} from "~/client/blobs/blobs_art.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useInitialAppRenderId} from "~/client/helpers/lifecycle/initial_app_render.js";
import {BrandLogoIcon} from "~/client/icons/brand/brand_logo_icon.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {rejectSpaceAccountInviteAsSpam} from "~/shared/rpc/spaces_rpc_definitions.js";
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

export default function InviteRejectAndMarkAsSpamRoute() {
    const navigate = useNavigate();
    const appContext = useAppContext();
    const context = useSpaceContext();

    // TODO(#theme-color)
    const themeColor = defaultThemeColor;

    useEffect(() => {
        void (async () => {
            await rejectSpaceAccountInviteAsSpam(appContext, {
                spaceId: context.space.id,
            });
        })();
    }, [appContext, context.space.id, navigate]);

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
        <Box width="full" paddingY="safe-area-inset">
            <BlobsArt settings={blobsSettings} />
            <Box
                height="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
                flexDirection="column"
            >
                <Box
                    display="flex"
                    flexDirection="column"
                    gap="8"
                    width="full"
                    maxWidth="128"
                    textAlign="center"
                    alignItems="center"
                >
                    <BrandLogoIcon size="32" />
                    <Box>
                        This invite has been marked as spam and you will not be invited to this
                        space again.
                    </Box>
                    <Box>You may now leave this window.</Box>
                </Box>
            </Box>
        </Box>
    );
}
