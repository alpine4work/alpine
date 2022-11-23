import {ActionArgs, json} from "@remix-run/cloudflare";
import {Form, useParams, useTransition} from "@remix-run/react";
import {useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {Spacer} from "~/client/design/spacer";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Sign in to Cyberworlds",
        // Ask Google to not index this page.
        robots: "noindex",
    };
}

export async function action({request}: ActionArgs) {
    // TODO(calebmer): Implement this

    return json({});
}

// TODO(calebmer): This one time sign in code UI is a little janky. Polish it!
// We probably want a separate input for every number instead of one input for
// all six numbers. Then good keyboard support.
export default function SignInEmailCodePage() {
    const params = useParams();
    const emailAddress = params.email_address;

    const [code, setCode] = useState("");

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
                <Form method="post">
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
                        We sent a one time sign in code to your email{" "}
                        <span
                            className={sprinkles({
                                typographyStyle: "primarySemiBold",
                                color: "grey-100",
                            })}
                        >
                            {emailAddress}
                        </span>
                        . Type the code in here.
                    </Box>
                    <Spacer space="6" />
                    <Box position="relative">
                        <input
                            placeholder="000000"
                            value={code}
                            onChange={event => {
                                const value = event.currentTarget.value;

                                // Don't allow a user to type unsupported characters into our code.
                                setCode(value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6));
                            }}
                            className={sprinkles({
                                display: "block",
                                width: "full",
                                paddingY: "1",
                                backgroundColor: "transparent",
                                typographyStyle: "code",
                                typographySize: "heading2",
                            })}
                            style={{
                                letterSpacing: "0.53rem",
                                paddingLeft: "0.14rem",
                                transform: "translateY(0.12rem)",
                            }}
                            spellCheck="false"
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
                            <Box flexGrow="1" height="full" borderRadius="base" border="grey-10" />
                            <Box flexGrow="1" height="full" borderRadius="base" border="grey-10" />
                            <Box flexGrow="1" height="full" borderRadius="base" border="grey-10" />
                            <Box flexGrow="1" height="full" borderRadius="base" border="grey-10" />
                            <Box flexGrow="1" height="full" borderRadius="base" border="grey-10" />
                            <Box flexGrow="1" height="full" borderRadius="base" border="grey-10" />
                        </Box>
                    </Box>
                    <Spacer space="6" />
                    <Button
                        variant="accent"
                        shouldSubmitForm={true}
                        fullWidth={true}
                        isPending={useTransition().state === "submitting"}
                    >
                        Sign in
                    </Button>
                </Form>
            </main>
        </Box>
    );
}
