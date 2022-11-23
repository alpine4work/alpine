import {EnvelopeSimple, PaperPlaneRight} from "phosphor-react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
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
                        userSelect: "text",
                    })}
                >
                    Want to see what we&#x2019;re working on?
                </h1>
                <Box
                    paddingTop="4"
                    paddingBottom="12"
                    typographySize="body"
                    color="grey-80"
                    userSelect="text"
                >
                    Cyberworlds is the codename for a new workplace collaboration suite we&#x2019;re
                    building. There&#x2019;s not much to see yet. We&#x2019;re giving some people
                    access to the product so they can follow along.
                </Box>
                <Box>
                    <Box
                        paddingBottom="3"
                        typographySize="heading5"
                        typographyStyle="primarySemiBold"
                    >
                        Sign up
                    </Box>
                    <Box>
                        <label>
                            Name
                            <input type="text" placeholder="Anthony Mose" />
                        </label>
                    </Box>
                    <Box>
                        <label>
                            Email
                            <input type="text" placeholder="anthony.mose@company.com" />
                        </label>
                    </Box>
                    <Box>
                        <label>
                            Message (optional)
                            <textarea placeholder="How do you know the team?" />
                        </label>
                    </Box>
                    <Box
                        display="flex"
                        flexDirection={{desktop: "row", mobile: "column"}}
                        gap={{desktop: "12", mobile: "4"}}
                        alignItems={{desktop: "flex-end", mobile: "flex-start"}}
                    >
                        <Box flexGrow="1" userSelect="text" color="grey-80">
                            For now, we&#x2019;re only letting in people who know someone on the
                            team. If your application is approved you&#x2019;ll get an email with
                            further instructions.
                        </Box>
                        <Button
                            icon={<PaperPlaneRight />}
                            iconPosition="trailing"
                            onPress={() => {}}
                        >
                            Apply
                        </Button>
                    </Box>
                </Box>
                <Box marginTop="24" paddingTop="2" borderTop="grey-10">
                    Already have an account? Sign in
                </Box>
            </main>
        </Box>
    );
}
