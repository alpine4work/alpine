import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {VirtualizedScrollView} from "~/client/virtualized/virtualized_scroll_view";
import {getSimpleChat} from "~/server/dynamo/simple_chat_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyMessageContent} from "~/shared/content/message_content_schema";
import {NotFoundError} from "~/shared/error/error";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {StableRandom} from "~/shared/helpers/number/stable_random";
import {SimpleChatId} from "~/shared/id/types/id_types";
import {createSimpleChatMessage} from "~/shared/rpc/simple_chat_rpc_definitions";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

const schema = Schema.object({
    simpleChatId: Schema.id<SimpleChatId>(),
});

export async function loader({params, context}: LoaderArgs) {
    const simpleChatId = Schema.id<SimpleChatId>().deserialize(params.simple_chat_id ?? null);

    const simpleChat = await getSimpleChat(await context.auth.authenticate(), simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    return jsonWithSchema(schema, {simpleChatId});
}

const stableRandom = new StableRandom("test");

export default function SimpleChatRoute() {
    const context = useAppContext();
    const {simpleChatId} = useLoaderDataWithSchema(schema);
    const [state, setState] = useState(ContentEditorState.create(emptyMessageContent));
    const [isSaving, setIsSaving] = useState(false);

    return (
        <main className={sprinkles({height: "full", display: "flex", flexDirection: "column"})}>
            <Box flexGrow="1" overflowY="hidden">
                <VirtualizedScrollView
                    itemCount={10_000}
                    getItem={index => ({
                        minHeight: 30,
                        key: index,
                        node: (
                            <Box
                                display="flex"
                                alignItems="center"
                                paddingX="4"
                                backgroundColor={index % 2 ? "grey-0" : "grey-wash"}
                                style={{height: stableRandom.randomInteger("test", index, 30, 100)}}
                            >
                                {index}
                            </Box>
                        ),
                    })}
                    pinTo="bottom"
                />
            </Box>
            <Box
                flexShrink="0"
                backgroundColor="grey-0"
                borderTop="grey-5"
                boxShadow="elevation-30"
            >
                <ContentEditor
                    state={state}
                    onChange={state => {
                        if (!isSaving) {
                            setState(state);
                        }
                    }}
                    onNavigate={useNavigate()}
                    aria-label="Message"
                    placeholder="Type a message here…"
                    className={sprinkles({paddingY: "4"})}
                    onEnter={() => {
                        if (isContentEmpty(state.getContent())) return;

                        runPromiseWithoutAwaiting(async () => {
                            setIsSaving(true);
                            try {
                                await createSimpleChatMessage(context, {
                                    simpleChatId,
                                    parentMessageId: null,
                                    content: state.getContent(),
                                });
                                setState(ContentEditorState.create(emptyMessageContent));
                            } catch (error) {
                                // TODO(calebmer): This shows nothing to the user?
                                context.tracer
                                    .getRoot()
                                    .logUncaughtException(
                                        "Could not create simple chat message",
                                        error,
                                    );
                            }
                            setIsSaving(false);
                        });
                    }}
                />
            </Box>
        </main>
    );
}
