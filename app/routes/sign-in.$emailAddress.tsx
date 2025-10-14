import {useParams} from "@remix-run/react";
import {json, redirect} from "@remix-run/router";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {ArrowLeft} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ErrorInlineAlert} from "~/client/design/error_inline_alert.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/design/navigation_bar_helpers.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useFetcherWithSchema} from "~/client/remix/use_fetcher_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {colorSchemeVars, inputPlaceholderStyles, sprinkles} from "~/client/styles/styles.js";
import {
    appleReviewerAccountEmailAddress,
    attemptOneTimePasswordSignIn,
} from "~/server/accounts/accounts_actions.js";
import {getOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/accounts_actions_settings.js";
import {getAlphaConfiguration} from "~/server/alpha/alpha_access_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export function meta() {
    return [
        {title: "Sign in to Alpine"},
        // Ask Google to not index this page.
        {name: "robots", content: "noindex"},
    ];
}

export function links(): Array<LinkDescriptor> {
    return [
        // 1. Turn off scrolling on `body`. The sign in screen should fill the page.
        //    This prevents over-scrolling on iOS Safari.
        //
        // 2. When the virtual keyboard in our iOS native app opens, the user can
        //    scroll the page. Make sure the overscroll color matches the main
        //    background color.
        {
            rel: "stylesheet",
            href: `data:text/css,${encodeURIComponent(
                `body {overflow: hidden; background-color: ${colorSchemeVars["grey-0"]}}`,
            )}`,
        },
    ];
}

export async function loader({request, context}: LoaderArgs) {
    const url = new URL(request.url);
    const toPath = url.searchParams.get("to");

    // Can not access this page while signed in.
    if (await context.actor.isAuthenticatedSession()) {
        if (toPath?.startsWith("/")) return redirect(toPath);
        return redirectToAuthenticatedHome(context);
    }

    return json({});
}

const ActionSchema = Schema.object({
    ok: Schema.value(false),
    error: ErrorSchema,
});

export async function action({request, context, params}: LoaderArgs) {
    try {
        const url = new URL(request.url);
        const toPath = url.searchParams.get("to");
        const emailAddress = params.emailAddress;

        const formData = await request.formData();
        const oneTimePassword = formData.get("oneTimePassword");

        if (typeof emailAddress !== "string")
            throw new InvalidArgumentError("Expected property `emailAddress` in params");
        if (typeof oneTimePassword !== "string")
            throw new InvalidArgumentError("Expected property `oneTimePassword` in form data");

        const {sessionId, sessionAccountId} = await attemptOneTimePasswordSignIn(
            context,
            await validateEmailAddress(context, emailAddress),
            oneTimePassword,
            {
                // We depend on Cloudflare to set `x-real-ip` or `cf-connecting-ip` header on
                // our request to get the IP address.
                // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
                ipAddress:
                    request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip"),
                userAgent: request.headers.get("user-agent"),
            },
        );

        // If the user is signing in from the native mobile app, the native app is
        // responsible for redirecting the user. Use a custom protocol to signal to the
        // native app that it should take over.
        if (context.loader.getClientInfo().isNativeMobile) {
            const url = new URL("cyberworlds://sign-in/finish");
            const sessionContext = await context.actor.authenticate();
            if (sessionContext.actor.type !== "Session") {
                throw new PermissionDeniedError("Cannot load outside of Session context");
            }

            if (emailAddress === appleReviewerAccountEmailAddress) {
                const configuration = await getAlphaConfiguration(context);
                const spaceId = assertExists(configuration.appleReviewerSpaceId);
                // Route the Apple reviewer to their space...
                url.searchParams.set("spaceId", spaceId);
            } else {
                const defaultSpaceId = await getOurLastOpenedSpaceId(
                    await sessionContext.actor.authenticate(),
                );
                if (defaultSpaceId) {
                    url.searchParams.set("spaceId", defaultSpaceId);
                }
            }

            url.searchParams.set(
                "session",
                await context.loader.tokenAgent.privateSide.dangerouslySignEternalSessionToken({
                    type: "Session",
                    sessionId,
                    accountId: sessionAccountId,
                }),
            );

            return redirect(url.toString());
        }

        context.loader.sessionCookie.dangerouslySet({
            type: "Session",
            sessionId,
            accountId: sessionAccountId,
        });

        if (toPath?.startsWith("/")) return redirect(toPath);
        return redirectToAuthenticatedHome(context);
    } catch (error) {
        return jsonWithSchema(
            ActionSchema,
            {ok: false, error},
            {status: isSystemError(error) ? 500 : 400},
        );
    }
}

