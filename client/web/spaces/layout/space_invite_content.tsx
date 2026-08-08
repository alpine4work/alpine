import {compareAsc} from "date-fns/compareAsc";
import {useMemo, useState} from "react";
import {renderAccountAvatarPile} from "~/client/web/accounts/account_avatar_pile_html.js";
import {useAccountRegistryForSpaceId} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {HtmlGeneratorView} from "~/client/web/helpers/html_generator_view.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {Store} from "~/shared/store/store.js";

export function SpaceInviteContent({
    allAccounts,
    currentAccount,
    space,
    variant,
    onAcceptInvite,
    onReportAsSpam,
}: {
    allAccounts: ReadonlyArray<AccountModel>;
    currentAccount: AccountModel;
    space: SpaceModel;
    variant: "Authentication" | "Modal";
    onAcceptInvite: () => Promise<void>;
    onReportAsSpam: () => Promise<void>;
}) {
    const spacingScale = useSpacingScale();
    const accountRegistry = useAccountRegistryForSpaceId(space.id);
    const currentAccountData = useStore(
        useMemo(
            () => accountRegistry.getAccountStore(currentAccount),
            [accountRegistry, currentAccount],
        ),
    );
    const allAccountsDatas = useStore(
        useMemo(
            () => Store.many(allAccounts.map(account => accountRegistry.getAccountStore(account))),
            [accountRegistry, allAccounts],
        ),
    );
    const [shouldShowReportConfirmation, setShouldShowReportConfirmation] = useState(false);

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

    return (
        <>
            <Box color="grey-60" fontSize="100" userSelect="text" style={{lineHeight: 1.5}}>
                You&#x2019;ve been invited to join{" "}
                <strong className={sprinkles({fontStyle: "bold", color: "grey-100"})}>
                    {space.name}
                </strong>
                {variant === "Authentication" ? (
                    <>
                        {" "}
                        on Alpine{inviterShortName ? ` by ${inviterShortName}` : ""}. Alpine is a
                        shared space where your team can work together.
                    </>
                ) : (
                    <>{inviterShortName ? ` by ${inviterShortName}` : ""}.</>
                )}
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
                marginBottom="-1"
                fontSize="75"
                color="grey-50"
                userSelect="text"
                style={{lineHeight: 1.5}}
            >
                {variant === "Authentication" ? (
                    <>
                        Not ready to join?{" "}
                        <Link color="inherit" url="/switch-space">
                            Switch spaces
                        </Link>
                        .{" "}
                    </>
                ) : null}
                Don&#x2019;t recognize this invite?{" "}
                <Link
                    color="inherit"
                    url={`/invite/${space.id}/reject-and-mark-as-spam`}
                    onClick={event => {
                        event.preventDefault();
                        setShouldShowReportConfirmation(true);
                    }}
                >
                    Report
                </Link>
            </Box>
            {shouldShowReportConfirmation && (
                <ModalDialog
                    title="Report spam?"
                    description={`You won\u2019t be able to join ${space.name} later. This action can\u2019t be undone. We\u2019ll look into your report to help protect people using Alpine.`}
                    primaryButtonLabel="Report"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t report invite as spam"
                    onPrimaryButtonPress={onReportAsSpam}
                    cancelButtonLabel="Cancel"
                    onCancelButtonPress={() => setShouldShowReportConfirmation(false)}
                    onClose={() => setShouldShowReportConfirmation(false)}
                    initiallyFocus="Cancel"
                />
            )}
        </>
    );
}
