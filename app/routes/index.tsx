import {EnvelopeSimple} from "phosphor-react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {ControlledMultilineTextInput} from "~/client/design/multiline_text_input";
import {Spacer} from "~/client/design/spacer";
import {ControlledTextInput} from "~/client/design/text_input";
import {sprinkles} from "~/shared/styles/styles";

export default function HomePage() {
    return (
        <Box display="flex" justifyContent="center">
            <main
                className={sprinkles({
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
                <Box>
                    <Box typographySize="heading5" typographyStyle="primarySemiBold">
                        Sign up
                    </Box>
                    <Spacer space="4" />
                    <ControlledTextInput
                        label="Name"
                        placeholder="Anthony Mose"
                        autoComplete="name"
                    />
                    <Spacer space="3" />
                    <ControlledTextInput
                        label="Email"
                        placeholder="anthony.mose@company.com"
                        autoComplete="email"
                    />
                    <Spacer space="3" />
                    <ControlledMultilineTextInput
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
                        <Button
                            icon={<EnvelopeSimple />}
                            iconPosition="trailing"
                            onPress={() => {}}
                        >
                            Apply
                        </Button>
                    </Box>
                </Box>
                <Spacer space="32" />
                <Box paddingTop="2" borderTop="grey-10">
                    Already have an account? Sign in
                </Box>
            </main>
        </Box>
    );
}
