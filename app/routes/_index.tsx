import {json} from "@remix-run/router";
import {useEffect, useId, useMemo, useState} from "react";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {BlobsArt} from "~/client/blobs/blobs_art.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ErrorInlineAlert} from "~/client/design/error_inline_alert.js";
import {InlineAlert} from "~/client/design/inline_alert.js";
import {Link} from "~/client/design/link.js";
import {MultilineTextInput} from "~/client/design/multiline_text_input.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {useInitialAppRenderId} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useFetcherWithSchema} from "~/client/remix/use_fetcher_with_schema.js";
import {sprinkles} from "~/client/styles/styles.js";
import {requestAlphaAccess} from "~/server/alpha/alpha_access_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {getUrlRegExp} from "~/shared/helpers/string/url_reg_exp.js";
import {generateId} from "~/shared/id/id.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

// TODO(calebmer): Lint rule that in JSX and error display messages you use a
// curly quote (`’`) over single quotes (`'`) for apostrophes. Double
// quotes too.

export function meta() {
    return [{title: "Request access to Alpine"}];
}

export async function loader({context}: LoaderArgs) {
    // Can not access this page while signed in.
    if (await context.actor.isAuthenticatedSession()) {
        return redirectToAuthenticatedHome(context);
    }

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
            throw new InvalidArgumentError("Expected property `name` in form data");
        if (typeof emailAddress !== "string")
            throw new InvalidArgumentError("Expected property `emailAddress` in form data");
        if (typeof message !== "string")
            throw new InvalidArgumentError("Expected property `message` in form data");

        // NOTE(calebmer, 2022-01-16): I get automated spam bot submissions to this
        // form every couple hours from a bot with the name "CryptoBob". There are more
        // sophisticated spam bot prevention techniques (like captcha challenges) but
        // since we're only seeing one spam bot for now named "CryptoBob", target
        // CryptoBob specifically.
        if (/crypto/i.test(name) || /crypto/i.test(message))
            throw new InvalidArgumentError("Crypto spam not allowed", {
                displayMessage: errorDisplayMessage`Can not request access if your name or message includes the word “crypto”. We have this restriction to prevent automated spam bots from submitting the form. Remove the word “crypto” from your name or message and try again.`,
            });

        // NOTE(calebmer, 2022-01-16): Oh CryptoBob you rascal. Now the form is being
        // submit with "CrytoBob". More defense.
        if (/cryto/i.test(name) || /cryto/i.test(message))
            throw new InvalidArgumentError("Crypto spam not allowed", {
                displayMessage: errorDisplayMessage`Can not request access if your name or message includes the word “cryto”. We have this restriction to prevent automated spam bots from submitting the form. Remove the word “cryto” from your name or message and try again.`,
            });

        // NOTE(calebmer, 2022-01-24): CryptoBob is now just "Bob". While I do not
        // currently know any Bobs I may someday. Now disallow URLs in the message
        // since CryptoBob is trying to get me to click on a link.
        const messageUrlMatch = message.match(getUrlRegExp());
        if (messageUrlMatch)
            throw new InvalidArgumentError("URLs not allowed in message", {
                displayMessage: errorDisplayMessage`Can not request access if your message includes a URL. We have this restriction to prevent automated spam bots from submitting the form. Remove “${messageUrlMatch[0]}” from your message and try again.`,
            });

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

export default function HomePage() {
    const id = useId().replace(/:/g, "_");
    const [name, setName] = useState("");
    const [emailAddress, setEmailAddress] = useState("");
    const [message, setMessage] = useState("");

    const isFormValid = name.length > 0 && emailAddress.length > 0 && emailAddress.includes("@");

    const fetcher = useFetcherWithSchema(ActionSchema);

    const [dismissedFetcherData, setDismissedFetcherData] = useState<SchemaType<
        typeof ActionSchema
    > | null>(null);

    // If the form submission was successful, clear our inputs.
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data?.ok) {
            setName("");
            setEmailAddress("");
            setMessage("");
        }
    }, [fetcher.data?.ok, fetcher.state]);

    const initialAppRenderId = useInitialAppRenderId();
    const [idForGeneration] = useState(initialAppRenderId ?? generateId());
    const randomBlobsSettings = useMemo(() => {
        const random = new StableRandom(idForGeneration);
        const hueSpread = random.randomInteger(idForGeneration, 0, 20, 80);
        const themeColorIndex = random.randomInteger(idForGeneration, 0, 0, themeColors.length - 1);
        const themeColor = themeColors[themeColorIndex] || "blue";
        return {
            seed: idForGeneration.replaceAll(/[^a-zA-Z0-9]/g, ""),
            hueSpread,
            themeColor,
        };
    }, [idForGeneration]);

    return (
        <Box
            display="flex"
            justifyContent="center"
            id={id}
            backgroundColor="grey-0"
            minHeight="full"
            // Create a new z-index stacking context
            position="relative"
            zIndex="0"
            padding="safe-area-inset"
        >
            <BlobsArt settings={randomBlobsSettings} />
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingY: {desktop: "32", mobile: "20"},
                    paddingX: "4",
                })}
            >
                <h1
                    className={sprinkles({
                        fontStyle: "bold",
                        fontSize: "900",
                    })}
                >
                    Want to see what we’re working on?
                </h1>
                <Spacer space="4" />
                <Box fontSize="200" color="grey-80" style={{lineHeight: "1.5rem"}}>
                    Alpine is the modern productivity suite. While we have a long way to go, we’re
                    giving some people access to the product so they can follow along.
                </Box>
                <Spacer space="8" />
                <fetcher.Form
                    method="post"
                    onSubmit={() => {
                        if (fetcher.data) setDismissedFetcherData(fetcher.data);
                    }}
                >
                    <Box fontSize="500" fontStyle="bold">
                        Request access
                    </Box>
                    <Spacer space="4" />
                    {fetcher.data && dismissedFetcherData !== fetcher.data && (
                        <>
                            {fetcher.data.ok ? (
                                <InlineAlert
                                    variant="positive"
                                    title="Requested access"
                                    onDismiss={() => setDismissedFetcherData(fetcher.data!)}
                                >
                                    If your request is approved we’ll send an email to{" "}
                                    {fetcher.data.emailAddress} with further instructions.
                                </InlineAlert>
                            ) : (
                                <ErrorInlineAlert
                                    title="Could not request access"
                                    error={fetcher.data.error}
                                    onDismiss={() => setDismissedFetcherData(fetcher.data!)}
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
                            isPending={fetcher.state === "submitting"}
                        >
                            Request
                        </Button>
                    </Box>
                </fetcher.Form>
                <Spacer space="32" />
                <Box paddingTop="2" borderTop="grey-10">
                    Already have an account? <Link url="/sign-in">Sign in</Link>
                </Box>
            </main>
        </Box>
    );
}
