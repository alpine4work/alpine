import {MetaFunction} from "@remix-run/server-runtime";
import {ChatRoute} from "~/client/chat/chat_route";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";

export const meta: MetaFunction = () => {
    return {
        title: `New chat message${metaTitlePostfix}`,
    };
};

export default function NewChatRoute() {
    return <ChatRoute />;
}
