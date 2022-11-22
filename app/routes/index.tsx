import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {sprinkles} from "~/shared/styles/styles";

export default function HomePage() {
    return (
        <Box display="flex" justifyContent="center">
            <main
                className={sprinkles({
                    maxWidth: "128",
                    paddingY: "32",
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
                <Box paddingTop="4" paddingBottom="12" typographySize="body" userSelect="text">
                    Cyberworlds is the codename for a new workplace collaboration suite we&#x2019;re
                    building. There is not much to see yet, but if you know someone on the team you
                    can check out where we&#x2019;re at.
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
                    <Box userSelect="text">
                        For now, we&#x2019;re only letting people in who knows someone on the team.
                        You&#x2019;ll get an email if your application has been approved with
                        further instructions.
                    </Box>
                    <Button onPress={() => {}}>Apply for an account</Button>
                </Box>
                <Box marginTop="24" paddingTop="2" borderTop="grey-10">
                    Already have an account? Sign in
                </Box>
            </main>
        </Box>
    );
}
