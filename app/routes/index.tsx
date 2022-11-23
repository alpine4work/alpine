import {ActionArgs, json} from "@remix-run/cloudflare";
import {Form, Link} from "@remix-run/react";
import {useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {ControlledMultilineTextInput} from "~/client/design/multiline_text_input";
import {Spacer} from "~/client/design/spacer";
import {TextInput} from "~/client/design/text_input";
import {InvalidArgumentError} from "~/shared/error/error";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

export async function action({request}: ActionArgs) {
    const formData = await request.formData();

    const name = formData.get("name");
    const emailAddress = formData.get("emailAddress");
    const message = formData.get("message");

    if (typeof name !== "string")
        throw new InvalidArgumentError('Expected property "name" in form data');
    if (typeof emailAddress !== "string")
        throw new InvalidArgumentError('Expected property "email" in form data');
    if (typeof message !== "string")
        throw new InvalidArgumentError('Expected property "message" in form data');

    return json({});
}

export default function HomePage() {
    const [name, setName] = useState("");
    const [emailAddress, setEmailAddress] = useState("");

    const isFormValid = name.length > 0 && emailAddress.length > 0 && emailAddress.includes("@");

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
                        Request access
                    </Box>
                    <Spacer space="4" />
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
                            team. If your request is approved you&#x2019;ll get an email with
                            further instructions.
                        </Box>
                        <Button variant="accent" formSubmit={true} isDisabled={!isFormValid}>
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
