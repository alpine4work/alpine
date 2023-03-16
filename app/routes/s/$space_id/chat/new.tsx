import {MetaFunction} from "@remix-run/server-runtime";
import {ChatView} from "~/client/chat/chat_view";
import {Box} from "~/client/design/box";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";

export const meta: MetaFunction = () => {
    return {
        title: `New chat message${metaTitlePostfix}`,
    };
};

export default function NewChatRoute() {
    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={{desktop: "4"}}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                backgroundColor="grey-0"
                borderRadius={{desktop: "md"}}
                boxShadow="elevation-5"
            >
                <ChatView />
            </Box>
        </Box>
    );
}
