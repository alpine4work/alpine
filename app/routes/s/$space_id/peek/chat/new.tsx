import NewChatRoute from "~/app/routes/s/$space_id/chat/new";

export {meta} from "~/app/routes/s/$space_id/chat/new";

export default function NewChatPeekRoute() {
    return <NewChatRoute isPeek={true} />;
}
