import {redirect} from "@remix-run/node";
import {useEffect, useMemo, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useInitialAppRenderId} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {rejectSpaceAccountInviteAsSpam} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? "");
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const currentAccount = await getOwnAccountIfExists(
        context,
        spaceId,
        context.actor.getAccountId(),
        // Use strong consistency in case we're coming from sign up or some other flow
        // which just updated our account state.
        {consistency: "Strong"},
    );

    if (!currentAccount) {
        throw new PermissionDeniedError("Account isn\u2019t invited to the space");
    }

    if (currentAccount.initialData.space.state.type !== "InvitePending") {
        return redirect(`/s/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {});
}

export default function InviteRejectAndMarkAsSpamRoute() {
    const navigate = useNavigate();
    const appContext = useAppContext();
    const context = useSpaceContext();
    const reporter = useReporter();

    const themeColor = context.space.themeColor;

    const [rejectedComplete, setRejectedComplete] = useState(false);

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        void (async () => {
            try {
                await rejectSpaceAccountInviteAsSpam(appContext, {
                    spaceId: context.space.id,
                });

                setRejectedComplete(true);
            } catch (error) {
                reporter.displayError("Couldn\u2019t reject invite", error);
            }
        })();
    }, [appContext, context.space.id, navigate, reporter]);

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
                    <LogoWordmark size="32" />
                    <Box>
                        This invite has been marked as spam and you will not be invited to this
                        space again.
                    </Box>
                    <Box>You may now leave this window.</Box>
                    {/* For integration tests, we need some way to know the request completed */}
                    {process.env.NODE_ENV !== "production" && rejectedComplete && (
                        <Box data-testid="RejectSpaceAccountInviteAsSpamCompleted" />
                    )}
                </Box>
            </Box>
        </Box>
    );
}
