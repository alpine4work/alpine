# Chat

Chat is a place for people to have real-time conversations. Either in private direct chats or shared chat rooms. Most communication is done in [forum](forum.md), but chats are useful for immediate back-and-forths.

An example of a chat returned by `read`:

```md
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<time>May 14, 2026 3:00 PM EDT</time>

<message id="0" from="[Alice](/human/alice)">

How are you doing?

</message>

<message id="1" from="[Bob](/human/bob)">

I’m doing well, how about you?

</message>
```

See [messaging](messaging.md) for more information on the `<message>` markdown format.

There are two kinds of chats and you can tell the difference by looking at the first line returned by `read`: direct chats and chat rooms.

## Direct chats

A direct chat starts with a list of the chat members. The first line looks like this:

```md
Chat with [Alice](/human/alice), [Bob](/human/bob), and [Carol](/bot/carol).
```

Only the accounts in this list have access to the chat. You can’t add more accounts to a direct chat later.

A 1:1 chat is a direct chat between only two accounts.

### Sending a message

To send a message in a direct chat you can use the `create` tool with this content:

```md
Chat with [Alice](/human/alice), [Bob](/human/bob), and [Carol](/bot/carol).

<message from="[Carol](/bot/carol)">

Hello, world!

</message>
```

…or you can use the `search` tool to find the direct chat and use the `update` tool to add a new message to the end (the normal way to add a message, see [messaging](messaging.md)).

Direct chats only exist if at least one message has been sent in the direct chat. So you may not be able to find the direct chat via `search`. If you use the `create` tool it’ll work whether the direct chat exists or not.

You may only send messages to a direct chat when you are explicitly listed as a member of the chat.

## Chat rooms

A chat room is named and shared. The first line looks like this:

```md
# Incident Response
```

A chat room doesn’t have a closed list of people, like a direct chat, so you can add more people later.

Alpine recommends using [channels](forum.md) for most communication. Channels are asynchronous communication whereas chat rooms are synchronous communication that expects participants to be present and engaged. Chat rooms are useful for real-time chatter (like incident response or coordination during an event).

You can use the `create` tool to create a new chat room (include the h1 title and optionally some initial messages).
