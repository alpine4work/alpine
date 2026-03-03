import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Keys in the event object's `context` object we want to move into `context.peek`
 * with an "above" prefix.
 */
export type TracerEventDataContextPeekMoveIntoAboveKey = StripAbovePrefix<
    keyof NonNullable<NonNullable<TracerEventData["context"]>["peek"]>
>;

type StripAbovePrefix<Key extends string> = Key extends `above${infer KeyWithoutPrefix}`
    ? Uncapitalize<KeyWithoutPrefix>
    : never;

export const tracerEventDataContextPeekMoveIntoAboveKeys: {
    [K in TracerEventDataContextPeekMoveIntoAboveKey]: true;
} = {
    documentId: true,
    channelId: true,
    postId: true,
    chatId: true,
    taskId: true,
    taskCollectionId: true,
};
