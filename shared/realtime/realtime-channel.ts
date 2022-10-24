import {ObjectSchema, UnionSchema} from "~/shared/schema/schema";

/**
 * A channel we use for pushing messages in realtime from servers to any
 * connected clients.
 */
export interface RealtimeChannel<
    Key extends {[key: string]: string},
    Message extends {type: string},
> {
    readonly name: string;
    readonly keySchema: ObjectSchema<Key>;
    readonly messageSchema: UnionSchema<Message>;
}
