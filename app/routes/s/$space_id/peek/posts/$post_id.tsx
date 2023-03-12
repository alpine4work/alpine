import PostRoute from "~/app/routes/s/$space_id/posts/$post_id";

export {loader} from "~/app/routes/s/$space_id/posts/$post_id";

export default function PostPeekRoute() {
    return <PostRoute isPeek={true} />;
}
