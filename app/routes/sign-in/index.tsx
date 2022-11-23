import {ActionArgs, json} from "@remix-run/cloudflare";
import {Form, Link, useTransition} from "@remix-run/react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {Spacer} from "~/client/design/spacer";
import {ControlledTextInput} from "~/client/design/text_input";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Sign in to Cyberworlds",
        robots: "noindex",
    };
}

export async function action({request}: ActionArgs) {
    // TODO(calebmer): Implement this

    return json({});
}

export default function SignInPage() {
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
                    <Spacer space="6" />
                    <ControlledTextInput
                        formName="email"
                        label="Email"
                        placeholder="anthony.mose@company.com"
                        autoComplete="email"
                    />
                    <Spacer space="4" />
                    <Button
                        variant="accent"
                        shouldSubmitForm={true}
                        fullWidth={true}
                        isPending={useTransition().state === "submitting"}
                    >
                        Sign in
                    </Button>
                </Form>
                <Spacer space="32" />
                <Box paddingTop="2" borderTop="grey-10">
                    Don&#x2019;t have an account yet?
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
