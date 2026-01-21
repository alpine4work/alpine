# AGENTS.md

The `server` directory contains all of Alpine's server code. Server code is anything that runs in
the cloud instead of on a user's device. We have multiple server environments:

- Most code runs on AWS EC2 instances orchestrated by ECS
- Some code runs in Cloudflare Workers and Cloudflare Durable Objects at the edge
- Some code runs in AWS Lambda

## Services

We prefer large services that are split based on workload instead of many microservices split based
on feature. Some of our services:

- `AppService`: Remix app that server renders React and provides client data loading + mutation
  through Remix loaders and our RPC system. Handles basically all of our stateless HTTP requests
  from the client.

- `JobQueueService`: Handles background jobs from an SQS job queue.

- `EdgeService`: Cloudflare Worker that runs in Cloudflare's edge network near the user. All
  requests to `AppService` first hit `EdgeService` and are then proxied to `AppService`. Performs
  file serving, file uploads, and service routing. Owns many Cloudflare Durable Objects with
  stateful WebSocket connections (e.g. `ChatRealtimeService` and `DocumentCollaborationService`).

- `TaskRealtimeService`: Stateful service for our task tracker product that maintains WebSocket
  connections with users and sends them realtime updates.

- `ApiService`: Server implementing our public API. Allowing developers to access their Alpine
  content with their own programs. Implements an OpenAPI specification.

## `Context`

A context object is passed to basically every function on the server. For example:

```ts
export async function getPostComment(
    context: ServerActionContext,
    postId: PostId,
    commentIndex: number,
): Promise<PostCommentModel> {
    // ...
}
```

### What is `Context`?

These context objects are based on a general purpose utility `Context<Modules>` (defined in
`shared/context/context.ts`). The context utility serves two purposes:

1. **Async context tracking:** The context object is a type safe alternative `AsyncLocalStorage`
   that works on both the browser and Node.js

2. **Dependency injection:** While Java gives dependency injection a bad name it’s a very useful
   technique for writing testable code, our server unit tests depend this capability

The `Context<Modules>` type isn't much more than this:

```ts
type Context<Modules extends object> = Modules;
```

The `Context` type takes a `Modules` type parameter. All properties of the `Modules` type parameter
are also properties of `Context`! So if you pass an object to `Context`’s `Modules` type parameter
with the property `tracer: TracerContextModule`, that property will be available at
`context.tracer`.

```ts
function example(
    context: Context<{
        tracer: TracerContextModule;
    }>,
) {
    context.tracer.startSpan("Hello");
}
```

The `Modules` type parameter actually makes sure each value is a `ContextModuleBase` instead of
taking an arbitrary object:

```ts
type Context<Modules extends {[key: string]: ContextModuleBase}> = Modules;
```

`ContextModuleBase` is a class that looks like this:

```ts
abstract class ContextModuleBase<Modules extends {[key: string]: ContextModuleBase} = {}> {
    protected get _context(): Context<Modules> {
        throw new InternalError(
            "Can't access the context property until this " +
                "context module is bound to a context object",
        );
    }
}
```

`ContextModuleBase` itself has a `Modules` type parameter. It also has a \_context property.

Context modules can depend on other context modules. `TracerContextModule` has no dependencies but
`OpensearchContextModule` depends on `TracerContextModule` since we want to create spans for each
OpenSearch HTTP request.

```ts
class TracerContextModule extends ContextModuleBase {
    // ...
}

class OpensearchContextModule extends ContextModuleBase<{
    tracer: TracerContextModule;
}> {
    public search(/* ... */) {
        const {span, finishSpan} = this._context.tracer.startSpan("OpenSearch search");

        // ...

        finishSpan();
    }
}
```

The `this._context` property is used to refer to the _current_ context within a context module. So a
context module can access any other modules it has a dependency on.

```ts
contextA.opensearch.search(/* ... */);
contextB.opensearch.search(/* ... */);
```

In the first call `this._context` will be `contextA`. In the second call `this._context` will be
`contextB`.

To create a new context you call `Context.new()` like this:

```ts
const context = Context.new({
    tracer: new TracerContextModule(tracer),
    opensearch: new OpensearchContextModule(opensearchClient),
});
```

