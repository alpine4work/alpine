import {useParams} from "@remix-run/react";
import {json, redirect} from "@remix-run/router";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {useEffect, useRef, useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ErrorInlineAlert} from "~/client/design/error_inline_alert.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useFetcherWithSchema} from "~/client/remix/use_fetcher_with_schema.js";
import {attemptOneTimePasswordSignIn} from "~/server/accounts/accounts_table.js";
import {getAlphaConfiguration} from "~/server/alpha/alpha_access_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export function meta() {
    return [
        {title: "Sign in to Cyberworlds"},
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
            throw new InvalidArgumentError('Expected property "emailAddress" in params');
        if (typeof oneTimePassword !== "string")
            throw new InvalidArgumentError('Expected property "oneTimePassword" in form data');

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
            // TODO(calebmer): If the account has multiple spaces we should probably route
            // them to a space switcher?
            const configuration = await getAlphaConfiguration(context);

            if (!configuration.defaultSpaceId) {
                throw new InternalError(
                    "Expected `defaultSpaceId` in alpha configuration to sign in on mobile",
                );
            }

            const url = new URL("cyberworlds://sign-in/finish");

            url.searchParams.set("spaceId", configuration.defaultSpaceId);

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
    const formRef = useRef<HTMLFormElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const params = useParams();
    const emailAddress = params.emailAddress;

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
        // this is a bit of a hack. the browser will scroll the input to the left, to keep the input
        // cursor in view, but this only happens when we have 6 characters at which point we disable
        // the input and submit the form anyway. we can't disable this with an event listener
        // because for some reason the scroll event isn't fired (at least on ios). We might be able
        // to fix this with overflow: clip but support isn't good at the moment. instead we check &
        // reset the scroll every frame.
        const preventScrollLoop = () => {
            if (inputRef.current) {
                inputRef.current.scrollLeft = 0;
            }
            frame = requestAnimationFrame(preventScrollLoop);
        };

        let frame = requestAnimationFrame(preventScrollLoop);

        return () => {
            cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <Box
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
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "64",
                    paddingY: {desktop: "32", mobile: "16"},
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
                                color: "grey-text",
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
                            placeholder="000000"
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
                                letterSpacing: "1.15rem",
                                paddingLeft: "0.49rem",
                                transform: "translateY(0.03rem)",
                                fontVariantNumeric: "tabular-nums",
                            }}
                            spellCheck="false"
                            autoComplete="one-time-code"
                            autoFocus={true}
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
                        >
                            <Box
                                flexGrow="1"
                                height="full"
                                borderRadius="base"
                                border="grey-5"
                                borderWidth="thick"
                            />
                            <Box
                                flexGrow="1"
                                height="full"
                                borderRadius="base"
                                border="grey-5"
                                borderWidth="thick"
                            />
                            <Box
                                flexGrow="1"
                                height="full"
                                borderRadius="base"
                                border="grey-5"
                                borderWidth="thick"
                            />
                            <Box
                                flexGrow="1"
                                height="full"
                                borderRadius="base"
                                border="grey-5"
                                borderWidth="thick"
                            />
                            <Box
                                flexGrow="1"
                                height="full"
                                borderRadius="base"
                                border="grey-5"
                                borderWidth="thick"
                            />
                            <Box
                                flexGrow="1"
                                height="full"
                                borderRadius="base"
                                border="grey-5"
                                borderWidth="thick"
                            />
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
