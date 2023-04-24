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

/**
 * [Cloudflare Queues][1] are not available in `@cloudflare/workers-types` yet.
 *
 * [1]: https://developers.cloudflare.com/queues/platform/javascript-apis/
 */
export interface MessageBatch<Body = any> {
    readonly queue: string;
    readonly messages: Array<Message<Body>>;
    ackAll(): void;
    retryAll(): void;
}

export interface Message<Body = any> {
    readonly id: string;
    readonly timestamp: Date;
    readonly body: Body;
    ack(): void;
    retry(): void;
}
