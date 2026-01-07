# \[2023-04-21\] Notifications table

## Context

This cycle I (@calebmer) am building the
[inbox feature](https://alpine.inc/s/111hc413nfdxa6vwspnhm3ejsc/documents/r0jzswspqf11nmy1g0zh3n6y4r).
Inbox aggregates all notifications the user receives into an easy to triage surface. You should read
the principles from that document to understand the product goals. In this document we will focus on
the technical solutions to implement the final product designs. Specifically the following features:

- **Notification grouping:** Instead of getting individual notifications for every new comment in a
  thread, you get one new notification that groups all updates together. When you switch inbox
  entries you are switching contexts.

- **Loud notifications:** By default, notifications do not increase your notification count or give
  you a little red badge. Only “loud” (aka urgent) notifications do this. Currently, you get a loud
  notification when:
    1. You are mentioned in a post or comment or chat.

    2. You get a new message in a chat. You get one new loud notification every hour. So if someone
       sends you 10 chat messages in an hour you get one new loud notification. Then if they send
       you another chat message as a reminder an hour later you get a second loud notification. This
       way the loud notification is attempting to count something relevant to you as the message
       receiver (vs message count which is not usually a good map to idea count).

- **Quantum inbox state:** The order of notifications in the user’s inbox is in a state of “quantum
  superposition” until the user observes the inbox at which point notifications freeze. When the
  user leaves their inbox, new notifications again are in a quantum state on top of previous frozen
  notifications. The applications of the quantum inbox state right now:
    1.  When the user observes their inbox we put loud notifications at the top. No matter when the
        loud notification was created. Then they freeze in place. So if the user gets more
        notifications without addressing a loud notification then the loud notification “decays”,
        drifting to the bottom of the inbox as new stuff piles on top.

    2.  The inbox entry for new channel posts and new document comment threads accumulates new
        posts/threads while the inbox is unobserved. Then when the inbox is observed we freeze the
        entry and start a new entry for new posts/threads.

- **Implicit notification dismissal:** Instead of having a read/unread state and using that to
  dismiss notifications, a better approximation of “complete” for a notification is when the user
  actually responds to a notification. They are then waiting for an update from the person they are
  communicating with.

    When you send a message to a chat (or post or whatever) you have an inbox entry for it should
    dismiss the entry and put it in your “done” section.

## Decision

(Up-to-date technical design documentation is in the `server/dynamo/notifications_table.ts` file.)

The notifications table uses our DynamoDB general realtime abstraction. Each partition represents an
account’s inbox in a given space. Some terminology:

- **Notification event:** An event that creates a notification. For example, sending a chat message
  or creating a post.
- **Inbox entry:** An entry that appears in an account’s inbox. These entries are grouped and sorted
  based on heuristics.

So user A might send a message creating a notification event. That notification event is put in a
queue and fanned out to the inboxes of users B and C. User B already has an inbox entry for this
chat so their inbox entry is updated since we group updates for the same chat together. User C does
not yet have an inbox entry for this chat so we create a new inbox entry for them.

The fan-out is also where we implement implicit notification dismissal. User A (the message sender)
is also a subscriber of this chat. So when we fan-out to user A’s inbox we “archive” their inbox
entry.

This fan-out happens in `processNotificationEvent()` in `server/dynamo/notifications_table.ts`.

So there’s one notification event and N inbox entries (one for each subscriber). Inbox entries do
not map 1:1 with notification events, though, since inbox entries may group multiple notification
events together.

(Currently we use [Cloudflare Queues](https://developers.cloudflare.com/queues/) but will probably
switch to [AWS SQS](https://aws.amazon.com/sqs/) soon when we switch from
[Cloudflare Workers](https://workers.cloudflare.com/) for our app server to
[AWS EC2](https://aws.amazon.com/ec2/). More on this in a future decision log entry.)

### Inbox generation

To implement quantum inbox states we have this concept called the “inbox generation”. Inbox entries
are sorted by the tuple: `[isArchived, generation, enteredTime]`.

You can’t read archived entries mixed with active entries so that’s the first order member.

Then generation is an integer as the second order member. The account’s inbox has a current
generation so when we create an inbox entry we set the entry’s generation to the inbox generation.
If this inbox entry has loud notifications (maybe a mention) then the entry’s generation is set to
the inbox’s generation +1. This is how we put loud notifications at the top of the inbox. When the
user observes their inbox we increment the inbox generation +2. This freezes old loud notifications
in position since new inbox entries will be at a higher generation.

Entered time is the time the inbox entry was created. Even if there are more updates to the inbox
entry it generally stays in its initial position. We may change the entered time to move the inbox
entry within the inbox.

### Primary key layout vs. index key layout

The primary key of an inbox entry is its “group key”. That is a key we can use to group multiple
notification events together. In order to group multiple updates for a post together we need to be
able to address an inbox entry by `[accountId, postId]`.

The sort order of the inbox (using the tuple `[isArchived, generation, enteredTime]`) comes from its
index which includes the _entire entry item_. This doubles all our write costs to the table! Since
we need to write the entire item to both the base table and the index. But it’s important that
queries against the index our fast since that’s how notifications will be read by users.

Since we need to write to index entries by some group key but read them in order we need this
design. We can’t use the sort order as the primary key since the sort order of an entry needs to
change over time and you can’t update a DynamoDB item’s primary key.

## Consequences

I (@calebmer) expect the notifications table will be one of our most expensive DynamoDB tables. Each
inbox entry update has a high cost. Just counting the
[Write Capacity Units (WCU)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html)
for an inbox entry update:

1. We need 1-2 WCU (times item size) to write the inbox entry item to the base table
2. We need 1-4 WCU (times item size) to write the inbox entry item to the index
3. We need 0-2 WCU to write an update to the account’s inbox summary item to the base table
4. We need 1-2 WCU to write to our realtime event log

Then multiply that by the number of accounts we need to fan-out to. Consider we need to run this for
every new message.

I don’t think I could do good capacity planning math right now given I have basically no usage data,
but relatively the cost here is exponentially higher than other features I’ve built on DynamoDB so
far.

If cost becomes a problem, I don’t think it wouldn’t be hard to switch this workload to
[Cassandra](https://cassandra.apache.org/_/index.html) or
[FoundationDB](https://www.foundationdb.org/). We may even be able to build an abstraction with an
equivalent API to `DynamoTableSchema` for these databases so product code doesn’t need to change.

## Alternatives considered

- Instead of the inbox generation logic I considered a more direct approach to implementing quantum
  inbox states where new notifications were tagged somehow as “unsorted” and when the inbox was read
  we took those unsorted notifications and updated them to place them in their new positions.

    This seemed bad for performance, putting expensive writes in the inbox read path. It also seemed
    bad for cost, since we’d need to double our inbox entry updates. Once at notification event time
    and once at inbox observation time.

    Being bad for performance disqualified this option for me. Instead when the inbox is observed we
    bump the current inbox’s generation number which is one write that doesn’t need to block the
    inbox read.

- The inbox index uses a DynamoDB
  [Global Secondary Index](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
  but since the index has the same partition key as the base table’s partition key it could have
  used a
  [Local Secondary Index](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html).
  Local Secondary Indexes put a size limit on your partition in exchange for allowing you to do
  strongly consistent reads on the index. Since the inbox partition is append-only adding a size
  limit would be frustrating to manage. I don’t need strongly consistent reads on the index because
  the realtime abstraction reads from a realtime event log to catch up clients. I agree with the
  flowchart in this
  [blog post](https://www.dynamodbguide.com/local-or-global-choosing-a-secondary-index-type-in-dynamo-db/)
  which basically always recommends global secondary indexes.
