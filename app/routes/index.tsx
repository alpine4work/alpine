import {ActionArgs, json} from "@remix-run/cloudflare";
import {Form, Link} from "@remix-run/react";
import {EnvelopeSimple} from "phosphor-react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {ControlledMultilineTextInput} from "~/client/design/multiline_text_input";
import {Spacer} from "~/client/design/spacer";
import {ControlledTextInput} from "~/client/design/text_input";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

export async function action({request}: ActionArgs) {
    // TODO(calebmer): Implement this

    return json({});
}

export default function HomePage() {
    return (
        <Box display="flex" justifyContent="center">
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
                        typographyStyle: "primarySemiBold",
                        typographySize: "heading3",
                    })}
                >
                    Want to see what we&#x2019;re working on?
                </h1>
                <Spacer space="4" />
                <Box typographySize="body" color="grey-80">
                    Cyberworlds is the code name for a new workplace collaboration suite
                    we&#x2019;re building. While we have a long way to go, we&#x2019;re giving some
                    people access to the product so they can follow along.
                </Box>
                <Spacer space="8" />
                <Form method="post">
                    <Box typographySize="heading5" typographyStyle="primarySemiBold">
                        Sign up
                    </Box>
                    <Spacer space="4" />
                    <ControlledTextInput
                        formName="name"
                        label="Name"
                        placeholder="Anthony Mose"
                        autoComplete="name"
                    />
                    <Spacer space="3" />
                    <ControlledTextInput
                        formName="email"
                        label="Email"
                        placeholder="anthony.mose@company.com"
                        autoComplete="email"
                    />
                    <Spacer space="3" />
                    <ControlledMultilineTextInput
                        formName="message"
                        label="Message (optional)"
                        placeholder="How do you know the team?"
                    />
                    <Spacer space="8" />
                    <Box
                        display="flex"
                        flexDirection={{desktop: "row", mobile: "column"}}
                        gap={{desktop: "12", mobile: "4"}}
                        alignItems={{desktop: "flex-end", mobile: "flex-start"}}
                    >
                        <Box flexGrow="1" color="grey-80">
                            For now, we&#x2019;re only letting in people who know someone on our
                            team. If your application is approved you&#x2019;ll get an email with
                            further instructions.
                        </Box>
                        <Button formSubmit={true} icon={<EnvelopeSimple />} iconPosition="trailing">
                            Apply
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
