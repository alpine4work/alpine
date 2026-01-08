import {useEffect, useRef, useState} from "react";
import {
    AuthenticationSignInOneTimePasswordState,
    AuthenticationSignUpOneTimePasswordState,
} from "~/client/web/auth/authentication_state.js";
import {Form, FormRef} from "~/client/web/auth/internal/form.js";
import {
    OneTimePasswordInput,
    OneTimePasswordInputRef,
} from "~/client/web/auth/internal/one_time_password_input.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
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
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export function AuthenticationSignInOrSignUpOneTimePasswordView({
    state,
}: {
    state: AuthenticationSignInOneTimePasswordState | AuthenticationSignUpOneTimePasswordState;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const navigate = useNavigate();

    const formRef = useRef<FormRef>(null);
    const inputRef = useRef<OneTimePasswordInputRef>(null);

    // Immediately focus the one time password input when the component mounts on
    // desktop when focusing the input won't open a giant keyboard.
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
            submitErrorTitle: "Couldn’t sign in",
            buttonLabel: "Sign in",
            subheadingEnd: "sign in",
        },
        SignUpOneTimePassword: {
            submitErrorTitle: "Couldn’t sign up",
            buttonLabel: "Sign up",
            subheadingEnd: "finish signing up",
        },
    }[state.type];

    return (
        <Form
            ref={formRef}
            submitErrorTitle={submitErrorTitle}
            onSubmit={async () => {
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

                    const {openSpaceId} = await fetchWithTracer(
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
                    );

                    // Open the space sign in (or sign up) tells us to open.
                    if (openSpaceId) {
                        await navigate(`/s/${openSpaceId}`);
                    } else {
                        await navigate("/switch-space");
                    }
                } catch (error) {
                    // Clear the one time password input
                    setOneTimePassword("");
                    inputRef.current?.focus();

                    throw error;
                }
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