TypeScript will complain if you provide the `opensearch` context module but not the `tracer` context
module. Since (as we’ve seen) `opensearch` depends on `tracer`.

If you want to add or replace context modules you can use `context.clone()` or `context.with()`. So
the `Context` type looks more like this:

```ts
type Context<Modules extends {[key: string]: ContextModuleBase}> = Modules & {
    clone<NewModules>(modules: NewModules): Context<Modules & NewModules>;

    with<NewModules, Value>(
        modules: NewModules,
        action: (context: Context<Modules & NewModules>) => Promise<Value>,
    ): Promise<Value>;
};

const Context: {
    new <Modules>(modules: Modules): Context<Modules>;
};
```

Let’s we’ve created a `context` object with `Context.new()` that includes `opensearch` and `tracer`
and we want to add a `cache` context module, here’s how we’d do it:

```ts
const newContext = context.clone({
    cache: new CacheContextModule(),
});

await context.with(
    {
        cache: new CacheContextModule(),
    },
    async context => {
        // ...
    },
);
```

Both `clone()` and `with()` create a new context. They don’t clone the parent’s context modules,
rather they create proxies with a new `this._context` property pointing to the new context.
(Specifically we use JavaScript prototypes for proxying.)

The difference between `clone()` and `with()` is `context.with()` will _destroy_ the new context it
creates at the end of the async action. This is useful since you may have resources you want to make
sure are scoped to a specific asynchronous action. In the example above, maybe we want a `cache`
that’s used for a single HTTP request but not across HTTP requests. (Usually `CacheContextModule` is
scoped to a single HTTP request.)

You can extend the lifetime of a `context.with()` context with `ProcessContextModule`'s
`waitUntil()` function. Calling `context.process.waitUntil(somePromise)` won't destroy the context
until the promise resolves.

### `TracerContextModule`

All our server logs are distributed traces (see `shared/tracer` for more information about our
tracer). `TracerContextModule` includes the current `TracerSpan` (or `TracerRoot` if there's no
current span). If you call
`parentContext.tracer.withSpan("Blah blah blah", async childContext => { ... })` this will create:

1. A new `TracerSpan` that's a child of the span in `parentContext.tracer` (which is a
   `TracerContextModule`).
1. A new `childContext` object where `childContext.tracer` (which is a `TracerContextModule`)
   contains the child span.

This allows you to easily build up traces for your server code. We recommend shadowing the `context`
variable like this:

```ts
context.tracer.withSpan("Blah blah blah", async context => { ... });
```

This makes it very easy to make sure you're using the `context` with the right span in the callback
(`async context => { ... }`) instead of accidentally referencing the parent context with the parent
span.

### `ActorContextModule`

The `context.actor` (which is an `ActorContextModule`) tells us who is acting against our system.
It's used for critical permissions logic. The actor in `context.actor` has already been successfully
authenticated with our system.

Throughout server code it is VERY IMPORTANT that you authorize that the actor is allowed to perform
whatever action you're implementing (or prefix the function as `dangerously` if for some reason you
can't authorize, e.g. `dangerouslyGetAccountWithoutAuthorization()`). The `dangerously` communicates
the function is not responsible for performing authorization and instead you the caller are
responsible for making sure the function call is safe.

The different kinds of actors (you can see your actor type with `context.actor.type`) are:

- `Session`: A human user who’s signed in with our service. If you’re accessing Alpine through one
  of our apps you’re using a `Session` actor. `Session` actors are associated with a session object
  in the database (which can be revoked) and an `AccountId`.

- `System`: Powerful actor that has access to everything in a single space. Even private data!
  Useful for implementing background jobs. All `JobQueueService` jobs use a system actor. You need
  to be careful when using this actor that you aren't reading/writing data in a way that gives users
  elevated access to our systems.

- `ImpersonatedAccount`: A system actor who’s impersonating an account to see data as the account
  would see it. Useful for system actors acting on behalf of an account. Only has access to a single
  space, not all the spaces the account is in.

