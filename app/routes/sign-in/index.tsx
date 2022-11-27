import {json, redirect} from "@remix-run/cloudflare";
import {Form, Link, useTransition} from "@remix-run/react";
import {useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {Spacer} from "~/client/design/spacer";
import {TextInput} from "~/client/design/text_input";
import {ErrorInlineAlert} from "~/client/error/error_inline_alert";
import {useActionDataWithSchema} from "~/client/helpers/use_action_data_with_schema";
import {regenerateOneTimePasswordSignIn} from "~/server/dynamo/accounts_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";
import {InvalidArgumentError} from "~/shared/error/error";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isHttp500Error} from "~/shared/error/is_http_500_error_code";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Sign in to Cyberworlds",
        robots: "noindex",
    };
}

export async function loader({context}: DataFunctionArgs) {
    // Can not access this page while signed in.
    if (await context.isAuthenticated()) return redirectToAuthenticatedHome(context);

    return json({});
}

const ActionSchema = Schema.object({
    ok: Schema.value(false),
    error: ErrorSchema,
});

export async function action({request, context}: DataFunctionArgs) {
    try {
        const formData = await request.formData();
        const emailAddress = formData.get("emailAddress");

        if (typeof emailAddress !== "string")
            throw new InvalidArgumentError('Expected property "emailAddress" in form data');

        await regenerateOneTimePasswordSignIn(context, emailAddress);

        // After we send the email, challenge the user to sign in using the code
        // we sent them.
        return redirect(`/sign-in/${encodeURIComponent(emailAddress)}`);
    } catch (error) {
        return jsonWithSchema(ActionSchema, {ok: false, error}, isHttp500Error(error) ? 500 : 400);
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
        <Box display="flex" justifyContent="center">
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
                            typographyStyle: "primarySemiBold",
                            typographySize: "heading4",
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
                        isPending={useTransition().state === "submitting"}
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
