import {redirect} from "@remix-run/node";
import {X} from "phosphor-react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {AuthenticationViewLayout} from "~/client/web/auth/authentication_view_layout.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {SpaceInviteContent} from "~/client/web/spaces/layout/space_invite_content.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {loadSpaceInviteContent} from "~/server/spaces/load_space_invite_content.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {neverPromise} from "~/shared/helpers/async/never_promise.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    allAccounts: Schema.array(AccountModel.schema),
    currentAccount: AccountModel.schema,
    space: SpaceModel.schema(),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const {allAccounts, currentAccount, space} = await loadSpaceInviteContent(context, spaceId);

    if (currentAccount.initialData.space.state.type !== "InvitePending") {
        return redirect(`/home/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {allAccounts, currentAccount, space});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {space}}) => [
    {title: `Join ${space.name}`},
]);

export default function HomeRoute() {
    const {allAccounts, currentAccount, space} = useLoaderDataWithSchema(LoaderSchema);
    const navigate = useNavigate();
    const appContext = useAppContext();

    const onAcceptInvite = async () => {
        // We want to manually handle the invite acceptance here to avoid another redirect
        // to `/accept` and then home.
        await acceptSpaceAccountInvite(appContext, {
            spaceId: space.id,
        });

        const urlParams = new URLSearchParams(window.location.search);
        const to = urlParams.get("to");

        const homePath = `/home/${space.id}`;

        // To navigate to a route that doesn't include a `$spaceId` variable we need to
        // perform a full page navigation because Remix can't make `?_data` requests to the
        // space layout route. The space layout route must be run alongside a different
        // route which discovers the `SpaceId`.
        if (to?.startsWith("/") && to !== homePath) {
            window.location.assign(to);
            await neverPromise;
            return;
        }

        await navigate(homePath, {replace: true});
    };

    const onReportAsSpam = async () => {
        await navigate(`/invite/${space.id}/reject-and-mark-as-spam`);
    };

    return (
        <AuthenticationViewLayout>
            <Box width="full" minHeight="full" display="flex" flexDirection="column">
                <Box display="flex" alignItems="center" gap="4">
                    <LogoWordmark size="32" />
                    <Box color="grey-40" display="flex" alignItems="center" userSelect="none">
                        <X size={spacing["4"]} weight="bold" />
                    </Box>
                    <Box marginTop="-0.5">
                        <SpaceAvatar space={space} size="10" />
                    </Box>
                </Box>
                <Spacer space="6" />
                <SpaceInviteContent
                    allAccounts={allAccounts}
                    currentAccount={currentAccount}
                    space={space}
                    variant="Authentication"
                    onAcceptInvite={onAcceptInvite}
                    onReportAsSpam={onReportAsSpam}
                />
            </Box>
        </AuthenticationViewLayout>
    );
}
