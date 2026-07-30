import {X} from "phosphor-react";
import {useEffect, useId, useMemo, useRef, useState} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ErrorDisplayMessageRenderer} from "~/client/web/design/error_display_message_renderer.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {defaultModalMaxWidth} from "~/client/web/design/modal.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/web/design/modal_with_buttons.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/web/design/text_area_with_auto_growing_height.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {generateEmailAddressForDevConsole} from "~/client/web/helpers/generate_email_address_for_dev_console.js";
import {getGlobalContext} from "~/client/web/helpers/global_context.js";
import {getErrorDisplayMessageForPartialInviteAccountsFailure} from "~/client/web/navigation/internal/get_error_display_message_for_partial_invite_accounts_failure.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {RpcCacheContext} from "~/client/web/rpc/rpc_cache.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {colorSchemeVars, fontSizes, sprinkles} from "~/client/web/styles/styles.js";
import {addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {
    expensivelyGetAllSpaceAccounts,
    inviteEmailAddressesToSpace,
} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";

type InviteAccountsModalProps = {
    "data-ownedby"?: string;
    initialEmailAddresses?: string;
    withoutRestoreFocus?: boolean;
    onClose: () => void;
    onNewAccounts?: (newAccounts: Array<{account: AccountModel; points: number}>) => void;
};

export function InviteAccountsModal({
    "data-ownedby": dataOwnedBy,
    initialEmailAddresses = "",
    withoutRestoreFocus,
    onClose,
    onNewAccounts,
}: InviteAccountsModalProps) {
    const titleFontSize = "300";
    const textInputPaddingY = "2.5";

    const titleId = useId();
    const descriptionId = useId();
    const [emailAddressesString, setEmailAddressesString] = useState(initialEmailAddresses);
    const appContext = useAppContext();
    const accountRegistry = useAccountRegistry();
    const {space} = useSpaceContext();
    const {locale, isAppleDevice} = useClientInfo();

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const modalRef = useRef<ModalWithButtonsRef>(null);

    useDevConsoleTool("invite", () => ({
        generateEmailAddress: (baseEmailAddress?: string) => {
            const emailAddress = generateEmailAddressForDevConsole(baseEmailAddress);
            setEmailAddressesString(emailAddressesString => {
                if (emailAddressesString.length === 0 || emailAddressesString.endsWith("\n")) {
                    return emailAddressesString + emailAddress;
                } else {
                    return emailAddressesString + "\n" + emailAddress;
                }
            });
            return emailAddress;
        },
    }));

    const emailAddresses = useMemo(
        () =>
            Array.from(
                new Set(
                    filterMapIterable(
                        // Comma separator, newline separator, space separator, semicolon separator, all
                        // should work for splitting up email addresses.
                        emailAddressesString.split(/[\s,;]+/),
                        emailAddress => {
                            emailAddress = emailAddress.trim();
                            if (emailAddress.length === 0) return;
                            return emailAddress;
                        },
                    ),
                ),
            ),
        [emailAddressesString],
    );

    const [inviteFailureError, setInviteFailureError] = useState<unknown>(null);

    const handleSendInvites = async () => {
        try {
            const {accounts, affinityPoints, errors} = await inviteEmailAddressesToSpace(
                appContext,
                {
                    emailAddresses,
                    spaceId: space.id,
                },
            );

            const newAccountsWithAffinityPoints: Array<{
                account: AccountModel;
                points: number;
            }> = [];

            // Incorporate our invited accounts into relevant stores.
            //
            // 1. Add the accounts to the `AccountRegistry`.
            // 2. Add the accounts via an optimistic update to the
            //    `expensivelyGetAllSpaceAccounts` RPC cache.
            batchStoreUpdates(() => {
                for (let index = 0; index < accounts.length; index++) {
                    const account = accounts[index]!;
                    const points = affinityPoints[index] ?? 0;

                    accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
                    newAccountsWithAffinityPoints.push({account, points});
                }

                const rpcCache = getGlobalContext(RpcCacheContext);

                const promiseResolver = createPromiseResolver();

                // Add an optimistic update that incorporates the newly invited accounts into the
                // `expensivelyGetAllSpaceAccounts` RPC cache. Once we detect that
                // `expensivelyGetAllSpaceAccounts` includes all invited accounts we resolve this
                // optimistic update.
                rpcCache.addOptimisticUpdate(
                    expensivelyGetAllSpaceAccounts,
                    {spaceId: space.id},
                    promiseResolver.promise,
                    output => {
                        const newAccountIds = new Set(
                            newAccountsWithAffinityPoints.map(({account}) => account.id),
                        );

                        const allAccountsWithAffinityPoints: Array<{
                            account: AccountModel;
                            points: number;
                        }> = [];

                        for (let index = 0; index < output.accounts.length; index++) {
                            const account = output.accounts[index]!;
                            const points = output.affinityPoints[index] ?? 0;

                            newAccountIds.delete(account.id);
                            allAccountsWithAffinityPoints.push({account, points});
                        }

                        // All invited accounts are now present in `expensivelyGetAllSpaceAccounts`. We
                        // don't need this optimistic update anymore!
                        if (newAccountIds.size === 0) {
                            promiseResolver.resolve();
                            return output;
                        }

                        for (const accountWithAffinityPoints of newAccountsWithAffinityPoints) {
                            if (!newAccountIds.has(accountWithAffinityPoints.account.id)) continue;
                            allAccountsWithAffinityPoints.push(accountWithAffinityPoints);
                        }

                        // Re-sort the accounts by affinity points. Will maintain the original sort order
                        // for accounts that don't have affinity points.
                        allAccountsWithAffinityPoints.sort((a, b) => b.points - a.points);

                        const accounts: Array<AccountModel> = [];
                        const affinityPoints: Array<number> = [];
                        let isAffinityPointsArrayDone = false;

                        for (const {account, points} of allAccountsWithAffinityPoints) {
                            accounts.push(account);
                            if (points <= 0) {
                                isAffinityPointsArrayDone = true;
                            } else if (!isAffinityPointsArrayDone) {
                                affinityPoints.push(points);
                            }
                        }

                        return {accounts, affinityPoints};
                    },
                );
            });

            onNewAccounts?.(newAccountsWithAffinityPoints);

            const totalErrors = Object.values(errors).reduce(
                (acc, errorAggregate) =>
                    acc +
                    (isReadonlyArray(errorAggregate) ? errorAggregate.length : errorAggregate.size),
                0,
            );

            if (totalErrors === 0) {
                onClose();
                return;
            }

            setInviteFailureError(
                new FailedPreconditionError("Failed to invite all addresses in the batch", {
                    displayMessage: errorDisplayMessage`${getErrorDisplayMessageForPartialInviteAccountsFailure(
                        locale,
                        accounts.length,
                        errors,
                    )}`,
                }),
            );

            const remainingEmailAddresses = emailAddresses.filter(
                email =>
                    errors.invalidEmailAddresses.includes(email) ||
                    errors.rejectedAsSpamEmailAddresses.includes(email) ||
                    errors.alreadyMemberEmailAddresses.includes(email) ||
                    errors.requiresAdminAccessEmailAddresses.includes(email) ||
                    errors.unexpectedFailureEmailAddresses.has(email),
            );

            for (const error of errors.unexpectedFailureEmailAddresses.values()) {
                appContext.react.reportRenderedError(error);
            }

            setEmailAddressesString(remainingEmailAddresses.join(", "));
        } catch (error) {
            setInviteFailureError(error);
        }
    };

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);
        inputElement.focus();
        inputElement.selectionStart = inputElement.selectionEnd = inputElement.value.length;
    }, []);

    return (
        <ModalWithButtons
            ref={modalRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClose={onClose}
            primaryButtonLabel="Send"
            isPrimaryButtonDisabled={emailAddresses.length === 0}
            primaryButtonPressErrorTitle="Couldn&#x2019;t send invites"
            onPrimaryButtonPress={handleSendInvites}
            onCancelButtonPress={onClose}
            withoutCloseButton={true}
            withoutCloseAfterPrimaryButtonPress={true}
            withoutRestoreFocus={withoutRestoreFocus}
            data-ownedby={dataOwnedBy}
            // Slightly larger max width so the modal doesn't perfectly overlap with the
            // settings page underneath.
            maxWidth={addRemLengths(defaultModalMaxWidth, "4")}
            buttonsPaddingX="7"
            buttonsPaddingBottom="5"
        >
            <Box paddingX="7" paddingY="7">
                <Box display="flex" flexDirection="column" gap="1">
                    <h2
                        id={titleId}
                        className={sprinkles({
                            userSelect: "text",
                            fontStyle: "bold",
                            fontSize: titleFontSize,
                        })}
                    >
                        Invite people
                    </h2>
                    <Box fontSize="75" color="grey-60" userSelect="text" id={descriptionId}>
                        These email addresses will be sent a link which lets them join your space.
                    </Box>
                </Box>
                <Spacer space="5" />
                <FocusRing offset="border" isVisibleWhenFocusWithin>
                    <Box position="relative" zIndex="0" borderRadius="1">
                        <Box
                            position="absolute"
                            inset="0"
                            pointerEvents="none"
                            zIndex="10"
                            borderRadius="1"
                            boxShadow="elevation-5-with-grey-10-border"
                        />
                        <Box
                            ref={useScrollbar()}
                            position="relative"
                            overflowY="auto"
                            style={{
                                maxHeight: addRemLengths(
                                    textInputPaddingY,
                                    `${parseRemLength(fontSizes["75"].lineHeight) * 10}rem`,
                                    textInputPaddingY,
                                ),
                            }}
                        >
                            <TextAreaWithAutoGrowingHeight
                                ref={inputRef}
                                aria-label="Emails"
                                value={emailAddressesString}
                                onChange={event =>
                                    setEmailAddressesString(event.currentTarget.value)
                                }
                                placeholder="jane@company.com, john@company.com, …"
                                className={sprinkles({
                                    width: "full",
                                    paddingX: "3",
                                    paddingY: textInputPaddingY,
                                    fontSize: "75",
                                    borderRadius: "1",
                                    backgroundColor: "transparent",
                                })}
                                style={{
                                    minHeight: addRemLengths(
                                        textInputPaddingY,
                                        `${parseRemLength(fontSizes["75"].lineHeight) * 5}rem`,
                                        textInputPaddingY,
                                    ),
                                    // Render contextual alternate glyphs. Particularly important that we render
                                    // the right "@" for emails.
                                    // eslint-disable-next-line cyberworlds/string-quotes
                                    fontFeatureSettings: '"calt" on',
                                }}
                                onKeyDown={event => {
                                    if (
                                        event.key === "Enter" &&
                                        !event.altKey &&
                                        !event.shiftKey &&
                                        // Cmd+Enter on MacOS platforms should trigger the callback Ctrl+Enter on non-MacOS
                                        // platforms should trigger the callback
                                        (isAppleDevice ? event.metaKey : event.ctrlKey)
                                    ) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        assertExists(modalRef.current).pressPrimaryButton();
                                        return;
                                    }
                                }}
                            />
                        </Box>
                    </Box>
                </FocusRing>
                {inviteFailureError ? (
                    <SettingInvitePeopleModalError error={inviteFailureError} />
                ) : null}
            </Box>
        </ModalWithButtons>
    );
}

function SettingInvitePeopleModalError({error}: {error: unknown}) {
    return (
        <>
            <Spacer space="2.5" />
            <Box display="flex" alignItems="flex-start" gap="1">
                <Box
                    display="flex"
                    alignItems="center"
                    style={{height: fontSizes["75"].lineHeight}}
                    paddingTop="0.5"
                >
                    <X color={colorSchemeVars["red-50"]} size={spacing["3"]} weight="bold" />
                </Box>
                <Box
                    color="grey-90"
                    userSelect="text"
                    style={{
                        // Defend against a lot of errors. Don't let the modal grow infinitely since the
                        // modal can't scroll.
                        //
                        // Truncate after 5 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 5,
                        lineClamp: 5,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                        // Render contextual alternate glyphs. Particularly important that we render
                        // the right "@" for emails.
                        // eslint-disable-next-line cyberworlds/string-quotes
                        fontFeatureSettings: '"calt" on',
                    }}
                    data-testid={
                        process.env.NODE_ENV === "production"
                            ? undefined
                            : "InviteErroredEmailAddresses"
                    }
                >
                    <ErrorDisplayMessageRenderer error={error} fontSize="75" color="red-50" />
                </Box>
            </Box>
        </>
    );
}
