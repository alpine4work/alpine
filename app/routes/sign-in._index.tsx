import {json, redirect} from "@remix-run/cloudflare";
import {Form, Link, useNavigation} from "@remix-run/react";
import {useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ErrorInlineAlert} from "~/client/design/error_inline_alert.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {useActionDataWithSchema} from "~/client/remix/use_action_data_with_schema.js";
import {regenerateOneTimePasswordSignIn} from "~/server/dynamo/accounts_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";

export function meta() {
    return [{title: "Sign in to Cyberworlds"}];
}

export async function loader({request, context}: LoaderArgs) {
    const url = new URL(request.url);
    const toPath = url.searchParams.get("to");

    // Can not access this page while signed in.
    if (await context.actor.isAuthenticated()) {
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
            throw new InvalidArgumentError('Expected property "emailAddress" in form data');

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

    const actionData = useActionDataWithSchema(ActionSchema);

    const [dismissedActionData, setDismissedActionData] = useState<SchemaType<
        typeof ActionSchema
    > | null>(null);

    return (
        <Box display="flex" justifyContent="center" backgroundColor="grey-0" height="full">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "64",
                    paddingY: {desktop: "32", mobile: "16"},
                    paddingX: "4",
                })}
            >
                <Form
                    method="post"
                    onSubmit={() => {
                        if (actionData) setDismissedActionData(actionData);
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
                    {actionData && dismissedActionData !== actionData && (
                        <>
                            <ErrorInlineAlert
                                title="Could not sign in"
                                error={actionData.error}
                                onDismiss={() => setDismissedActionData(actionData)}
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
                        isPending={useNavigation().state === "submitting"}
                        isDisabled={!isFormValid}
                    >
                        Sign in
                    </Button>
                </Form>
                <Spacer space="32" />
                <Box paddingTop="2" borderTop="grey-10">
                    Don’t have an account yet?
                    <br />
                    <FocusRing>
                        <Link to="/" className={contentSchemaStyles.linkClassName}>
                            Request access
                        </Link>
                    </FocusRing>
                </Box>
            </main>
        </Box>
    );
}
