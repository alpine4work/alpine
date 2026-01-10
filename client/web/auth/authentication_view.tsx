import {loadRouteModuleWithBlockingLinks, useSearchParams} from "@remix-run/react";
import {useEffect, useRef, useState} from "react";
import {useParams} from "react-router";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {
    AuthenticationState,
    getAuthenticationStateVariant,
    initialAuthenticationStateForVariant,
    isAuthenticationVariant,
} from "~/client/web/auth/authentication_state.js";
import {AuthenticationAfterSignUpMobileInterstitialView} from "~/client/web/auth/internal/authentication_after_sign_up_mobile_interstitial_view.js";
import {
    authenticationViewPaddingBottom,
    authenticationViewPaddingTop,
    authenticationViewPaddingX,
} from "~/client/web/auth/internal/authentication_shared_styles.js";
import {AuthenticationSignInOrSignUpOneTimePasswordView} from "~/client/web/auth/internal/authentication_sign_in_or_sign_up_one_time_password_view.js";
import {AuthenticationSignInOrSignUpView} from "~/client/web/auth/internal/authentication_sign_in_or_sign_up_view.js";
import {AuthenticationSignUpProfileView} from "~/client/web/auth/internal/authentication_sign_up_profile_view.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {isId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {routeNotFoundError} from "~/shared/remix/route_not_found_error.js";

export function AuthenticationView() {
    const params = useParams();
    const [searchParams, setSearchParams] = useSearchParams();

    if (typeof params.variant !== "string" || !isAuthenticationVariant(params.variant)) {
        throw routeNotFoundError();
    }

    const {variant} = params;

    const getInitialAuthenticationState = (): AuthenticationState => {
        const profileSearchParam = searchParams.get("profile");

        if (variant === "sign-up" && profileSearchParam !== null) {
            const profileSearchParamParts = profileSearchParam.split(",", 2);
            const accountId = (profileSearchParamParts[0] ?? "").trim();
            const emailAddress = validateEmailAddress((profileSearchParamParts[1] ?? "").trim());
            assert(isId<AccountId>(accountId), "Invalid `AccountId`");

            return {
                type: "SignUpProfile",
                accountId,
                emailAddress,
            };
        }

        return initialAuthenticationStateForVariant[variant];
    };

    const [state, setState] = useState<AuthenticationState>(getInitialAuthenticationState);

    // If the variant in Remix `params` changes then we need to update our state to
    // the initial authentication state for that variant.
    const stateVariant = getAuthenticationStateVariant(state);
    if (variant !== stateVariant) {
        setState(getInitialAuthenticationState());
    }

    // Delete the `profile` search param now that we've used it to initialize state.
    const hasProfileSearchParam = searchParams.has("profile");
    useEffect(() => {
        if (hasProfileSearchParam) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("profile");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [hasProfileSearchParam, setSearchParams]);

    // Optimization: Preload the `s.$spaceId` and `s.$spaceId._index` routes so
    // that redirecting to the space at the end of sign in or sign up isn't blocked
    // by loading a bunch of JavaScript code.
    //
    // The sign in/up button can otherwise feel slow since there's a bunch of
    // JavaScript to download to get into the app and we're not performing a server
    // side render.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        // Use the React scheduler to schedule an idle callback.
        // `requestIdleCallback()` is not implemented in Safari. Generally we recommend
        // using the React scheduler since it has centralized knowledge of all our
        // tasks (including UI rendering).
        unstable_scheduleCallback(unstable_IdlePriority, () => {
            runPromiseWithoutAwaiting(
                runAllPromises([
                    loadRouteModuleWithBlockingLinks(
                        window.__remixManifest.routes["routes/s.$spaceId"]!,
                        window.__remixRouteModules,
                    ),
                    loadRouteModuleWithBlockingLinks(
                        window.__remixManifest.routes["routes/s.$spaceId._index"]!,
                        window.__remixRouteModules,
                    ),
                ]),
            );
        });
    }, [state.type]);

    return (
        <Box
            position="relative"
            zIndex="0"
            width="full"
            display="flex"
            justifyContent="center"
            paddingX={authenticationViewPaddingX}
            paddingTop={authenticationViewPaddingTop}
            paddingBottom={authenticationViewPaddingBottom}
            style={{minHeight: "inherit"}}
        >
            <main
                className={sprinkles({width: "full", minHeight: "full"})}
                style={{
                    // We use a slightly off spacing scale value for `maxWidth` so the "By signing
                    // up, you agree to our Terms of Service and Privacy Policy" text on the last
                    // step of sign up doesn't wrap onto two lines.
                    maxWidth: addRemLengths("96", "4"),
                }}
            >
                <AuthenticationViewOutlet
                    // Fully remount the component whenever the state changes type.
                    key={state.type}
                    state={state}
                    onStateChange={newState => {
                        assert(
                            stateVariant === getAuthenticationStateVariant(newState),
                            "To change `AuthorizationVariant` you must use `navigate()`",
                        );

                        setState(newState);
                    }}
                />
            </main>
        </Box>
    );
}

function AuthenticationViewOutlet({
    state,
    onStateChange,
}: {
    state: AuthenticationState;
    onStateChange: (state: AuthenticationState) => void;
}) {
    switch (state.type) {
        case "SignIn":
        case "SignUp": {
            return <AuthenticationSignInOrSignUpView state={state} onStateChange={onStateChange} />;
        }
        case "SignUpProfile": {
            return <AuthenticationSignUpProfileView state={state} onStateChange={onStateChange} />;
        }
        case "SignInOneTimePassword":
        case "SignUpOneTimePassword": {
            return (
                <AuthenticationSignInOrSignUpOneTimePasswordView
                    state={state}
                    onStateChange={onStateChange}
                />
            );
        }
        case "AfterSignUpMobileInterstitial": {
            return <AuthenticationAfterSignUpMobileInterstitialView state={state} />;
        }
        default:
            throw exhaustive(state);
    }
}
