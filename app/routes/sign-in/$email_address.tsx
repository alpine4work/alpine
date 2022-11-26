import {json} from "@remix-run/cloudflare";
import {Form, useParams, useTransition} from "@remix-run/react";
import {useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {Spacer} from "~/client/design/spacer";
import {ErrorInlineAlert} from "~/client/error/error_inline_alert";
import {useActionDataWithSchema} from "~/client/helpers/use_action_data_with_schema";
import {attemptOneTimePasswordSignIn} from "~/server/dynamo/accounts_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";
import {InvalidArgumentError} from "~/shared/error/error";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isHttp500Error} from "~/shared/error/is_http_500_error_code";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Sign in to Cyberworlds",
        // Ask Google to not index this page.
        robots: "noindex",
    };
}

export async function loader({context}: DataFunctionArgs) {
    // Can not access this page while signed in.
    if (await context.isAuthenticated()) return redirectToAuthenticatedHome();

    return json({});
}

const ActionSchema = Schema.object({
    ok: Schema.value(false),
    error: ErrorSchema,
});

export async function action({request, context, params}: DataFunctionArgs) {
    try {
        const emailAddress = params.email_address;

        const formData = await request.formData();
        const oneTimePassword = formData.get("oneTimePassword");

        if (typeof emailAddress !== "string")
            throw new InvalidArgumentError('Expected property "emailAddress" in params');
        if (typeof oneTimePassword !== "string")
            throw new InvalidArgumentError('Expected property "oneTimePassword" in form data');

        const {sessionId} = await attemptOneTimePasswordSignIn(
            context,
            emailAddress,
            oneTimePassword,
        );

        await context.dangerouslySetSessionId(sessionId);

        return redirectToAuthenticatedHome();
    } catch (error) {
        return jsonWithSchema(ActionSchema, {ok: false, error}, isHttp500Error(error) ? 500 : 400);
    }
}

export default function SignInEmailCodePage() {
    const params = useParams();
    const emailAddress = params.email_address;

    const [oneTimePassword, setOneTimePassword] = useState("");
    const isFormValid = oneTimePassword.length === 6;

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
                    <Spacer space="2" />
                    <Box color="grey-80">
                        We sent a sign in code to{" "}
                        <span
                            className={sprinkles({
                                typographyStyle: "primarySemiBold",
                                color: "grey-100",
                            })}
                        >
                            {emailAddress}
                        </span>
                        . Type the code here to sign in.
                    </Box>
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
                    <Box position="relative">
                        <input
                            name="oneTimePassword"
                            placeholder="000000"
                            value={oneTimePassword}
                            onChange={event => {
                                const value = event.currentTarget.value;

                                // Don't allow a user to type unsupported characters into our code.
                                setOneTimePassword(value.replace(/[^0-9]/g, "").slice(0, 6));
                            }}
                            className={sprinkles({
                                display: "block",
                                width: "full",
                                paddingY: "1",
                                backgroundColor: "transparent",
                                typographySize: "heading4",
                            })}
                            style={{
                                lineHeight: 1.5,
                                letterSpacing: "1.24rem",
                                paddingLeft: "0.49rem",
                                transform: "translateY(0.03rem)",
                                fontVariantNumeric: "tabular-nums",
                            }}
                            spellCheck="false"
                            autoComplete="off"
                            onScroll={event => {
                                event.currentTarget.scrollLeft = 0;
                            }}
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
                        isPending={useTransition().state === "submitting"}
                        isDisabled={!isFormValid}
                    >
                        Sign in
                    </Button>
                </Form>
            </main>
        </Box>
    );
}
