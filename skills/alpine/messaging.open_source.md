# Messaging

Alpine has one messaging system used across several surfaces:

- Chat messages (`/chat/...`)
- Post comments (`/post/...`)
- Document comments (`/document/.../comments/...`)
- Task comments (`/task/.../comments`)

Sometimes we refer to a message as `<message>` (like in a chat) and sometimes we refer to messages as `<comment>` (like in a post). Whether we refer to a message as “message” or “comment”, they behave the same. In this document we will use the term “message” (and `<message>`).

Alpine messages work like messages in any other chat app. When someone sends a message it’s added to the bottom of the list and all other participants are sent a notification. Messages markdown looks like this:

```md
<time>May 14, 2026 3:00 PM EDT</time>

<message id="0" from="[Alice](/human/alice)">

How are you doing?

</message>

<message id="1" from="[Bob](/human/bob)">

I’m doing well, how about you?

</message>
```

Attributes on `<message>`:

- `id`: The internal `id` for a message that won’t be seen by a human.

- `from`: The author of the message.

- `time` or `timezone` (optional): When the message was sent. There may also be a `<time>` above the message telling you the time when below messages were sent.

Messages support [rich text content](content.md) formatting and may have some attached [files](files.md) (which are always listed at the end).

If a message uses the reply feature, it will have a `<blockquote>` with a `cite` attribute referencing another message:

```md
<time>May 14, 2026 3:00 PM EDT</time>

<message id="0" from="[Alice](/human/alice)">

How are you doing?

</message>

<message id="1" from="[Bob](/human/bob)">

<blockquote cite="?message=0">

[Alice](/human/alice): How are you doing?

</blockquote>

I’m doing well, how about you?

</message>
```

We sometimes visually merge two messages sent by the same author if they are made around the same time. For example:

```md
<message id="2-3">

How was your weekend?

I went to the farmer’s market.

</message>
```

…is the same as:

```md
<message id="2">

How was your weekend?

</message>

<message id="3">

I went to the farmer’s market.

</message>
```

## Pagination

Often, there will be many messages and you’ll need to paginate to see them all. You paginate by calling the `read` tool with search params. The `read` tool will load enough messages to fit in `limit` and nothing more (by default that’s 20kb of messages). If we have `/chat/{name}` and you’ve loaded messages with `id="0"` through `id="7"` then you’d use `/chat/{name}?after=7` to get the next page of messages.

Available search params:

- `?after={id}`: Load messages after `id` (exclusive).
- `?before={id}`: Load messages before `id` (exclusive).
- `?start`: Load messages from the start of the message list. (`/chat/...` reads messages from end by default.)
- `?end`: Load messages from the end of the message list. (`/post/...`, `/document/.../comments/...`, and `/task/.../comments` read messages from start by default.)
- `?message={id}` (or `?comment={id}`): Load messages around `id` (inclusive). Will load some messages before and after `id`.

## Updating

You can use the `update` tool to create and update messages. You use the same `<message>` syntax to create new messages. A couple of differences, when creating a `<message>`:

- You don’t need to include `from`. It will be automatically set to your account.

- You must not include `id`, `time`, or `timezone` as they will be set by the server.

- You must always add a message to the end of a message list. Make sure you’ve first paginated to the end of the message list by checking if your last `read` tool call ended with `End of messages.` (or `End of comments.`).

Remember, if you mention a human (e.g. `Hi [Alice](/human/alice)!`) then the human will be sent a push notification which might not always be desirable.

You must create new `<message>`s at the end of a message list. Remember you can quickly paginate to the end of a message list with the `?end` search param.

You must include a newline after the `<message>` open tag and before the `</message>` close tag. This is due to a quirk in markdown HTML parsing.

Doesn’t work:

```md
<message>Hello, world!</message>
```

Doesn’t work:

```md
<message>
Hello, world!
</message>
```

Works:

```md
<message>

Hello, world!

</message>
```

You may include a `<blockquote>` when creating a new `<message>` to reply to another message. Doing this will create a link between the two messages that a user may click to jump around.

Your `<blockquote>` must include a `cite="?message={id}"` attribute with the `id` of the message you’re quoting and your `<blockquote>` must start with a link to the author followed by a colon (e.g. `[Alice](/human/alice): ...`). After that, you must exactly match the content you’re quoting. The skill file [content quoting](content-quoting.md) has more information on the finer details of quoting with `<blockquote>`.
