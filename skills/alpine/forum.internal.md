# Forum

Forum (comprised of posts in channels) is the primary place for communication in Alpine. Forum uses
asynchronous communication which lets people contribute their best thinking on their own schedule
which protects deep work. Compared to [chat](chat.internal.md) which is synchronous and designed for
immediate back-and-forths.

Conversations happen in posts. Posts are organized into channels.

The home page of Alpine (for humans) is an algorithmic "for you" feed made up of posts from around
the space (along with updates from other areas, e.g. new documents).

Posts go into "for you" feeds when created. Because feeds are algorithmically ranked so it's not
guaranteed everyone will see a post. People can also subscribe to channels to get a notification
when new posts are created. When you create a new channel, no one will be subscribed.

## Posts

A post (`/post/...`) with two comments looks like this:

```md
Post in [Marketing](/channel/marketing).

<time>May 14, 2026 3:00 PM EDT</time>

<post from="[Alice](/human/alice)">

If you had more marketing budget how would you use it?

</post>

<comment id="0" from="[Bob](/human/bob)">

Buy billboard ads.

</comment>

<comment id="1" from="[Carol](/human/carol)">

Sponsor conferences.

</comment>

End of comments.
```

A post's `<comment>` section uses the [messaging](messaging.internal.md) markdown format.

A `<post>` has the author in a `from` attribute and [rich-text content](content.internal.md) within.

A `/post/...` page starts with "Post in {Channel}", then by the `<time>` the post was created, then
the `<post>`, and then the `<comment>` section. Unless you're paginating to see more comments than
what could fit on one page (e.g. with `?after={id}`/`?comment={id}`, see
[messaging](messaging.internal.md) for more information on pagination).

### Post etiquette

Try to keep a post focused on a single conversation. If a post's conversation is growing long and
unfocused, propose creating a new post to split off part of the conversation.

You can use markdown image syntax to create a pretty post preview embed for humans (assume you've
used the `create` tool first to create `/post/rosie-in-...`):

```md
<comment from="[Rosie](/bot/rosie)">

Let's continue the conversation here:

![Rosie in …](/post/rosie-in-...)

</comment>
```

### Creating

You can create a post using the `create` tool. Example content:

```md
Post in [Marketing](/channel/marketing).

<post>

If you had more marketing budget how would you use it?

</post>
```

`from` is optional, you may only create posts as yourself. Don't include the `<time>`, that will be
decided by the server.

If you mention a human when creating a post (e.g. `[Alice](/human/alice), take a look at this`) then
the human will be sent a push notification which might not always be desirable.

## Channels

A channel organizes posts around a topic. Channel names are typically formatted as sentence case.

To find channels you can use the `search` tool with the query "all channels" or add the word
"channel" to a query to look for a specific channel (e.g. "engineering channel").

Markdown returned by `read` for a channel looks like this:

```md
# Random

A place for conversations that aren't about work. Share memes, ask for recommendations, or post
about whatever's on your mind.

---

<post from="[Alice](/human/alice)" time="May 14th at 11:15am EDT" comments="4">

Who else liked the movie that was released this week?

[See more »](/post/alice-in-random-...)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 9:47am EDT" comments="0">

Some photos of my cats that we took this weekend:

[See more »](/post/bob-in-random-...)

</post>

End of posts.
```

A channel has a name in a markdown h1, a description followed by `---`, and then the `<post>`s in
the channel in reverse chronological order. The post content is truncated, you can use the `read`
tool with the `/post/...` link to read the full post.

Each `<post>` has (as attributes) the `time` the post was created and the number of `comments` on
the post.

If a channel has more posts than will fit in the `read` tool's `limit` (20kb by default) then there
will be a "Next page" link you can use to paginate with an `?after={time}` search param.

### Creating

To create a channel, use the `create` tool and provide the channel name (required) and description
(optional). For example:

```md
# My Channel

This is a cool channel.
```

The description can be [rich text content](content.internal.md).

After creating a channel, you can create posts in the channel using the `create` tool with a type of
`post`.

### Updating

You can only update a `/channel/...` path's name and description with the `update` tool. If you want
to update a post's content then you need to use the `read` tool to read the full post and _then_ use
the `update` tool with the `/post/...` path.
