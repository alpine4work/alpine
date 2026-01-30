import {useEffect, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {
    AuthenticationSignInOneTimePasswordState,
    AuthenticationSignUpOneTimePasswordState,
    AuthenticationState,
} from "~/client/web/auth/authentication_state.js";
import {
    Form,
    FormRef,
    formErrorFontSize,
    formErrorMarginTop,
} from "~/client/web/auth/internal/form.js";
import {navigateAfterSignInOrSignUp} from "~/client/web/auth/internal/navigate_after_sign_in_or_sign_up.js";
import {
    OneTimePasswordInput,
    OneTimePasswordInputRef,
} from "~/client/web/auth/internal/one_time_password_input.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    AuthSignInOrSignUpInputSchema,
    AuthSignInOrSignUpOutputSchema,
} from "~/shared/auth/auth_sign_in_or_sign_up_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export function AuthenticationSignInOrSignUpOneTimePasswordView({
    state,
    onStateChange,
}: {
    state: AuthenticationSignInOneTimePasswordState | AuthenticationSignUpOneTimePasswordState;
    onStateChange: (state: AuthenticationState) => void;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const formRef = useRef<FormRef>(null);
    const inputRef = useRef<OneTimePasswordInputRef>(null);

    // Immediately focus the one time password input when the component mounts.
    // Only on desktop when focusing the input won't open a giant keyboard.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (platform === "desktop") {
            const inputElement = assertExists(inputRef.current);
            inputElement.focus();
        }
    }, [platform]);

    const [oneTimePassword, setOneTimePassword] = useState("");

    const isDisabled = oneTimePassword.length !== 6;

    // If we switch from `isDisabled` true to `isDisabled` false then submit the
    // form automatically.
    const isDisabledRef = useRef(isDisabled);
    useEffect(() => {
        if (isDisabled === isDisabledRef.current) return;
        isDisabledRef.current = isDisabled;

        if (!isDisabled) {
            assertExists(formRef.current).submit();
        }
    }, [isDisabled]);

    const {submitErrorTitle, buttonLabel, subheadingEnd} = {
        SignInOneTimePassword: {
            submitErrorTitle: "Couldn\u2019t sign in",
            buttonLabel: "Sign in",
            subheadingEnd: "sign in",
        },
        SignUpOneTimePassword: {
            submitErrorTitle: "Couldn\u2019t sign up",
            buttonLabel: "Sign up",
            subheadingEnd: "finish signing up",
        },
    }[state.type];

    return (
        <Form
            ref={formRef}
            submitErrorTitle={submitErrorTitle}
            onSubmit={async () => {
                let openSpaceId: SpaceId | null = null;

                try {
                    let route: string;

                    switch (state.type) {
                        case "SignInOneTimePassword": {
                            route = "/api/auth/sign-in";
                            break;
                        }
                        case "SignUpOneTimePassword": {
                            route = "/api/auth/sign-up";
                            break;
                        }
                        default:
                            throw exhaustive(state);
                    }

                    ({openSpaceId} = await fetchWithTracer(
                        context.tracer.getTracer(),
                        route,
                        {
                            serviceName: "AppService",
                            route,
                            method: "POST",
                            body: JSON.stringify(
                                AuthSignInOrSignUpInputSchema.serialize({
                                    emailAddress: state.emailAddress,
                                    oneTimePassword,
                                }),
                            ),
                        },
                        async response => {
                            const output = AuthSignInOrSignUpOutputSchema.deserialize(
                                await response.json(),
                            );

                            if (!output.ok) {
                                throw output.error;
                            }

                            return output;
                        },
                    ));
                } catch (error) {
                    // Clear the one time password input
                    setOneTimePassword("");
                    inputRef.current?.focus();

                    throw error;
                }

                if (platform === "mobile" && state.type === "SignUpOneTimePassword") {
                    onStateChange({
                        type: "AfterSignUpMobileInterstitial",
                        emailAddress: state.emailAddress,
                        openSpaceId,
                    });
                    return;
                }

                await navigateAfterSignInOrSignUp({
                    navigate,
                    searchParams,
                    openSpaceId,
                });
            }}
            button={
                <Button
                    variant="accent"
                    fullWidth={true}
                    fontSize="100"
                    height="9"
                    isDisabled={isDisabled}
                >
                    {buttonLabel}
                </Button>
            }
            afterButton={
                state.type === "SignUpOneTimePassword" && (
                    <Box
                        paddingTop={formErrorMarginTop}
                        fontSize={formErrorFontSize}
                        color="grey-50"
                        userSelect="text"
                        style={{lineHeight: 1.5}}
                    >
                        By signing up, you agree to our{" "}
                        <Link url="https://www.alpine.inc/legal/terms-of-service" newTab>
                            Terms&nbsp;of&nbsp;Service
                        </Link>{" "}
                        and{" "}
                        <Link url="https://www.alpine.inc/legal/privacy-policy" newTab>
                            Privacy&nbsp;Policy
                        </Link>
                        .
                    </Box>
                )
            }
        >
            <LogoWordmark size="32" />
            <Spacer space="2.5" />
            <Box fontSize="100" color="grey-60" userSelect="text">
                We sent a passcode to{" "}
                <span
                    className={sprinkles({
                        fontStyle: "bold",
                        color: "grey-100",
                    })}
                    style={{wordBreak: "break-word"}}
                >
                    {state.emailAddress}
                </span>
                . Type the code here to {subheadingEnd}.
            </Box>
            <Spacer space="8" />
            <OneTimePasswordInput
                ref={inputRef}
                oneTimePassword={oneTimePassword}
                onOneTimePasswordChange={setOneTimePassword}
            />
            <Spacer space="8" />
        </Form>
    );
}
