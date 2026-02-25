# \[2026-02-25\] Chat Rooms

## Context

Alpine's chat feature initially only supported direct chats: conversations between a fixed set of
accounts. To be a compelling alternative to Slack/Discord, Alpine also needs named, shared chat
rooms that any number of people can join. A room chat has a name, an access policy controlling who
can participate, and a subscription model so members can opt in to notifications.

A core user scenario is converting a direct chat into a room chat. For instance, a direct team chat
needs to grow to support new members without losing its message history.

## Decision

Room chats are implemented by extending the existing `Chat` entity rather than creating a separate
database table. The `ChatModel` gains a `definition` field typed as a `ChatModelDefinition`
discriminated union:

```ts
type ChatModelDefinition =
    | {
          type: "Direct";
          accounts: ReadonlyArray<AccountModel>;
      }
    | {
          type: "Room";
          name: string;
          accessPolicy: AccessPolicy;
          previewAccounts: ReadonlyArray<AccountModel>; // 1–2 accounts for avatar pile display
      };
```

The two variants reflect the fundamentally different membership models:

- **Direct chats** have a fixed, immutable list of `accounts`. No one can join or leave.
- **Room chats** have a `name`, an `accessPolicy` (the same access policy model used across Alpine
  for documents, channels, etc.), and a `previewAccounts` list of 1–2 accounts used for avatar pile
  display in navigation and chat lists.

### Converting a direct chat into a room chat

Accounts can convert a direct chat into a room chat via `convertDirectChatToRoomChat`. The
conversion is **irreversible** — there is no path back from a room chat to a direct chat. The full
message history is preserved across the conversion because the underlying `Chat` entity is the same
row in DynamoDB.

### Access and subscriptions

For room chats, _access_ and _subscriptions_ are separate concepts:

- **Access** (governed by `accessPolicy`) controls who is allowed to view and participate in the
  room. This uses the same `AccessPolicy` type used by documents, channels, and other shared
  entities in Alpine.
- **Subscriptions** control who receives inbox entries and notifications for messages in the room.
  Accounts must explicitly subscribe to a room chat to get notifications. Subscribing does not grant
  access; an account must have access to subscribe.

Direct chats do not have subscriptions — every participant automatically receives notifications.

### Version field

A `version` integer field was added to `ChatModel`. Because the `Chat` entity is now mutable (its
name and access policy can change), the client may receive the same chat's model from multiple
sources (e.g., the initial HTTP load and a real-time WebSocket update). The `version` field lets the
client determine which copy is newer and discard stale data.

### Room chats as mentionable entities

Chats (room and direct alike) are added to `SearchMentionEntityId`, making them mentionable in rich
text content and linkable via entity previews. The motivation is the same as for channels: a named
room chat like "Engineering Chat" is an entity with identity that coworkers would naturally
reference, e.g. "check out @Engineering Chat for more context."

As a consequence of sharing the `Chat` entity type, direct chats also needed to gain support for
file entity previews and the mention machinery. This broadened the scope of the work but left the
system more complete. We don't expect many direct chat mentions.

### Search indexing

Both direct and room chats are indexed in search. For room chats the index includes the room's name
as well as message content, enabling keyword search to find rooms by name. A dedicated
`searchRoomChatsByKeywords` function is exposed for room-specific search. It uses `tags` to filter
out direct chats (room chats get a tag simply called `room`).

### Realtime chat model updates

Previously `ChatModel` was essentially immutable after creation. Room chats introduce mutations
(name changes, access policy changes) that need to propagate to all connected clients in realtime.
The `ChatRealtimeProtocol` (the WebSocket connection used per-chat for message delivery) was
extended with new procedures (`updateRoomChatName`, `updateRoomChatAccessPolicy`,
`convertDirectChatToRoomChat`) and a new `UpdateChat` event that broadcasts the updated `ChatModel`
to all connected clients after any of these mutations.

### Chat account picker

`ChatAccountPicker` is the combobox at the top of the "new chat" view where users address a
conversation. It was significantly refactored to support selecting room chats as a first-class
destination alongside individual accounts.

**Selection state.** The picker's selection state is a discriminated union:

```ts
type ChatAccountPickerSelectionState =
    | {type: "Accounts"; accounts: ReadonlyArray<AccountModel>}
    | {type: "RoomChat"; id: ChatId; name: string};
```

