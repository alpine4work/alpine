import NewChatRoute from "~/app/routes/s/$space_id/chat/new";

export {meta, loader, unstable_shouldReload} from "~/app/routes/s/$space_id/chat/new";

export default function NewChatPeekRoute() {
    return <NewChatRoute isPeek={true} />;
}
