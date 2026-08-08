import {Plus, X} from "phosphor-react";
import {Ref, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {
    AuthenticationSignUpInviteState,
    AuthenticationState,
} from "~/client/web/auth/authentication_state.js";
import {AuthenticationReactionPartyPreview} from "~/client/web/auth/internal/authentication_reaction_party_preview.js";
import {Form, formErrorFontSize, formErrorMarginTop} from "~/client/web/auth/internal/form.js";
import {
    authenticationSignUpInviteEmailAddressMaxCount,
    authenticationSignUpInviteEmailAddressMinCount,
    useAuthenticationSignUpInviteEmailAddresses,
} from "~/client/web/auth/internal/use_authentication_sign_up_invite_email_addresses.js";
import {validateEmailAddressForAuthentication} from "~/client/web/auth/internal/validate_email_address_for_authentication.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {inputPlaceholderStyles} from "~/client/web/styles/styles.js";
import {getEmailDomainForAutoAddSpaceAccounts} from "~/shared/accounts/get_email_domain_for_auto_add_space_accounts.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.open_source.js";

export function AuthenticationSignUpInviteView({
    state,
    onStateChange,
}: {
    state: AuthenticationSignUpInviteState;
    onStateChange: (state: AuthenticationState, options: {spanData: TracerEventData}) => void;
}) {
    const autoAddAccountsFromEmailDomain = getEmailDomainForAutoAddSpaceAccounts(
        state.emailAddress,
    );

    const [inviteEmailAddresses, setInviteEmailAddresses] =
        useAuthenticationSignUpInviteEmailAddresses(state.emailAddress);

    const actualInviteEmailAddresses = filterMapArray(inviteEmailAddresses, inviteEmailAddress => {
        inviteEmailAddress = inviteEmailAddress.trim();
        if (inviteEmailAddress.length === 0) return;

        if (autoAddAccountsFromEmailDomain && !inviteEmailAddress.includes("@"))
            return `${inviteEmailAddress}@${autoAddAccountsFromEmailDomain}`;

        return inviteEmailAddress;
    });

    const lastInputRef = useRef<HTMLInputElement>(null);

    const [showSkipConfirmationDialog, setShowSkipConfirmationDialog] = useState(false);

    return (
        <Form
            submitErrorTitle="Couldn&#x2019;t sign up"
            onSubmit={async () => {
                const validatedInviteEmailAddresses = actualInviteEmailAddresses.map(
                    inviteEmailAddress => {
                        if (!isEmailAddressValid(inviteEmailAddress)) {
                            throw new InvalidArgumentError("Invalid email address", {
                                displayMessage: errorDisplayMessage`\u201C${inviteEmailAddress}\u201D isn\u2019t a valid email address.`,
                            });
                        }
                        return inviteEmailAddress;
                    },
                );

                onStateChange(
                    {
                        type: "SignUpOneTimePassword",
                        accountId: state.accountId,
                        emailAddress: state.emailAddress,
                        inviteEmailAddresses: validatedInviteEmailAddresses,
                    },
                    {
                        spanData: {
                            auth: {
                                signUp: {
                                    autoAddAccountsFromEmailDomain:
                                        autoAddAccountsFromEmailDomain ?? undefined,
                                    inviteEmailAddressCount: validatedInviteEmailAddresses.length,
                                },
                            },
                        },
                    },
                );
            }}
            button={
                <Button
                    variant="accent"
                    shouldSubmitForm={true}
                    fullWidth={true}
                    fontSize="100"
                    height="9"
                    isDisabled={
                        actualInviteEmailAddresses.length === 0 ||
                        actualInviteEmailAddresses.every(
                            inviteEmailAddress =>
                                !validateEmailAddressForAuthentication(inviteEmailAddress)
                                    .isEmailAddressValid,
                        )
                    }
                >
                    Invite
                </Button>
            }
            afterButton={
                <Box
                    paddingTop={formErrorMarginTop}
                    fontSize={formErrorFontSize}
                    color="grey-50"
                    userSelect="text"
                    style={{lineHeight: 1.5}}
                >
                    Alpine is best with your coworkers.{" "}
                    <Link
                        color="inherit"
                        url="/auth/sign-up"
                        onClick={event => {
                            event.preventDefault();
                            setShowSkipConfirmationDialog(true);
                        }}
                    >
                        Skip for now
                    </Link>
                </Box>
            }
        >
            <LogoWordmark size="32" />
            <Spacer space="2.5" />
            <Box fontSize="100" color="grey-60" userSelect="text">
                Who do you work with? We&#x2019;ll send the people you list an email with a link to
                join you.
            </Box>
            <Spacer space="8" />
            <AuthenticationReactionPartyPreview
                emailAddress={state.emailAddress}
                reactionCharacter={state.reactionCharacter}
            />
            <Spacer space="8" />
            <Box display="flex" flexDirection="column" gap="2.5">
                {inviteEmailAddresses.map((inviteEmailAddress, index) => (
                    <AuthenticationSignUpInviteViewEmailAddressInput
                        key={index}
                        ref={index === inviteEmailAddresses.length - 1 ? lastInputRef : undefined}
                        emailAddress={inviteEmailAddress}
                        onEmailAddressChange={inviteEmailAddress => {
                            const newInviteEmailAddresses = [...inviteEmailAddresses];
                            newInviteEmailAddresses[index] = inviteEmailAddress;
                            setInviteEmailAddresses(newInviteEmailAddresses);
                        }}
                        autoAddAccountsFromEmailDomain={autoAddAccountsFromEmailDomain}
                    />
                ))}
            </Box>
            <Spacer space="1.5" />
            <Box display="flex">
                <Button
                    variant="quieter"
                    fontSize="100"
                    height="9"
                    paddingX="2.5"
                    // Match focus ring offset of `<TextInput>`
                    focusRingOffset="border"
                    iconPlacement="end"
                    icon={<Plus weight="bold" />}
                    // Add some protection against spammers by limiting to 10 invites during sign up.
                    isDisabled={
                        inviteEmailAddresses.length >=
                        authenticationSignUpInviteEmailAddressMaxCount
                    }
                    onPress={() => {
                        // We need `flushSync()` to make sure `lastInputRef` is set correctly before
                        // focusing it.
                        flushSync(() => {
                            setInviteEmailAddresses([...inviteEmailAddresses, ""]);
                        });

                        assertExists(lastInputRef.current).focus();
                    }}
                >
                    Add person
                </Button>
                {inviteEmailAddresses.length > authenticationSignUpInviteEmailAddressMinCount && (
                    <Button
                        variant="quieter"
                        fontSize="100"
                        height="9"
                        paddingX="2.5"
                        // Match focus ring offset of `<TextInput>`
                        focusRingOffset="border"
                        iconPlacement="end"
                        icon={<X weight="bold" />}
                        isDisabled={
                            inviteEmailAddresses[inviteEmailAddresses.length - 1]!.trim().length > 0
                        }
                        onPress={() => {
                            const newInviteEmailAddresses = [...inviteEmailAddresses];
                            newInviteEmailAddresses.pop();
                            setInviteEmailAddresses(newInviteEmailAddresses);
                        }}
                    >
                        Remove person
                    </Button>
                )}
            </Box>
            <Spacer space="10" />
            {showSkipConfirmationDialog && (
                <ModalDialog
                    title={
                        actualInviteEmailAddresses.length === 0
                            ? "Your team will thank you"
                            : `Skip inviting ${actualInviteEmailAddresses.length === 1 ? actualInviteEmailAddresses[0]! : `${actualInviteEmailAddresses.length} people`}?`
                    }
                    description="Solo, Alpine is a notes app. With your team, your conversations, docs, and tasks finally live in one place."
                    onClose={() => setShowSkipConfirmationDialog(false)}
                    primaryButtonLabel="Skip for now"
                    primaryButtonVariant="quiet"
                    onPrimaryButtonPress={() => {
                        onStateChange(
                            {
                                type: "SignUpOneTimePassword",
                                accountId: state.accountId,
                                emailAddress: state.emailAddress,
                                inviteEmailAddresses: [],
                            },
                            {
                                spanData: {
                                    auth: {
                                        signUp: {
                                            autoAddAccountsFromEmailDomain:
                                                autoAddAccountsFromEmailDomain ?? undefined,
                                            inviteEmailAddressCount: 0,
                                        },
                                    },
                                },
                            },
                        );
                    }}
                    cancelButtonLabel="Go back"
                    initiallyFocus="Cancel"
                />
            )}
        </Form>
    );
}

function AuthenticationSignUpInviteViewEmailAddressInput({
    ref,
    emailAddress,
    onEmailAddressChange,
    autoAddAccountsFromEmailDomain,
}: {
    ref?: Ref<HTMLInputElement>;
    emailAddress: string;
    onEmailAddressChange: (emailAddress: string) => void;
    autoAddAccountsFromEmailDomain: string | null;
}) {
    const spacingScale = useSpacingScale();

    const [autoAddAccountsFromEmailDomainRef, autoAddAccountsFromEmailDomainSize] =
        useResizeObserver();

    const paddingX = "2.5";

    return (
        <Box position="relative" zIndex="0">
            {autoAddAccountsFromEmailDomain && !emailAddress.includes("@") && (
                <Box
                    pointerEvents="none"
                    position="absolute"
                    top="0"
                    bottom="0"
                    left="0"
                    width="full"
                    overflow="hidden"
                    display="flex"
                    alignItems="center"
                    paddingX={paddingX}
                >
                    <Box
                        flexShrink="1"
                        minWidth="flex-fit"
                        aria-hidden={true}
                        fontSize="100"
                        style={emailAddress.length === 0 ? inputPlaceholderStyles : undefined}
                        opacity="0"
                    >
                        {emailAddress.length === 0 ? "name" : emailAddress}
                    </Box>
                    <Box ref={autoAddAccountsFromEmailDomainRef} flexShrink="0" fontSize="100">
                        @{autoAddAccountsFromEmailDomain}
                    </Box>
                </Box>
            )}
            <TextInputWithoutLabel
                ref={ref}
                aria-label="Invite email address"
                fontSize="100"
                inputMode="email"
                autoComplete="off"
                placeholder={autoAddAccountsFromEmailDomain ? "name" : "name@company.com"}
                paddingRight={
                    autoAddAccountsFromEmailDomain &&
                    !emailAddress.includes("@") &&
                    autoAddAccountsFromEmailDomainSize
                        ? convertRemLengthToPx("2", spacingScale) +
                          autoAddAccountsFromEmailDomainSize.width +
                          convertRemLengthToPx("2.5", spacingScale)
                        : undefined
                }
                value={emailAddress}
                onChange={onEmailAddressChange}
            />
        </Box>
    );
}
