import {json} from "@remix-run/cloudflare";
import {Form, Link, useTransition} from "@remix-run/react";
import {useEffect, useId, useMemo, useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home";
import {DocumentBlobFactory, useDocumentBlobSettings} from "~/client/blob_factory/document_blobs";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {InlineAlert} from "~/client/design/inline_alert";
import {MultilineTextInput} from "~/client/design/multiline_text_input";
import {Spacer} from "~/client/design/spacer";
import {TextInput} from "~/client/design/text_input";
import {ErrorInlineAlert} from "~/client/error/error_inline_alert";
import {useActionDataWithSchema} from "~/client/remix/use_action_data_with_schema";
import {requestAlphaAccess} from "~/server/dynamo/alpha_access_table";
import {validateEmailAddress} from "~/server/emails/email_address";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {themeColors} from "~/shared/design/theme_colors";
import {InvalidArgumentError} from "~/shared/error/error";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {randomArrayItem} from "~/shared/helpers/array/random_array_item";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Lint rule that in JSX and error display messages you use a
// curly quote (`’`) over single quotes (`'`) for apostrophes. Double
// quotes too.

export function meta() {
    return {
        title: "Request access to Cyberworlds",
        robots: "noindex",
    };
}

export async function loader({context}: LoaderArgs) {
    // Can not access this page while signed in.
    if (await context.auth.isAuthenticated()) return redirectToAuthenticatedHome(context);

    return json({});
}

const ActionSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        emailAddress: Schema.string,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export async function action({request, context}: LoaderArgs) {
    try {
        const formData = await request.formData();
        const name = formData.get("name");
        const emailAddress = formData.get("emailAddress");
        const message = formData.get("message");

        if (typeof name !== "string")
            throw new InvalidArgumentError('Expected property "name" in form data');
        if (typeof emailAddress !== "string")
            throw new InvalidArgumentError('Expected property "emailAddress" in form data');
        if (typeof message !== "string")
            throw new InvalidArgumentError('Expected property "message" in form data');

        await requestAlphaAccess(context, {
            name,
            emailAddress: await validateEmailAddress(context, emailAddress),
            message,
        });

        return jsonWithSchema(ActionSchema, {ok: true, emailAddress});
    } catch (error) {
        return jsonWithSchema(
            ActionSchema,
            {ok: false, error},
            {status: isSystemError(error) ? 500 : 400},
        );
    }
}

const randomSeed = Math.random().toString();
const themeColor = randomArrayItem(themeColors);

export default function HomePage() {
    const id = useId().replace(/:/g, "_");
    const [name, setName] = useState("");
    const [emailAddress, setEmailAddress] = useState("");
    const [message, setMessage] = useState("");

    const isFormValid = name.length > 0 && emailAddress.length > 0 && emailAddress.includes("@");

    const transition = useTransition();
    const actionData = useActionDataWithSchema(ActionSchema);

    const [dismissedActionData, setDismissedActionData] = useState<SchemaType<
        typeof ActionSchema
    > | null>(null);

    const blobSettings = useDocumentBlobSettings({defaultSeed: randomSeed});

    // If the form submission was successful, clear our inputs.
    useEffect(() => {
        if (transition.state === "idle" && actionData?.ok) {
            setName("");
            setEmailAddress("");
            setMessage("");
        }
    }, [actionData?.ok, transition.state]);

    return (
        <Box display="flex" justifyContent="center" id={id}>
            <DocumentBlobFactory
                settings={useMemo(
                    () => ({...blobSettings, textFillEnabled: false, baseThemeColor: themeColor}),
                    [blobSettings],
                )}
                containerId={id}
            />
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingY: {desktop: "32", mobile: "16"},
                    paddingX: "4",
                })}
            >
                <h1
                    className={sprinkles({
                        fontStyle: "primaryBold",
                        fontSize: "heading3",
                    })}
                >
                    Want to see what we’re working on?
                </h1>
                <Spacer space="4" />
                <Box fontSize="body" color="grey-80">
                    Cyberworlds is the code name for a new workplace collaboration suite we’re
                    building. While we have a long way to go, we’re giving some people access to the
                    product so they can follow along.
                </Box>
                <Spacer space="8" />
                <Form
                    method="post"
                    onSubmit={() => {
                        if (actionData) setDismissedActionData(actionData);
                    }}
                >
                    <Box fontSize="heading5" fontStyle="primaryBold">
                        Request access
                    </Box>
                    <Spacer space="4" />
                    {actionData && dismissedActionData !== actionData && (
                        <>
                            {actionData.ok ? (
                                <InlineAlert
                                    variant="positive"
                                    title="Requested access"
                                    onDismiss={() => setDismissedActionData(actionData)}
                                >
                                    If your request is approved we’ll send an email to{" "}
                                    {actionData.emailAddress} with further instructions.
                                </InlineAlert>
                            ) : (
                                <ErrorInlineAlert
                                    title="Could not request access"
                                    error={actionData.error}
                                    onDismiss={() => setDismissedActionData(actionData)}
                                />
                            )}
                            <Spacer space="4" />
                        </>
                    )}
                    <TextInput
                        formName="name"
                        label="Name"
                        placeholder="Anthony Mose"
                        autoComplete="name"
                        value={name}
                        onChange={setName}
                    />
                    <Spacer space="4" />
                    <TextInput
                        formName="emailAddress"
                        label="Email address"
                        placeholder="anthony.mose@company.com"
                        autoComplete="email"
                        value={emailAddress}
                        onChange={setEmailAddress}
                    />
                    <Spacer space="4" />
                    <MultilineTextInput
                        formName="message"
                        label="Message (optional)"
                        placeholder="How do you know the team?"
                        value={message}
                        onChange={setMessage}
                    />
                    <Spacer space="8" />
                    <Box
                        display="flex"
                        flexDirection={{desktop: "row", mobile: "column"}}
                        gap={{desktop: "12", mobile: "4"}}
                        alignItems={{desktop: "flex-end", mobile: "flex-start"}}
                    >
                        <Box flexGrow="1" color="grey-80">
                            For now, we’re only letting in people who know someone on our team. If
                            your request is approved you’ll get an email which tells you how to sign
                            in.
                        </Box>
                        <Button
                            variant="accent"
                            shouldSubmitForm={true}
                            isDisabled={!isFormValid}
                            isPending={transition.state === "submitting"}
                        >
                            Request
                        </Button>
                    </Box>
                </Form>
                <Spacer space="32" />
                <Box paddingTop="2" borderTop="grey-10">
                    Already have an account?{" "}
                    <FocusRing>
                        <Link to="/sign-in" className={contentSchemaStyles.linkClassName}>
                            Sign in
                        </Link>
                    </FocusRing>
                </Box>
            </main>
        </Box>
    );
}