- `Anonymous`: When someone visits our product but aren’t signed in then they’re an anonymous actor.
  For example, if you open a document shared by URL in incognito mode you’ll be using an anonymous
  actor.

- `Bot`: When a developer uses the public Alpine API (at https://api.alpine.inc) they use a bot
  actor. This labels all activity from the API as "bot" activity. Bots can't be granted access
  explicitly. Instead they have access defined by a "scope". AI agents are implemented with the
  public Alpine API and so use bot actors.

### `ServerActionContext`

There are some context object aliases we use which bundle a bunch of common context modules
together. The most prevalent is `ServerActionContext`. This context has an actor context module,
DynamoDB context module, batching context module, request-level cache context module, and more.

There’s also variants of `ServerActionContext` including `ServerSessionActionContext`,
`ServerSystemActionContext`, `ServerAnonymousActionContext`, `ServerAccountActionContext`, etc.
which an actor context module of a specific type. `ServerSessionActionContext` is always a session
actor, `ServerSystemActionContext` is always a system actor, `ServerAccountActionContext` is always
an actor corresponding to a single account (so session actor, impersonated account actor, or bot
actor).

`ServerActionContext` is based on `ServerProcessContext`. The difference is the action context only
lives for a single request. So it has the actor (authenticated for that request) and a request-level
cache. Whereas `ServerProcessContext` is shared across the entire Node.js process. You can think
about it like this:

```ts
const processContext = Context.new({
    /* ... */
});

const server = http.createServer((req, res) => {
    processContext.with(
        {
            actor: createActorContextModuleFromHttpRequest(req),
            cache: new CacheContextModule(),
        },
        async actionContext => {
            // ...
        },
    );
});
```

`processContext` is used to create new `actionContext`s on each request which are destroyed at the
end of the request.

There are other context types for each service with more context modules (e.g.
`JobQueueServiceProcessContext`) but they’re all generally based on `ServerActionContext` +
`ServerProcessContext`.

## DynamoDB

DynamoDB is our primary database. We use DynamoDB through the `DynamoTableSchema` API. We structure
our code as follows. Each feature (e.g. `server/forum`):

- Gets its own DynamoDB table (e.g. `server/forum/data/internal/forum_table.ts`).

- This DynamoDB table is a private implementation detail of the feature (which is why
  `forum_table.ts` is inside an `internal` directory, it can’t be imported outside
  `server/forum/data`).

- The feature exports functions which are safe to call without violating permissions or corrupting
  data (e.g. `server/forum/data/get_post.ts`, `server/forum/data/create_post.ts`, and
  `server/forum/data/update_post_content.ts`).

- These functions always return a custom format (e.g. `PostModel`) instead of the underlying
  DynamoDB item type. This allows the DynamoDB schema to change over time and as long as these
  exported functions behave the same everything should be fine.

- If for some reason the feature needs to export a function which does not perform permission checks
  then it must prefix the function name with `dangerously` and suffix the function name with an
  explanation of why the function is dangerous (e.g.
  `server/forum/data/dangerously_get_post_author_without_authorization.ts`).

- Functions in the `internal` directory (e.g. `server/forum/data/internal`) are implementation
  details and are free to not check permissions.

### Read consistency

DynamoDB allows reads to either be eventually consistent or strongly consistent. Eventually
consistent reads are faster and cost less money but may not observe the latest write (eventually
consistent data typically updates in <1 second). By default reads are eventually consistent. For
example: `DynamoTableSchema.getItem(context, { /* ... */ })` is eventually consistent.

To perform a strongly consistent read you must add a `consistency` option:
`DynamoTableSchema.getItem(context, { /* ... */ }, {consistency: "Strong"})`.

When using DynamoDB you must think carefully when reading data about whether this read should be an
eventually consistent read (the default) or a strongly consistent read. Use strong consistency if
you must observe recent writes (e.g. you're reading an item that was recently created).

### Optimistic concurrency control

The main ways you can update items in DynamoDB:

- `MyTable.createItem(context, item)`: Creates an item, throws if the error already exists.
  `item.updateLockVersion` for the new item is 0 (technically undefined,
  `updateLockVersion: undefined` is how we represent `updateLockVersion: 0`).

- `MyTable.directlyUpdateItem(context, item)`: Updates an item and increments
  `item.updateLockVersion`, but only if `item.updateLockVersion` is equal in DynamoDB to what you
  passed in to `item`. Throws an error if `item.updateLockVersion` isn’t equal.

We avoid race conditions by incrementing `updateLockVersion` on every update and not allowing
updates with an incorrect `updateLockVersion`. This is referred to as "optimistic concurrency
control". If DynamoDB throws a condition check error (the error thrown when `updateLockVersion` is
incorrect) then we retry the update. First by loading new data from DynamoDB (to get the latest
`updateLockVersion`) then by performing the update again. This retry loop is created by
`context.dynamo.retryTransaction()`. For example:

```ts
await context.dynamo.retryTransaction(async context => {
    const item = await MyTable.getItem(context, {
        // ...
    });

    await MyTable.directlyUpdateItem(context, {
        ...item,
        count: item.count + 1,
    });
});
```

If there's a race condition then one of the `MyTable.directlyUpdateItem()` calls will one, the other
will throw a condition check error and retry the `context.dynamo.retryTransaction()` loop. Upon
retrying the second call will load the new item (with the new `updateLockVersion`) apply its update
again and finally commit the update.

Condition check failures thrown by `MyTable.directlyUpdateItem()` are automatically retried if
you’re using the context from a `context.dynamo.retryTransaction()` loop. Condition check failures
from `MyTable.createItem()` will only be retried if you pass in a
`isConditionCheckErrorRetriable: true` option.

There are other ways to update DynamoDB items but we strongly recommend sticking to just
`createItem()` and `directlyUpdateItem()` in a `retryTransaction()` loop. If you use this approach
your code will be safe in the face of race conditions.

#### Transactions

To atomically update two items at once, DynamoDB has transactions. `MyTable.createItem()` and
`MyTable.directlyUpdateItem()` can be used in transactions as `MyTable.transactionCreateItem()` and
`MyTable.transactionDirectlyUpdateItem()`.

For example:

```ts
await context.dynamo.retryTransaction(async context => {
    const [item1, item2] = await runAllPromises([
        MyTable.getItem(context, {
            // ...
        }),
        MyTable.getItem(context, {
            // ...
        }),
    ]);

    await DynamoTableSchema.executeTransaction(context, [
        await MyTable.transactionDirectlyUpdateItem({
            ...item1,
            count: item1.count + 1,
        }),
        await MyTable.transactionDirectlyUpdateItem({
            ...item2,
            count: item2.count - 1,
        }),
    ]);
});
```

`executeTransaction()` will retry if `transactionDirectlyUpdateItem()` fails because, due to a race
condition, `updateLockVersion` is incorrect. `transactionCreateItem()` won’t retry unless you set
the `isConditionCheckErrorRetriable: true` option.

Whenever updating DynamoDB always think about:

- What will happen in race conditions?
- What’s the atomic update I need to make to leave the data in a good state?

Transactions can also have arbitrary condition checks on arbitrary items (e.g.
`transactionConditionCheck()`) to prevent a transaction from committing unless certain conditions
have been met.

You can test race conditions with `TestCheckpoint`. If you suspect there’s a problematic race
condition, make sure to add a test with `TestCheckpoint` which exercises the race condition.

### Authorization

Every publicly exported function from a server package (public functions are functions not in an
`internal` folder) needs to authorize the actor has access to the data they’re reading/writing. If
the actor doesn’t have access then a `PermissionDeniedError` must be thrown.

Often, authorization functions take the form of a function call like:
`authorizeSpaceAccess(context, spaceId)`. If the actor has access to the space this function does
nothing, if the actor doesn’t have access to the space then this function throws.

Some functions, instead of throwing, return their `PermissionDeniedError` as a result. For example
`getChannelIfPossible()`. Given we don’t want to use try/catch for control flow if you want to
handle permission errors you call a function like `getChannelIfPossible()` which returns normally
with a `Result` that’s `ok: false` when there’s a permission error (e.g. you may have gotten a
notification for a post in a channel you lost access to, in this case we don’t want to prevent your
entire inbox from loading).
