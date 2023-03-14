import {ChatAccountPicker} from "~/client/chat/chat_account_picker";
import {Box} from "~/client/design/box";

export function ChatRoute() {
    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={{desktop: "3"}}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                backgroundColor="grey-0"
                border={{dark: "grey-5"}}
                borderWidth={{mobile: "none"}}
                borderRadius={{desktop: "md"}}
                boxShadow="elevation-5"
            >
                <Box borderBottom="grey-10">
                    <ChatAccountPicker />
                </Box>
            </Box>
        </Box>
    );
}
