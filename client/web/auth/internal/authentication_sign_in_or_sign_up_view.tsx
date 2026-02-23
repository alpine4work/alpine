import {useEffect, useMemo, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {
    AuthenticationSignInState,
    AuthenticationSignUpState,
    AuthenticationState,
} from "~/client/web/auth/authentication_state.js";
import {authenticationViewPaddingTop} from "~/client/web/auth/internal/authentication_shared_styles.js";
import {Form, formErrorFontSize, formErrorMarginTop} from "~/client/web/auth/internal/form.js";
import {validateEmailAddressForAuthentication} from "~/client/web/auth/internal/validate_email_address_for_authentication.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {generateEmailAddressForDevConsole} from "~/client/web/helpers/generate_email_address_for_dev_console.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {
    regenerateOneTimePasswordSignIn,
    signUpAccountWithEmailAddress,
} from "~/shared/rpc/accounts_rpc_definitions.js";

export function AuthenticationSignInOrSignUpView({
    state,
    onStateChange,
}: {
    state: AuthenticationSignInState | AuthenticationSignUpState;
    onStateChange: (state: AuthenticationState) => void;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Get the initial email address from `searchParams` if available. For example
    //  the `accountEmailAddressNotFoundErrorDisplayMessage()` error uses this.
    const [emailAddress, setEmailAddress] = useState(() => searchParams.get("email") ?? "");

    // Delete the `email` search param now that we've used it to initialize state.
    const hasEmailSearchParam = searchParams.has("email");
    useEffect(() => {
        if (hasEmailSearchParam) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("email");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [hasEmailSearchParam, setSearchParams]);

    const {isEmailAddressValid: isEmailAddressValidForButton, isEmailAddressPossiblyGeneric} =
        useMemo(() => validateEmailAddressForAuthentication(emailAddress), [emailAddress]);

    const {
        subheading,
        buttonLabel,
        submitErrorTitle,
        alternativeQuestion,
        alternativeLinkLabel,
        alternativeLinkUrl,
    } = {
        SignIn: {
            subheading: "Sign in. Welcome back",
            buttonLabel: "Sign in",
            submitErrorTitle: "Couldn\u2019t sign in",
            alternativeQuestion: "Don\u2019t have an account yet?",
            alternativeLinkLabel: "Sign up",
            alternativeLinkUrl: "/auth/sign-up",
        },
        SignUp: {
            subheading: "Sign up with your work email",
            buttonLabel: "Sign up",
            submitErrorTitle: "Couldn\u2019t sign up",
            alternativeQuestion: "Already have an account?",
            alternativeLinkLabel: "Sign in",
            alternativeLinkUrl: "/auth/sign-in",
        },
    }[state.type];

    useDevConsoleTool("auth", () => ({
        generateEmailAddress: (baseEmailAddress?: string) => {
            const emailAddress = generateEmailAddressForDevConsole(baseEmailAddress);
            setEmailAddress(emailAddress);
            return emailAddress;
        },
    }));

    return (
        <Box width="full" minHeight="full" display="flex" flexDirection="column">
            <Box flexShrink="0">
                <Form
                    submitErrorTitle={submitErrorTitle}
                    onSubmit={async () => {
                        const validatedEmailAddress = emailAddress.toLowerCase().trim();

                        if (!isEmailAddressValid(validatedEmailAddress)) {
                            throw new InvalidArgumentError("Invalid email address", {
                                displayMessage: errorDisplayMessage`\u201C${emailAddress}\u201D isn\u2019t an email address. Try again with an email address like \u201Cname@company.com\u201D.`,
                            });
                        }

                        switch (state.type) {
                            case "SignIn": {
                                const {accountId, hasNotSignedUp} =
                                    await regenerateOneTimePasswordSignIn(context, {
                                        emailAddress: validatedEmailAddress,
                                        toSearchParam: searchParams.get("to"),
                                    });

                                // If the account hasn't signed up yet then we'll redirect them to the sign
                                // up flow. We can't use `onStateChange` because we're changing the route
                                // variant here from `sign-in` to `sign-up`. So we have special handling for
                                // `sign-up` with an email address.
                                if (hasNotSignedUp) {
                                    const urlPath = new UrlPath("/auth/sign-up");

                                    // Keep any existing search params.
                                    for (const [key, value] of searchParams) {
                                        urlPath.searchParams.set(key, value);
                                    }

                                    // Navigate to `<AuthenticationSignUpProfileView>` for the account
                                    urlPath.searchParams.set(
                                        "profile",
                                        `${accountId},${emailAddress}`,
                                    );

                                    await navigate(urlPath.toString());
                                    return;
                                }

                                onStateChange({
                                    type: "SignInOneTimePassword",
                                    accountId,
                                    emailAddress: validatedEmailAddress,
                                });
                                break;
                            }
                            case "SignUp": {
                                const {accountId} = await signUpAccountWithEmailAddress(context, {
                                    emailAddress: validatedEmailAddress,
                                    toSearchParam: searchParams.get("to"),
                                });

                                onStateChange({
                                    type: "SignUpProfile",
                                    accountId,
                                    emailAddress: validatedEmailAddress,
                                });
                                break;
                            }
                            default:
                                throw exhaustive(state);
                        }
                    }}
                    button={
                        <Button
                            variant="accent"
                            fullWidth={true}
                            fontSize="100"
                            height="9"
                            isDisabled={!isEmailAddressValidForButton}
                        >
                            {buttonLabel}
                        </Button>
                    }
                    afterButton={
                        state.type === "SignUp" &&
                        isEmailAddressPossiblyGeneric && (
                            <Box
                                paddingTop={formErrorMarginTop}
                                fontSize={formErrorFontSize}
                                color="grey-50"
                                userSelect="text"
                                style={{lineHeight: 1.5}}
                            >
                                Tip: Using your work email lets us automatically connect you with
                                your coworkers
                            </Box>
                        )
                    }
                >
                    <LogoWordmark size="32" />
                    <Spacer space="2.5" />
                    <Box fontSize="100" color="grey-60" userSelect="text">
                        {subheading}
                    </Box>
                    <Spacer space="8" />
                    <TextInput
                        formName="emailAddress"
                        label="Email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="name@company.com"
                        fontSize="100"
                        value={emailAddress}
                        onChange={setEmailAddress}
                    />
                    <Spacer space="5" />
                </Form>
            </Box>
            <Box flexGrow="1" minHeight={authenticationViewPaddingTop} />
            <Box fontSize="100" color="grey-60">
                {alternativeQuestion} <Link url={alternativeLinkUrl}>{alternativeLinkLabel}</Link>
            </Box>
        </Box>
    );
}
