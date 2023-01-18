import {getSimpleChat} from "~/server/dynamo/simple_chat_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {SimpleChatId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

const schema = Schema.object({});

export async function loader({params, context}: LoaderArgs) {
    const simpleChatId = Schema.id<SimpleChatId>().deserialize(params.simple_chat_id ?? null);

    const simpleChat = await getSimpleChat(await context.auth.authenticate(), simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    return jsonWithSchema(schema, {});
}

export default function ChannelRoute() {
    return <main></main>;
}
