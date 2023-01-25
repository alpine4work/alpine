import {useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {MessagingView, getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getSimpleChat} from "~/server/dynamo/simple_chat_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyMessageContent} from "~/shared/content/message_content_schema";
import {NotFoundError} from "~/shared/error/error";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {SimpleChatId} from "~/shared/id/types/id_types";
import {SimpleChatMessageModel, SimpleChatModel} from "~/shared/models/simple_chat_model";
import {
    createSimpleChatMessage,
    getSimpleChatMessagesFromEnd,
    getSimpleChatMessagesFromStart,
} from "~/shared/rpc/simple_chat_rpc_definitions";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

const schema = Schema.object({
    simpleChat: SimpleChatModel.schema(),
    simpleChatMessagesResult: Schema.object({
        hasMoreMessagesBefore: Schema.boolean,
        messages: Schema.array(SimpleChatMessageModel.schema()),
    }),
});

export async function loader({params, context}: LoaderArgs) {
    const simpleChatId = Schema.id<SimpleChatId>().deserialize(params.simple_chat_id ?? null);

    const simpleChat = await getSimpleChat(await context.auth.authenticate(), simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    const simpleChatMessagesResult = await getSimpleChatMessagesFromEnd(
        await context.auth.authenticate(),
        {
            simpleChatId: simpleChat.id,
            limit: getInitialLoadMessageCount(context.loader.clientInfo),
            beforeMessageId: null,
            afterMessageId: null,
        },
    );

    return jsonWithSchema(schema, {simpleChat, simpleChatMessagesResult});
}

export default function SimpleChatRoute() {
    const context = useAppContext();
    const {simpleChat, simpleChatMessagesResult} = useLoaderDataWithSchema(schema);
    const [state, setState] = useState(ContentEditorState.create(emptyMessageContent));
    const [isSaving, setIsSaving] = useState(false);

    return (
        <main className={sprinkles({height: "full", display: "flex", flexDirection: "column"})}>
            <Box flexGrow="1" overflowY="hidden">
                <MessagingView
                    initialState={useMemo(
                        () => ({
                            from: "End",
                            totalMessageCount: simpleChat.messageCount,
                            hasMoreMessagesBefore: simpleChatMessagesResult.hasMoreMessagesBefore,
                            messages: simpleChatMessagesResult.messages,
                        }),
                        [
                            simpleChat.messageCount,
                            simpleChatMessagesResult.hasMoreMessagesBefore,
                            simpleChatMessagesResult.messages,
                        ],
                    )}
                    shimmerRandomSeed={simpleChat.id}
                    onLoadFromStart={({limit, afterMessageId, beforeMessageId}) => {
                        return getSimpleChatMessagesFromStart(context, {
                            simpleChatId: simpleChat.id,
                            limit,
                            afterMessageId,
                            beforeMessageId,
                        });
                    }}
                    onLoadFromEnd={({limit, afterMessageId, beforeMessageId}) => {
                        return getSimpleChatMessagesFromEnd(context, {
                            simpleChatId: simpleChat.id,
                            limit,
                            afterMessageId,
                            beforeMessageId,
                        });
                    }}
                />
            </Box>
            <Box
                flexShrink="0"
                backgroundColor="grey-0"
                borderTop="grey-5"
                boxShadow="elevation-30"
                height="16"
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
                                    simpleChatId: simpleChat.id,
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
