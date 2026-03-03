import {useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export function DatabaseView() {
    const [query, setQuery] = useState("");

    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            gap="3"
            padding="4"
        >
            <Box fontSize="200" fontStyle="semi-bold">
                Database
            </Box>
            <textarea
                className={sprinkles({
                    display: "block",
                    width: "full",
                    fontSize: "75",
                    fontStyle: "code",
                    backgroundColor: "grey-0",
                    color: "grey-100",
                    borderRadius: "1",
                    boxShadow: "elevation-5-with-grey-10-border",
                    padding: "2",
                })}
                style={{
                    resize: "vertical",
                    minHeight: 120,
                }}
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder="SELECT * FROM ..."
            />
            <Box display="flex">
                <Button
                    variant="neutral"
                    onPress={() => {
                        // TODO: Execute query
                    }}
                >
                    Run
                </Button>
            </Box>
        </Box>
    );
}
