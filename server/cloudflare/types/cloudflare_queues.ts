/**
 * [Cloudflare Queues][1] are not available in `@cloudflare/workers-types` yet.
 *
 * [1]: https://developers.cloudflare.com/queues/platform/javascript-apis/
 */
export interface Queue<Body = any> {
    send(message: Body): Promise<void>;
    sendBatch(messages: Iterable<MessageSendRequest<Body>>): Promise<void>;
}

type MessageSendRequest<Body = unknown> = {
    body: Body;
};
