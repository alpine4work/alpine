import {json} from "@remix-run/cloudflare";
import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Alpha Management Tools - Cyberworlds",
    };
}

export function loader() {
    return json({});
}

export default function AlphaManagementPage() {
    return (
        <Box display="flex" justifyContent="center">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    padding: "4",
                })}
            >
                <h1
                    className={sprinkles({
                        typographySize: "heading4",
                        typographyStyle: "primarySemiBold",
                    })}
                >
                    Alpha Management Tools
                </h1>
                <Spacer space="4" />
                <Box typographySize="heading5" typographyStyle="primarySemiBold">
                    Access Requests
                </Box>
            </main>
        </Box>
    );
}
