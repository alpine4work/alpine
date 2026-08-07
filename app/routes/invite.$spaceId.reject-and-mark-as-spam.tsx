import {redirect} from "@remix-run/node";
import {useEffect, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {AuthenticationViewLayout} from "~/client/web/auth/authentication_view_layout.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Link} from "~/client/web/design/link.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {rejectSpaceAccountInviteAsSpam} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const LoaderSchema = Schema.object({
    spaceId: Schema.id<SpaceId>(),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const currentAccount = await getOwnAccountIfExists(
        context,
        spaceId,
        context.actor.getAccountId(),
        // Use strong consistency in case we're coming from sign up or some other flow
        // which just updated our account state.
        {consistency: "StrongWithinCache"},
    );

    if (!currentAccount) {
        throw new PermissionDeniedError("Account isn\u2019t invited to the space");
    }

    if (currentAccount.initialData.space.state.type !== "InvitePending") {
        return redirect(`/home/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {spaceId});
}

export default function InviteRejectAndMarkAsSpamRoute() {
    const appContext = useAppContext();
    const reporter = useReporter();
    const {spaceId} = useLoaderDataWithSchema(LoaderSchema);

    const [rejectedComplete, setRejectedComplete] = useState(false);

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        void (async () => {
            try {
                await rejectSpaceAccountInviteAsSpam(appContext, {
                    spaceId,
                });

                setRejectedComplete(true);
            } catch (error) {
                reporter.displayError("Couldn\u2019t reject invite", error);
            }
        })();
    }, [appContext, reporter, spaceId]);

    return (
        <AuthenticationViewLayout>
            <Box width="full" minHeight="full" display="flex" flexDirection="column">
                <LogoWordmark size="32" />
                <Spacer space="2.5" />
                <Box color="grey-60" fontSize="100" userSelect="text" style={{lineHeight: 1.5}}>
                    This invite has been marked as spam and you will not be invited to this space
                    again.
                </Box>
                <Spacer space="2.5" />
                <Box color="grey-60" fontSize="100" userSelect="text" style={{lineHeight: 1.5}}>
                    You can close this tab now or open a{" "}
                    <Link url="/switch-space">different space</Link>.
                </Box>
                {/* For integration tests, we need some way to know the request completed */}
                {process.env.NODE_ENV !== "production" && rejectedComplete && (
                    <Box data-testid="RejectSpaceAccountInviteAsSpamCompleted" />
                )}
            </Box>
        </AuthenticationViewLayout>
    );
}
