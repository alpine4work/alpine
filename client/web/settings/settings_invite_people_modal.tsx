import {X} from "phosphor-react";
import {useId, useMemo, useState} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ErrorDisplayMessageRenderer} from "~/client/web/design/error_display_message_renderer.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {defaultModalMaxWidth} from "~/client/web/design/modal.js";
import {ModalWithButtons} from "~/client/web/design/modal_with_buttons.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/web/design/text_area_with_auto_growing_height.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {getErrorDisplayMessageForPartialInvitePeopleFailure} from "~/client/web/settings/internal/get_error_display_message_for_partial_invite_people_failure.js";
import {colorSchemeVars, fontSizes, sprinkles} from "~/client/web/styles/styles.js";
import {addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {inviteEmailAddressesToSpace} from "~/shared/rpc/spaces_rpc_definitions.js";

type SettingsInvitePeopleModalProps = {
    spaceId: SpaceId;
    onClose: () => void;
    onSuccess: () => void;
};

export function SettingsInvitePeopleModal({
    spaceId,
    onClose,
    onSuccess,
}: SettingsInvitePeopleModalProps) {
    const titleFontSize = "300";
    const textInputPaddingY = "2.5";

    const titleId = useId();
    const descriptionId = useId();
    const [batchEmailString, setBatchEmailString] = useState("");
    const [hadSuccessfulInvites, setHadSuccessfulInvites] = useState(false);
    const appContext = useAppContext();
    const accountRegistry = useAccountRegistry();
    const {locale} = useClientInfo();

    const emailAddresses = useMemo(
        () =>
            Array.from(
                new Set(
                    filterMapIterable(
                        // Comma separator, newline separator, space separator, semicolon separator,
                        // all should work for splitting up email addresses.
                        batchEmailString.split(/[\s,;]+/),
                        emailAddress => {
                            emailAddress = emailAddress.trim();
                            if (emailAddress.length === 0) return;
                            return emailAddress;
                        },
                    ),
                ),
            ),
        [batchEmailString],
    );

    const [inviteFailureError, setInviteFailureError] = useState<unknown>(null);

    const handleSendInvites = async () => {
        try {
            const {accounts, errors} = await inviteEmailAddressesToSpace(appContext, {
                emailAddresses,
                spaceId,
            });

            // We keep a separate count of invited accounts and if there were any previously
            // successful invites. This is useful to know if we should call `onSuccess` or not,
            // while still being able to show the last requested success count.
            if (accounts.length > 0) {
                setHadSuccessfulInvites(true);
            }

            for (const account of accounts) {
                accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
            }

            const totalErrors = Object.values(errors).reduce(
                (acc, errorAggregate) =>
                    acc +
                    (errorAggregate instanceof Array ? errorAggregate.length : errorAggregate.size),
                0,
            );

            if (totalErrors === 0) {
                onSuccess();
                // We handle closing the modal ourself
                onClose();
                return;
            }

            setInviteFailureError(
                new FailedPreconditionError("Failed to invite all addresses in the batch", {
                    displayMessage: errorDisplayMessage`${getErrorDisplayMessageForPartialInvitePeopleFailure(
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
                    errors.unexpectedFailureEmailAddresses.has(email),
            );

            for (const error of errors.unexpectedFailureEmailAddresses.values()) {
                appContext.react.reportRenderedError(error);
            }

            setBatchEmailString(remainingEmailAddresses.join(", "));
        } catch (error) {
            setInviteFailureError(error);
        }
    };

    const onCloseAndCheckSuccess = () => {
        // We only want to call `onSuccess` if we had successful invites and are closing the modal.
        // If there were errors, we show them in the UI and do not call `onSuccess` immediately.
        if (hadSuccessfulInvites) {
            onSuccess();
        }

        onClose();
    };

    return (
        <ModalWithButtons
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClose={onCloseAndCheckSuccess}
            primaryButtonLabel="Send"
            isPrimaryButtonDisabled={emailAddresses.length === 0}
            primaryButtonPressErrorTitle="Couldn\u2019t send invites"
            onPrimaryButtonPress={handleSendInvites}
            onCancelButtonPress={onCloseAndCheckSuccess}
            withoutCloseButton={true}
            withoutCloseAfterPrimaryButtonPress={true}
            // Slightly larger max width so the modal doesn't perfectly overlap with the
            // settings page underneath.
            maxWidth={addRemLengths(defaultModalMaxWidth, "4")}
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
                        Add email addresses and they&#x2019;ll be sent a link to join your space.
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
                                aria-label="Emails"
                                value={batchEmailString}
                                onChange={event => setBatchEmailString(event.currentTarget.value)}
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
                                    // eslint-disable-next-line string-quotes
                                    fontFeatureSettings: '"calt" on',
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
                        // Defend against a lot of errors. Don't let the modal grow infinitely since
                        // the modal can't scroll.
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
                        // eslint-disable-next-line string-quotes
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
