import ChatRoute from "~/app/routes/s/$space_id/chat/$chat_id";

export {meta, loader} from "~/app/routes/s/$space_id/chat/$chat_id";

export default function ChatPeekRoute() {
    return <ChatRoute isPeek={true} />;
}