export default function SignInEmailCodePage() {
    const platform = usePlatform();
    const navigate = useNavigate();
    const params = useParams();
    const emailAddress = params.emailAddress;

    const formRef = useRef<HTMLFormElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [oneTimePassword, setOneTimePassword] = useState("");
    const [isDisabledForSubmit, setIsDisabledForSubmit] = useState(false);
    const isFormValid = oneTimePassword.length === 6;

    const fetcher = useFetcherWithSchema(ActionSchema);

    const [dismissedFetcherData, setDismissedFetcherData] = useState<SchemaType<
        typeof ActionSchema
    > | null>(null);

    const onDidSubmit = () => {
        setIsDisabledForSubmit(true);
        if (fetcher.data) setDismissedFetcherData(fetcher.data);
    };

    const onOneTimePasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        // Don't allow a user to type unsupported characters into our code.
        const value = event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 6);
        setOneTimePassword(value);

        if (value.length === 6 && formRef.current) {
            fetcher.submit(formRef.current);
            onDidSubmit();
        }
    };

    useEffect(() => {
        if (fetcher.state === "idle") {
            setIsDisabledForSubmit(false);
        }
    }, [fetcher.state]);

    const hasError = fetcher.data ? !fetcher.data.ok : false;
    useEffect(() => {
        if (fetcher.state === "idle" && hasError && inputRef.current) {
            setOneTimePassword("");
            inputRef.current.focus();
        }
    }, [hasError, fetcher.state]);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Re-run effect whenever the password changes.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        oneTimePassword;

        // Make sure we reset any scroll the browser applies to the input to keep the
        // cursor visible when the input's value changes.
        const inputElement = assertExists(inputRef.current);
        inputElement.scrollLeft = 0;

        // Seems like the `scroll` event happens after our layout effect. Schedule an
        // animation frame to reset scroll works. This is kind of a hack. Ideally
        // there'd be some way to tell the browser not to scroll in the first place.
        requestAnimationFrame(() => {
            inputElement.scrollLeft = 0;
        });
    }, [oneTimePassword]);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);

        return scheduleAfterNavigationAnimation(() => {
            inputElement.focus();
        });
    }, []);

    return (
        <Box
            position="relative"
            display="flex"
            justifyContent="center"
            backgroundColor="grey-0"
            padding="safe-area-inset"
            style={{
                // Fill the entire viewport height. `minHeight: 100%` only fills the area that
                // doesn't conflict with the safe area inset.
                minHeight: "100lvh",
            }}
        >
            {platform === "mobile" && (
                <Box position="absolute" top="0" left="0" right="0" paddingTop="safe-area-inset">
                    <Box
                        height={navigationBarHeight}
                        paddingX={navigationBarMobileGap}
                        display="flex"
                        alignItems="center"
                    >
                        <IconButton
                            size="base"
                            description="Go back"
                            withoutTooltip={true}
                            pressErrorTitle="Couldn’t go back"
                            onPress={() => navigate(-1)}
                        >
                            <ArrowLeft />
                        </IconButton>
                    </Box>
                </Box>
            )}
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "64",
                    paddingY: {desktop: "32", mobile: "20"},
                    paddingX: "4",
                })}
            >
                <fetcher.Form
                    ref={formRef}
                    method="post"
                    onSubmit={() => {
                        onDidSubmit();
                    }}
                >
                    <h1
                        className={sprinkles({
                            fontStyle: "bold",
                            fontSize: "700",
                        })}
                    >
                        Sign in
                    </h1>
                    <Spacer space="2" />
                    <Box color="grey-80">
                        We sent a sign in code to{" "}
                        <span
                            className={sprinkles({
                                fontStyle: "bold",
                                color: "grey-100",
                            })}
                        >
                            {emailAddress}
                        </span>
                        . Type the code here to sign in.
                    </Box>
                    <Spacer space="6" />
                    {fetcher.data && dismissedFetcherData !== fetcher.data && (
                        <>
                            <ErrorInlineAlert
                                title="Could not sign in"
                                error={fetcher.data.error}
                                onDismiss={() => setDismissedFetcherData(fetcher.data!)}
                            />
                            <Spacer space="4" />
                        </>
                    )}
                    <Box position="relative" zIndex="0">
                        <input
                            ref={inputRef}
                            name="oneTimePassword"
                            disabled={isDisabledForSubmit}
                            type="text"
                            value={oneTimePassword}
                            onChange={onOneTimePasswordChange}
                            className={sprinkles({
                                display: "block",
                                width: "full",
                                paddingY: "1",
                                backgroundColor: "transparent",
                            })}
                            style={{
                                fontSize: "1.875rem",
                                lineHeight: 1.5,
                                letterSpacing: "1.158rem",
                                paddingLeft: "0.469rem",
                                fontVariantNumeric: "tabular-nums",
                            }}
                            autoComplete="one-time-code"
                            inputMode="numeric"
                            aria-label="Sign in code"
                        />
                        <Box
                            position="absolute"
                            inset="0"
                            pointerEvents="none"
                            display="flex"
                            gap="1"
                            zIndex="-10"
                            style={{
                                fontSize: "1.875rem",
                                lineHeight: 1.5,
                                fontVariantNumeric: "tabular-nums",
                                ...inputPlaceholderStyles,
                            }}
                        >
                            <OneTimePasswordDigit isPlaceholder={oneTimePassword.length <= 0} />
                            <OneTimePasswordDigit isPlaceholder={oneTimePassword.length <= 1} />
                            <OneTimePasswordDigit isPlaceholder={oneTimePassword.length <= 2} />
                            <OneTimePasswordDigit isPlaceholder={oneTimePassword.length <= 3} />
                            <OneTimePasswordDigit isPlaceholder={oneTimePassword.length <= 4} />
                            <OneTimePasswordDigit isPlaceholder={oneTimePassword.length <= 5} />
                        </Box>
                    </Box>
                    <Spacer space="6" />
                    <Button
                        variant="accent"
                        shouldSubmitForm={true}
                        fullWidth={true}
                        isPending={isDisabledForSubmit || fetcher.state === "submitting"}
                        isDisabled={!isFormValid}
                    >
                        Sign in
                    </Button>
                </fetcher.Form>
            </main>
        </Box>
    );
}

function OneTimePasswordDigit({isPlaceholder}: {isPlaceholder: boolean}) {
    return (
        <Box
            flexGrow="1"
            height="full"
            borderRadius="1"
            border="grey-5"
            borderWidth="thick"
            display="flex"
            justifyContent="center"
            alignItems="center"
            style={{
                fontSize: "1.875rem",
                lineHeight: 1.5,
                fontVariantNumeric: "tabular-nums",
                ...inputPlaceholderStyles,
                color: colorSchemeVars["grey-20"],
            }}
        >
            <Box aria-hidden={true} opacity={!isPlaceholder ? "0" : undefined}>
                0
            </Box>
        </Box>
    );
}
