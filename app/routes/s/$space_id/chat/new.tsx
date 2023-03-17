import {MetaFunction} from "@remix-run/server-runtime";
import {ChatView} from "~/client/chat/chat_view";
import {Box} from "~/client/design/box";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";

export const meta: MetaFunction = () => {
    return {
        title: `New chat message${metaTitlePostfix}`,
    };
};

export default function NewChatRoute({isPeek}: {isPeek?: boolean}) {
    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={!isPeek ? {desktop: "4"} : undefined}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                backgroundColor="grey-0"
                borderRadius={!isPeek ? {desktop: "md"} : undefined}
                boxShadow="elevation-5"
            >
                <ChatView />
            </Box>
        </Box>
    );
}
