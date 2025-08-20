import {json, redirect} from "@remix-run/router";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ErrorInlineAlert} from "~/client/design/error_inline_alert.js";
import {Link} from "~/client/design/link.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {useFetcherWithSchema} from "~/client/remix/use_fetcher_with_schema.js";
import {colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {regenerateOneTimePasswordSignIn} from "~/server/accounts/accounts_actions.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export function meta() {
    return [{title: "Sign in to Alpine"}];
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

export async function action({request, context}: LoaderArgs) {
    try {
        const url = new URL(request.url);
        const toPath = url.searchParams.get("to");
        const formData = await request.formData();
        const emailAddress = formData.get("emailAddress");

        if (typeof emailAddress !== "string")
            throw new InvalidArgumentError("Expected property `emailAddress` in form data");

        await regenerateOneTimePasswordSignIn(
            context,
            await validateEmailAddress(context, emailAddress),
        );

        // After we send the email, challenge the user to sign in using the code
        // we sent them.
        return redirect(
            `/sign-in/${encodeURIComponent(emailAddress)}${
                toPath ? `?to=${encodeURIComponent(toPath)}` : ""
            }`,
        );
    } catch (error) {
        return jsonWithSchema(
            ActionSchema,
            {ok: false, error},
            {status: isSystemError(error) ? 500 : 400},
        );
    }
}

export default function SignInPage() {
    const [emailAddress, setEmailAddress] = useState("");
    const isFormValid = emailAddress.length > 0 && emailAddress.includes("@");

    const fetcher = useFetcherWithSchema(ActionSchema);

    const [dismissedFetcherData, setDismissedFetcherData] = useState<SchemaType<
        typeof ActionSchema
    > | null>(null);

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
                    paddingY: {desktop: "32", mobile: "20"},
                    paddingX: "4",
                })}
            >
                <fetcher.Form
                    method="post"
                    onSubmit={() => {
                        if (fetcher.data) setDismissedFetcherData(fetcher.data);
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
                    <TextInput
                        formName="emailAddress"
                        label="Email address"
                        placeholder="anthony.mose@company.com"
                        autoComplete="email"
                        value={emailAddress}
                        onChange={setEmailAddress}
                    />
                    <Spacer space="4" />
                    <Button
                        variant="accent"
                        shouldSubmitForm={true}
                        fullWidth={true}
                        isPending={fetcher.state === "submitting"}
                        isDisabled={!isFormValid}
                    >
                        Sign in
                    </Button>
                </fetcher.Form>
                <Spacer space="32" />
                <Box paddingTop="2" borderTop="grey-10">
                    Don’t have an account yet?
                    <br />
                    <Link url="/">Request access</Link>
                </Box>
            </main>
        </Box>
    );
}
