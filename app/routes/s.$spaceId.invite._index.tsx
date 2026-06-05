import {redirect} from "@remix-run/node";
import {compareAsc} from "date-fns";
import {X} from "phosphor-react";
import {useMemo, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {
    useAccountModel,
    useAccountRegistry,
} from "~/client/web/accounts/account_registry_context.js";
import {AuthenticationViewLayout} from "~/client/web/auth/authentication_view_layout.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

const LoaderSchema = Schema.object({
    allAccounts: Schema.array(AccountModel.schema),
    currentAccount: AccountModel.schema,
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? "");
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const allAccounts = await expensivelyGetAllSpaceAccounts(context, spaceId, {
        allowInvitePending: true,
        consistency: "Strong",
    });

    // This should be free. The `expensivelyGetAllSpaceAccounts()` call above should
    // have cached our account with strong consistency.
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
        return redirect(`/s/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {allAccounts, currentAccount});
}

export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    return [{title: `Join ${spaceRouteData?.space.name ?? "Space"}`}];
});

export default function HomeRoute() {
    const {allAccounts, currentAccount} = useLoaderDataWithSchema(LoaderSchema);
    const navigate = useNavigate();
    const appContext = useAppContext();
    const context = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    const currentAccountData = useAccountModel(currentAccount);
    const [shouldShowReportAsSpamDialog, setShouldShowReportAsSpamDialog] = useState(false);

    const allAccountsDatas = useStore(
        useMemo(
            () => Store.many(allAccounts.map(account => accountRegistry.getAccountStore(account))),
            [accountRegistry, allAccounts],
        ),
    );

    const {accountPileAccounts, inviterShortName} = useMemo(() => {
        const activeAccounts = allAccountsDatas
            .filter(
                account =>
                    (account.space.state.type === "Active" ||
                        account.space.state.type === "InvitePending") &&
                    !account.botId,
            )
            .sort((account1, account2) => {
                const isAccount1InvitePending = account1.space.state.type === "InvitePending";
                const isAccount2InvitePending = account2.space.state.type === "InvitePending";

                if (isAccount1InvitePending !== isAccount2InvitePending) {
                    return isAccount1InvitePending ? 1 : -1;
                }

                return compareAsc(account1.space.addedTime, account2.space.addedTime);
            });

        const invitePendingState = currentAccountData.space.state;
        const inviterAccount =
            invitePendingState.type === "InvitePending" && invitePendingState.inviterAccountId
                ? (activeAccounts.find(
                      account => account.id === invitePendingState.inviterAccountId,
                  ) ?? null)
                : null;

        const secondAccount = inviterAccount ?? null;
        const accountPileAccounts: ReadonlyArray<AccountModelData> = [
            currentAccountData,
            ...(secondAccount ? [secondAccount] : []),
            ...activeAccounts.filter(
                account => account.id !== currentAccountData.id && account.id !== secondAccount?.id,
            ),
        ].slice(0, 10);

        return {
            accountPileAccounts,
            inviterShortName: inviterAccount
                ? getAccountShortNameWithoutFullNameTooltip(inviterAccount)
                : null,
        };
    }, [allAccountsDatas, currentAccountData]);

    const onAcceptInvite = async () => {
        // We want to manually handle the invite acceptance here to avoid another redirect
        // to `/accept` and then home.
        await acceptSpaceAccountInvite(appContext, {
            spaceId: context.space.id,
        });

        const urlParams = new URLSearchParams(window.location.search);
        const to = urlParams.get("to");
        const destination = to ? `/s/${context.space.id}${to}` : `/s/${context.space.id}`;

        // We use from=invite to tell remix to revalidate our space loader data. This will
        // re-evalutate permissions and let the user immediately click on resources.
        await navigate(`${destination}?from=invite`, {replace: true});
    };

    const onReportAsSpam = async () => {
        await navigate(`/s/${context.space.id}/invite/reject-and-mark-as-spam`);
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
                        <SpaceAvatar space={context.space} size="10" />
                    </Box>
                </Box>
                <Spacer space="6" />
                <Box color="grey-60" fontSize="100" userSelect="text" style={{lineHeight: 1.5}}>
                    You&#x2019;ve been invited to join{" "}
                    <strong className={sprinkles({fontStyle: "bold", color: "grey-100"})}>
                        {context.space.name}
                    </strong>{" "}
                    on Alpine{inviterShortName ? ` by ${inviterShortName}` : ""}. Alpine is a shared
                    space where your team can work together.
                </Box>
                <Spacer space="5" />
                <Box display="flex" justifyContent="flex-start">
                    <AccountAvatarPile
                        size="7"
                        topPreviewAccount="First"
                        previewAccounts={accountPileAccounts}
                    />
                </Box>
                <Spacer space="12" />
                <Button
                    variant="accent"
                    fontSize="100"
                    height="9"
                    fullWidth
                    pressErrorTitle="Couldn&#x2019;t accept invite"
                    onPress={onAcceptInvite}
                >
                    Join {context.space.name}
                </Button>
                <Box
                    paddingTop="4"
                    fontSize="75"
                    color="grey-50"
                    userSelect="text"
                    style={{lineHeight: 1.5}}
                >
                    Not ready to join?{" "}
                    <Link color="inherit" url="/switch-space">
                        Switch spaces
                    </Link>
                    . Don&#x2019;t recognize this invite?{" "}
                    <Link
                        color="inherit"
                        url={`/s/${context.space.id}/invite/reject-and-mark-as-spam`}
                        onClick={event => {
                            event.preventDefault();
                            setShouldShowReportAsSpamDialog(true);
                        }}
                    >
                        Report
                    </Link>
                </Box>
                {shouldShowReportAsSpamDialog && (
                    <ModalDialog
                        title="Report spam?"
                        description={`You won\u2019t be able to join ${context.space.name} later. This action can\u2019t be undone. We\u2019ll look into your report to help protect people using Alpine.`}
                        primaryButtonLabel="Report"
                        primaryButtonPressErrorTitle="Couldn&#x2019;t report invite as spam"
                        onPrimaryButtonPress={onReportAsSpam}
                        cancelButtonLabel="Cancel"
                        onCancelButtonPress={() => setShouldShowReportAsSpamDialog(false)}
                        onClose={() => setShouldShowReportAsSpamDialog(false)}
                        initiallyFocus="Cancel"
                    />
                )}
            </Box>
        </AuthenticationViewLayout>
    );
}