Selecting a room chat is **mutually exclusive** with selecting accounts. A room chat has its own
membership defined by its access policy, which could be unbounded (e.g., shared with everyone in the
space). Adding individual accounts on top of a room selection therefore doesn't make sense — to
message specific people you create a direct chat instead.

When a room chat is selected, the combobox closes and text input is disabled. Pressing backspace
clears the selection.

**Item types.** The picker has three internal item types:

- `Account` — an individual space member. Selecting one adds them to a multi-person direct chat.
- `SuggestedDirectChat` — a direct chat surfaced from the server's suggested chats list. The full
  `ChatModel` is available; selecting one populates the accounts selection from the chat's member
  list.
- `SearchUnknownChat` — a chat surfaced from the affinity list or keyword search results, where only
  a `SearchEntityModel` (not a full `ChatModel`) is available. The picker does not know at this
  point whether it is a direct or room chat.

This setup was a natural extension of the code as it existed (which previously only had `Account`
and `SuggestedDirectChat`). This approach was not chosen from first principles.

**Distinguishing direct vs room in search results.** The `SearchEntityModel` uses a shared media
format (`Account`, `AccountPile`) that predates room chats. Rather than add chat-type information to
the search entity media, the picker infers the type: an `AccountPile` with a non-null `accountCount`
is treated as a direct chat; anything else is assumed to be a room chat. The same heuristic is used
in other parts of the codebase that display chat search entity media. This is a known approximation
— it may need to be revisited by adding an explicit type field to chat search entity media.

When a `SearchUnknownChat` that looks like a direct chat is selected, the picker issues a lazy
`getChat` RPC call to load the actual member list before updating the selection state. A loading
spinner is shown on the list item while this call is in flight. If the call reveals the chat is
actually a room (possible during a race condition where a direct chat was just converted), the
picker switches to `RoomChat` selection instead. If it's a direct chat then we set selection state
to `Accounts` with all members of the chat.

**Hybrid search.** The picker combines two search strategies:

- **Local Fuse.js search** over the already-loaded accounts and suggested chats. Fast and
  synchronous.
- **Server-side `searchRoomChatsByKeywords`** for keyword search. This is required because the
  affinity list only covers entities the user has recently interacted with; server search is needed
  to discover rooms the user has never visited or hasn't visited recently.

Results are interleaved: local results with a high Fuse.js confidence score (< 0.2) appear first,
then server keyword results, then low-confidence local results. Duplicate items (same chat ID
appearing in both sources) are deduplicated by key.

`searchRoomChatsByKeywords` calls are throttled: the picker only issues a new request after the
previous one has completed. This prevents the server from being flooded with requests on every
keystroke. The call also accepts a `contributorIds` parameter — the IDs of already-selected accounts
— which filters room results to rooms where those accounts have sent messages.

### Inbox entries when access is lost

When an account loses access to a room chat they have an inbox entry for, the inbox entry continues
to show the notification (author, created time, mention flag) but the message content snippet is
hidden. This is consistent with how Alpine handles other entity types when access is revoked — the
user may have already seen the content via push notification, and hiding it respects the intent of
the access revocation.

## Consequences

Because `Direct` and `Room` are variants of the same entity, code that handles chats —
notifications, search, file attachments, mentions, inbox entries — must handle both variants. This
added complexity to several areas (notifications, inbox model, search indexing, file entity
previews) that previously only needed to handle the single direct-chat case.

The upside is that converting a direct chat to a room chat is straightforward and lossless: it is a
single in-place mutation of the `ChatModelDefinition` field, and all prior messages remain
associated with the same chat ID.

Room chat notifications are currently treated as loud (same as direct chat notifications). Whether
room chat notifications should be loud or subtle — and whether this should differ from busy direct
chats with many participants — is an open question that may warrant revisiting.

## Alternatives considered

The primary alternative was a **separate database table for room chats**, making room chats a
distinct entity type from direct chats.

Advantages of a separate table:

- Direct chats would have remained a simpler type with no need to support mentions, file entity
  previews, or access-policy-aware inbox handling.
- The two entity types would have been fully independent, keeping direct-chat code paths clean.

Disadvantages:

- **Preserving message history on conversion would have been very hard.** When a user promotes a
  direct chat to a room, the expectation is that the full conversation history carries over. With
  separate tables this would have required migrating or copying all messages from one entity to
  another, which is complex and error-prone.
- The code simplification would likely have been temporary. File entity previews and mentions for
  direct chats would probably have been needed eventually anyway, just deferred.

Preserving message history on conversion was the deciding factor in choosing the unified entity
approach.
