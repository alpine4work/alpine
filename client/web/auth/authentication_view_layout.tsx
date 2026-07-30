import {ReactNode} from "react";
import {
    authenticationViewPaddingBottom,
    authenticationViewPaddingTop,
    authenticationViewPaddingX,
} from "~/client/web/auth/internal/authentication_shared_styles.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";

export function AuthenticationViewLayout({children}: {children: ReactNode}) {
    return (
        <Box
            position="relative"
            zIndex="0"
            width="full"
            display="flex"
            justifyContent="center"
            paddingX={authenticationViewPaddingX}
            paddingTop={authenticationViewPaddingTop}
            paddingBottom={authenticationViewPaddingBottom}
            style={{minHeight: "inherit"}}
        >
            <main
                className={sprinkles({width: "full", minHeight: "full"})}
                style={{
                    // We use a slightly off spacing scale value for `maxWidth` so the "By signing up,
                    // you agree to our Terms of Service and Privacy Policy" text on the last step of
                    // sign up doesn't wrap onto two lines.
                    maxWidth: addRemLengths("96", "4"),
                }}
            >
                {children}
            </main>
        </Box>
    );
}
