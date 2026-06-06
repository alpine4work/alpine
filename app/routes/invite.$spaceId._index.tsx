import {redirect} from "@remix-run/node";
import {compareAsc} from "date-fns";
import {X} from "phosphor-react";
import {useMemo, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {renderAccountAvatarPile} from "~/client/web/accounts/account_avatar_pile_html.js";
import {useAccountRegistryForSpaceId} from "~/client/web/accounts/account_registry_context.js";
import {AuthenticationViewLayout} from "~/client/web/auth/authentication_view_layout.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {HtmlGeneratorView} from "~/client/web/helpers/html_generator_view.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {neverPromise} from "~/shared/helpers/async/never_promise.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {Store} from "~/shared/store/store.js";

const LoaderSchema = Schema.object({
    allAccounts: Schema.array(AccountModel.schema),
    currentAccount: AccountModel.schema,
    space: SpaceModel.schema(),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const [allAccounts, space] = await runAllPromises([
        expensivelyGetAllSpaceAccounts(context, spaceId, {
            allowInvitePending: true,
            consistency: "Strong",
        }),
        getSpace(context, spaceId, {
            consistency: "StrongWithinCache",
            allowInvitePending: true,
        }),
    ]);

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
    const spacingScale = useSpacingScale();
    const accountRegistry = useAccountRegistryForSpaceId(space.id);
    const currentAccountData = useStore(
        useMemo(
            () => accountRegistry.getAccountStore(currentAccount),
            [accountRegistry, currentAccount],
        ),
    );
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

    const accountPileHtml = useMemo(
        () =>
            renderAccountAvatarPile({
                spacingScale,
                size: "7",
                topPreviewAccount: "First",
                previewAccounts: accountPileAccounts,
            }),
        [accountPileAccounts, spacingScale],
    );

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
                <Box color="grey-60" fontSize="100" userSelect="text" style={{lineHeight: 1.5}}>
                    You&#x2019;ve been invited to join{" "}
                    <strong className={sprinkles({fontStyle: "bold", color: "grey-100"})}>
                        {space.name}
                    </strong>{" "}
                    on Alpine{inviterShortName ? ` by ${inviterShortName}` : ""}. Alpine is a shared
                    space where your team can work together.
                </Box>
                <Spacer space="5" />
                <HtmlGeneratorView
                    className={sprinkles({display: "flex", justifyContent: "flex-start"})}
                    htmlGenerator={accountPileHtml}
                />
                <Spacer space="12" />
                <Button
                    variant="accent"
                    fontSize="100"
                    height="9"
                    fullWidth
                    pressErrorTitle="Couldn&#x2019;t accept invite"
                    onPress={onAcceptInvite}
                >
                    Join {space.name}
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
                        url={`/invite/${space.id}/reject-and-mark-as-spam`}
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
                        description={`You won\u2019t be able to join ${space.name} later. This action can\u2019t be undone. We\u2019ll look into your report to help protect people using Alpine.`}
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
