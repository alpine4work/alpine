# Code Style

This document describes common conventions used throughout the codebase. It is recommended that you
follow any conventions here for consistency.

## General

These conventions influence most code we write. They apply across languages and describe how to
think about code. Recommendations in other sections cover more specific situations.

### Resolving code style disputes

If when reviewing code the change author and change reviewer disagree about a particular code style
decision, then code style preferences win in the following order:

1. Preferences from this style guide
2. Preferences used in the current file and surrounding files
3. Preferences of the change author

If the change reviewer has a preference that's not in this style guide or not in the surrounding
files, they may try to convince the change author to use the reviewer's preference. But ultimately
the change author gets to make the decision.

### Prefer long, descriptive names

When naming a variable, type, function, class, or any other declaration prefer longer descriptive
names to shorter names with accompanying documentation.

Include context in the name for how it's supposed to be used when appropriate. For example: "A for
B" (e.g. `fooForBar`) tells you that A should only be used in context B. "C with D" (e.g.
`fooWithBar`) tells you that C includes some extra information D that doesn't usually come with C.
"internal E" (e.g. `internalFoo`) tells you that a name is an implementation detail of E and should
be used to implement E.

Avoid acronyms and abbreviations unless they are common across the software engineering industry
(e.g. HTML or Int). Acronyms and abbreviations are confusing for folks without context on what they
stand for. Acronyms are alao often ambiguous. For example, does IR mean Incident Response or
Intermediate Representation? Generally avoid acronyms and abbreviations in written communication as
well.

**💡 Why?** Variable names are visible not just at the point where you declare the variable but also
everywhere you use the variable. Meaning you put in a variable name can not be missed by future
developers using that variable.

### Use a direct coding style

Functions should read naturally on a line-by-line basis. They shouldn’t be cluttered with
theoretical error cases and null checks.

Use assertions and the type system to make impossible cases actually impossible. By default,
functions should not return null when nothing is found they should throw.

An example, instead of this:

```ts
// ❌ No
function getFullName(accountId) {
    const account = getAccount(accountId);
    if (!account) {
        return "Unknown";
    }

    if (account.lastName !== null) {
        // `firstName` should never be null but just in case...
        if (account.firstName === null) {
            return `Unknown ${account.lastName}`;
        }
        return `${account.firstName} ${account.lastName}`;
    }

    return account.firstName;
}
```

Write this:

```ts
// ✅ Yes
function getFullName(accountId) {
    const account = getAccount(accountId);

    if (account.lastName !== null) {
        assert(account.firstName !== null);
        return `${account.firstName} ${account.lastName}`;
    }

    return account.firstName;
}
```

Here `getAccount()` throws an error instead of returning null when the account doesn’t exist. Since
we also expect `firstName` to be set when `lastName` is set we write an assertion instead of an
edge-case we don’t ever expect to hit.

This does **NOT** mean there should be no error handling. Rather we should have really good error
handling at the system level. `try`/`catch` are great language constructs for moving error handling
out of a local function and into a shared location.

This does **NOT** mean you should never expect errors. There will always be errors when dealing with
external resources. Use retries to fix transient errors. You must still build resilient systems that
expect uncertain network conditions and freak accidents.

This does **NOT** mean we are ok with users seeing errors. We should pursue a glitch-less experience
for end users. Only use this style when actually dealing with impossible states. Or unlikely states
where the error is able to communicate to the user what happened. (Like throwing a `NotFoundError`
resulting in a 404.) An assertion error presented to the user is not an acceptable user experience.

**💡 Why?** This style of code is easier to read and reduces the complexity of your code. If you
have a bunch of ill-thought out edge cases in your function have you tested every one? Is there an
automated test to make sure it works? It’s better to keep the program in known good states and
panic/crash when we find ourselves not in a good state then to put the user in a program in an
untested state.

(There is actually a “direct style” in programming which was named to contrast with
“[continuation-passing style](https://en.wikipedia.org/wiki/Continuation-passing_style)”. Our usage
of the phrase “direct style” is loosely related.)

### No abstraction is better than the wrong abstraction

Don’t force a reusable abstraction in the name of “clean code.” The wrong abstraction can increase
maintenance burden in the long run by making code harder to modify, harder to reason about, and
harder to debug.
[Dan Abramov (of the React core team) wrote a good post on “Goodbye, Clean Code”](https://overreacted.io/goodbye-clean-code/)
sharing a case in his career where he removed duplication at the cost of maintainability.

The alternative is copy/pasting code (no abstraction). This is a perfectly reasonable approach when
you have two pieces of code that are kind of similar but have different fundamental requirements.
Add references in comments to make sure future developers can be aware of the similarities if you’d
like. If you find yourself with a bad abstraction, delete it and inline the code everywhere it was
called.

A good rule of thumb for when you need an abstraction is when you have three pieces of code that do
the same thing.

Not all abstractions are bad! Our codebase has a lot of great abstractions like `DynamoTableSchema`.
Making the right judgment for what’s the “wrong” abstraction and what’s the “right” abstraction
requires taste that we build over our careers.

Some more good resources on this topic:

- [“The Wrong Abstraction”](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) by Sandi
  Metz
- [“Minimal API Surface Area”](https://www.youtube.com/watch?v=4anAwXYqLG8) a talk by Sebastian
  Markbåge (React tech lead)
- [“The WET Codebase”](https://overreacted.io/the-wet-codebase/) a talk by Dan Abramov (WET is a
  play on the acronym [DRY](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself))

### Put the smallest branch of the condition first and return early if possible

When you’re writing an `if` condition, ideally one of the branches should be very short (one to five
lines of code) and that branch should be put first.

Let’s consider a simplified `isDeepEqual()` function.

```ts
// ❌ No
function isDeepEqual(value1, value2) {
    if (value1 !== value2) {
        if (isObject(value1) && isObject(value2)) {
            const value1Keys = new Set(Object.keys(value1));

            for (const key of Object.keys(value2)) {
                if (value1Keys.has(key)) {
                    value1Keys.delete(key);

                    if (!isDeepEqual(value1[key], value2[key])) {
                        return false;
                    }
                } else {
                    return false;
                }
            }

            return value1Keys.size === 0;
        } else {
            return false;
        }
    } else {
        return true;
    }
}
```

Here we’re putting the shorter condition (`return true` or `return false`) second. This hurts the
readability of the function as you need to read the entire condition to understand what it does.
Let’s see what happens when we reverse the order of the conditions:

```ts
// ✅ Better
function isDeepEqual(value1, value2) {
    if (value1 === value2) {
        return true;
    } else {
        if (!isObject(value1) || !isObject(value2)) {
            return false;
        } else {
            const value1Keys = new Set(Object.keys(value1));

            for (const key of Object.keys(value2)) {
                if (!value1Keys.has(key)) {
                    return false;
                } else {
                    value1Keys.delete(key);

                    if (!isDeepEqual(value1[key], value2[key])) {
                        return false;
                    }
                }
            }

            return value1Keys.size === 0;
        }
    }
}
```

This is much easier to read because we see the condition, see what happens in the easy case, then
can we go on to evaluate the harder case without needing to remember what the condition was.

The first part of our recommendation is to put the smallest branch of the condition first. The
second part of our recommendation is to use early returns to reduce the amount of indentation in the
function if possible. Here our simple cases return at the end. Therefore, we don’t need an `else`
block at all:

```ts
// ✅ Best
function isDeepEqual(value1, value2) {
    if (value1 === value2) {
        return true;
    }

    if (!isObject(value1) || !isObject(value2)) {
        return false;
    }

    const value1Keys = new Set(Object.keys(value1));

    for (const key of Object.keys(value2)) {
        if (!value1Keys.has(key)) {
            return false;
        }

        value1Keys.delete(key);

        if (!isDeepEqual(value1[key], value2[key])) {
            return false;
        }
    }

    return value1Keys.size === 0;
}
```

By removing the `else` blocks we’ve simplified the function by removing a lot of unnecessary
indentation. Now, when reading this code you can read linearly instead of having to navigate nested
if/else blocks.

**💡 Why?** It’s easier to read code written this way. When you read code you need to keep a
[control flow graph](https://en.wikipedia.org/wiki/Control-flow_graph) representing the different
states of the function in your head. You build the graph in your head as you read the function line
by line (since as humans we read top to bottom). When you have multiple nested if/else blocks this
graph gets pretty complex. But if you put shorter conditions first and those shorter conditions
early return you can safely forget about the condition as you move forward in the function! Since
you know for sure that condition has finished executing.

### Don’t use `try`/`catch` for control flow

Avoid using `try`/`catch` to catch specific kinds of errors. For example `NotFoundError`s or
`PermissionDeniedError`s. `try`/`catch` should _only_ be used for exception handling. If your code
needs to handle a not found case or permission denied case then the function you’re calling needs to
explicitly return a not found or permission denied case.

For example, we have a lot of server functions that look like this.

```ts
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";

async function getChannel(channelId: ChannelId): Promise<ChannelModel> {
    const channel = await getChannelIfExists(channelId);
    if (channel === null) throw new NotFoundError("Channel not found");
    return channel;
}

async function getChannelIfExists(channelId: ChannelId): Promise<ChannelModel | null> {
    const channelResult = await getChannelIfPossible(channelId);
    if (channelResult === null) return null;
    return unwrapResult(channelResult);
}

async function getChannelIfPossible(
    channelId: ChannelId,
): Promise<Result<ChannelModel, PermissionDeniedError> | null> {
    // ...
}
```

- `getChannel()` throws if the channel is not found or the user doesn’t have access to the channel
- `getChannelIfExists()` returns null if the channel is not found or throws if the user doesn’t have
  access to the channel
- `getChannelIfPossible()` returns null if the channel is not found, returns an object with
  `ok: false` and the `PermissionDeniedError` if the user doesn’t have access to the channel, and
  returns an object with `ok: true` and the `ChannelModel` if the user does have access to the
  channel

By convention we add `IfExists` if the function returns null and `IfPossible` if the function
returns a `Result`.

When would you want to call each variant? Let’s walk through an example. Say you’re writing the data
loading code for a new route and you need to choose which function to call:

- Call `getChannel()` if the route can’t render without a channel. Both channel not found and
  channel permission denied errors should show the user an error screen.
- Call `getChannelIfExists()` if you can render the route without a channel. Channel permission
  denied will show the user an error screen but you can render custom UI if the channel wasn’t
  found. Maybe a special “get started” experience.
- Call `getChannelIfPossible()` if you must render the route regardless of whether you have a
  channel or not. For example, when rendering a channel embedded in a document. The Alice who
  created the document may have access to the channel but if Bob has access to the document but
  _not_ the channel they should be able to read everything else in the document while the embedded
  channel shows a “Private channel” error message.

If you need to handle permission denied errors, don’t do this:

```ts
// ❌ No

try {
    const channel = await getChannel(channelId);

    // Some other code...
} catch (error) {
    if (error instanceof NotFoundError) {
        // Handle not found...
    } else if (error instanceof PermissionDeniedError) {
        // Handle permission denied...
    } else {
        throw error;
    }
}
```

…instead do this:

```ts
// ✅ Yes

const channelResult = await getChannelIfPossible(channelId);

if (!channelResult) {
    // Handle not found...
    return;
}

if (!channelResult.ok) {
    // Handle permission denied...
    return;
}

const channel = channelResult.value;

// Some other code...
```

**💡 Why?** It’s easier to read code written this way. You can read one case at a time instead of in
the `try`/`catch` example you see a `try` and have to scroll all the way down to the `catch` then
guess what specifically in the `try` threw the error that’s being handled.

Also, code written this way is less prone to weird edge case bugs. Say `getChannel()` throws a
`PermissionDeniedError` because some database service isn’t properly configured (not because the
user doesn’t have access to the channel). We’ll want to show this to the user as “unexpected
internal error” not “you don’t have access.” Similarly for `NotFoundError`, what if the `SpaceId`
the channel is in was deleted so while we found the channel we throw a `NotFoundError` because we
can’t find the space. We may not want to run the same channel not found logic in a `try`/`catch` for
this.

This style of code is directly inspired by how languages like Rust and Haskell handle errors. Check
out the documentation for [Rust’s `Result` type](https://doc.rust-lang.org/std/result/) and
[Haskell’s `Either` type](https://hackage.haskell.org/package/base-4.21.0.0/docs/Data-Either.html).
Our `Result` type is basically the same as Rust’s `Result` type and we should treat thrown errors
similar to Rust `panic!()` calls.
“[Error Handling in Rust](https://burntsushi.net/rust-error-handling/)” by the creator of ripgrep is
a comprehensive post if you’re interested how Rust handles errors. Popular content creators like
[Theo (t3.gg) also advocate for a version of this pattern](https://www.youtube.com/watch?v=Y6jT-IkV0VM)
though Theo’s approach is more inspired by
[Go error handling](https://go.dev/blog/error-handling-and-go).

## Naming

### File names should be snake case

We use `snake_case` for all file names unless required to do otherwise by some tool.

We use `snake_case` because it is convention for Bazel target names and `.bzl` files. By using
`snake_case` everywhere name styles are consistent across the project.

`snake_case` is also more readable than `camelCase` because our eyes see an underscore as a space
and can more easily understand the separation of words.

### File names should be globally unique

Ideally, no two files in our codebase would have the same name. For example, If you have a file
defining SQL queries called `server/sql/query.ts` instead consider naming it
`server/sql/sql_query.ts` because "query" is a pretty ambiguous name.

The exception to this rule is the Remix `app` directory.

**💡 Why?** Many tools for navigating codebases provide a fuzzy global file name match. For example,
VSCode has a fuzzy file matcher accessible through cmd+p and GitHub has a fuzzy file matcher
accessible through the "find files" button. Globally unique file names make code easier to recall
using one of these tools.

A corollary to this is exported variable names should also be as global unique as possible. Likewise
we have tooling (like the TypeScript language server) which can auto-import based on a variable
name. If you have multiple variables with the same name it becomes harder to correctly auto-import
based on variable name alone.

### Exported names should be globally unique

When you export a name from a TypeScript module, the name should be globally unique.

One strategy to make your names more globally unique is adding a namespace at the beginning of a
related group of names.

**💡 Why?** This helps when doing analysis across the codebase. You can do a global search for a
globally unique name and find all the places it appears. If an exported name is reused you need to
sift through all usages to figure out which ones you care about. TypeScript also provides an
auto-import feature which works best with global names. As you start typing a name it will give you
recommended files to import from.

We recommend most of your module scoped names to be globally unique. This keeps things stylistically
consistent (since exported module scoped names need to be unique) and means less work for you if you
want to export a previously private name.

### Prefer direct function names for the common case

The short/direct function names should be reserved for the function you expect to be called the
most. Not the function with the simplest implementation.

The most common example of this is null returning functions. Do not write this:

```ts
// ❌ No

// Returns null if the account does not exist
function getAccount(accountId: AccountId): AccountModel | null {
    /* ... */
}

// Throws an error if the account does not exist
function getAccountOrThrow(accountId: AccountId): AccountModel {
    const account = getAccount(accountId);
    if (!account) throw new NotFoundError("Account not found");
    return account;
}
```

Instead write this:

```ts
// ✅ Yes

// Returns null if the account does not exist
function getAccountIfExists(accountId: AccountId): AccountModel | null {
    /* ... */
}

// Throws an error if the account does not exist
function getAccount(accountId: AccountId): AccountModel {
    const account = getAccountIfExists(accountId);
    if (!account) throw new NotFoundError("Account not found");
    return account;
}
```

Because of our [direct programming style](#use-a-direct-coding-style), callers will be using the
version which does not return null more often. So that should get the more direct name despite
composing the lower-level function which returns null.

Adding `IfExists` is our convention for null returning functions.

### Recommended type naming convention

This is a recommended naming convention for types that works with our style guide suggestions. This
is loose guidance to help you pick a good name that's consistent with the codebase. Break out of
this convention as you see fit.

This naming convention can also be used for React components, schemas, or anything else that gets a
PascalCase name. If a name is stylized as PascalCase that typically means it's some kind of "noun"
so you can think of this as our noun naming convention.

```
{namespace}{subClass}{superClass}{member}
```

- `namespace`: A namespace for a related group of types. By using a namespace with a related group
  of types you make the type globally unique, make sure the type names sort together, and generally
  communicate what part of the system a name is a part of.
- `subClass` and `superClass`: `subClass` is a kind of `superClass`. For a class declaration this
  naming convention may look like `class {subClass}{superClass} extends {superClass}`. Even if your
  type is not a class, sometimes you will have some specialization relationship between types. For
  example a discriminated union will have a `superClass` (e.g. `Expression`) and a `subClass` (e.g.
  `Variable` or `Function` which becomes `VariableExpression` and `FunctionExpression`).
- `member`: If your type "owns" another type (perhaps through a property) that other type is said to
  be a member. For example `type Foo = {bar: FooBar}`. Here `bar` is owned by `Foo` (it doesn't
  appear anywhere else) so we give it the name `FooBar`.

Each part of the name is optional.

This naming convention is recursive. Say you have a `member` that itself has a `subClass` and
`superClass`.

Some examples:

- `SearchEntitySemanticIndexEmbeddingChunk`
    - Namespace: `SearchEntity`
    - Sub-class: `Semantic` (there’s also a `SearchEntityKeywordIndex` type)
    - Super-class: `Index`
    - Member: `EmbeddingChunk`
- `TaskQueryNormalizedFilters`:
    - Namespace: `TaskQuery`
    - Sub-class: `Normalized` (there’s also a `TaskQueryFilter` type. `TaskQueryNormalizedFilters`
      is a refinement of `Array<TaskQueryFilter>`)
    - Super-class: `Filters`
    - Member: n/a
- `CollaborativeContentEditorReceiveStepsAction`:
    - Namespace: `CollaborativeContentEditor` (the naming scheme is applied recursively here,
      `ContentEditor` is also a namespace in our codebase. `Collaborative` is a specialization, aka
      sub-class, added to `ContentEditor`)
    - Sub-class: `ReceiveSteps`
    - Super-class: `Action`
    - Member: n/a

**💡 Why?** By using this naming convention, readers of your code can reliably predict the
relationship between multiple types. We put a namespace first because 1) related types will be
displayed together when sorted alphabetically, 2) auto-import is more powerful when your
functions/types have unique names.

### Variable names and type names should mirror each other

Your variable names shouldn't diverge too far from your type names. Same with function names.

Suggestion for how to pick a variable name: start with the type name, convert to camel case, remove
redundant information (if locally scoped), and add extra context (e.g. `fooForBar` or `fooWithBar`).

If you're following the [recommended type naming convention](#recommended-type-naming-convention)
the namespace is usually redundant in a locally scoped variable name. Since you typically know the
systems you're working with within a function implementation so the namespace doesn't add much
value. If you are exporting the variable and want it's name to be globally unique then include the
namespace.

**💡 Why?** The variable name is not just seen where the variable is declared but also everywhere
the variable is used. You don't write the type of the variable where it's used, just the name. If
you include some of the type name in the variable name it is clear wherever the variable is used
what type of thing you're interacting with.

### Prefer named arguments over positional arguments beyond four arguments

Most languages have syntax for functions with positional arguments and functions with named
arguments. The difference primarily is in how the function is called.

When calling a function with positional arguments there's no context on what the arguments are at
the function call site:

```ts
// ❌ No
myFunction(42, true, "hi");
```

When calling a function with named arguments there is context on what the arguments are at the
function call site:

```ts
// ✅ Yes
myFunction({foo: 42, bar: true, qux: "hi"});
```

You may also sometimes mix positional arguments and named arguments:

```ts
// ✅ Yes
myFunction(context, null, {foo: 42, bar: true, qux: "hi"});
```

Generally, prefer named arguments after adding:

- About four arguments; or
- Two arguments with the same type; or
- A boolean argument

This is a recommendation, use your judgement of what's best for your function.

Based on this recommendation, these functions with positional arguments are acceptable:

```ts
// ✅ Yes
myFunction(42);
myFunction(42, "hello");
```

But these functions are not. One has more than four arguments and the other has multiple arguments
of the same type (`number`):

```ts
// ❌ No

// Five arguments
myFunction(true, myVariable, 42, "hello", null);

// Three number arguments
myFunction(2, 0, 8);

// Boolean argument
myFunction(42, true);
```

Instead write:

```ts
// ✅ Yes

// Five arguments
myFunction({foo: true, bar: myVariable, qux: 42, buz: "hello", baz: null});

// Three number arguments
myFunction({x: 2, y: 0, z: 8});

// Boolean argument
myFunction({foo: 42, bar: true});
```

You can also mix positional and named arguments like this:

```ts
// ✅ Yes
myFunction(42, {bar: true});
```

**💡 Why?** Named arguments help when reading code. When looking at a function's call site it's
easier to interpret what the purpose of each argument is with named arguments. It also helps reduce
confusion when you have multiple arguments of the same type.

For an example of how named arguments help code readability, consider the following code:

```ts
// ❌ No
getSearchResultDestinationPath(result, false);
```

What does the `false` mean here? You have no idea without looking at the definition of
`getSearchResultDestinationPath()`. But with a named argument:

```ts
// ✅ Yes
getSearchResultDestinationPath(result, {withDesktopLayout: false});
```

Now it's obvious.

For an example of how named arguments help prevent confusion, consider the following code where we
accept two arguments of the same type (`AccountId`):

```ts
// ❌ No
commitAssignTaskAction(selectedAccount.id, currentAccount.id);
```

One argument is the “assignee” (the account who the task is assigned to) and the other is the
“assigner” (the account setting the assignee). Getting the order wrong will lead to a bug! But
TypeScript will happily accept whatever order you pass the arguments in. Named arguments help you
clearly confirm you’re passing `AccountId`s in correctly:

```ts
// ✅ Yes
commitAssignTaskAction({
    assigneeId: selectedAccount.id,
    assignerId: currentAccount.id,
});
```

A popular pattern in our codebase is to use positional arguments for the first 2–3 “essential”
arguments then use an options object. For example, many functions in our backend use this pattern:

```ts
// ✅ Yes
async function getPost(
    context: ServerActionContext,
    id: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
) {
    // ...
}
```

By convention, the options object is named `options` and is optional if possible.

## Comments

### Code comments should be 80 characters in length

Our code formatters are configured with a 100 character print width, but code comments we should aim
to be no more than 80 characters long _not_ including indentation.

As an example, here's a comment with no indentation wrapped at 80 characters:

<!-- prettier-ignore-start -->
```ts
// The quick brown fox jumps over the lazy dog. The quick brown fox jumps over
// the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown
// fox jumps over the lazy dog.
```
<!-- prettier-ignore-end -->

Here is a comment with two levels of indentation (8 spaces). We make sure the comment is still 80
characters wide.

<!-- prettier-ignore-start -->
```ts
// ✅ Yes

class C {
    f() {
        // The quick brown fox jumps over the lazy dog. The quick brown fox jumps over
        // the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown
        // fox jumps over the lazy dog.
    }
}
```
<!-- prettier-ignore-end -->

We don't wrap a comment with two levels of indentation at the file-wide 80 character mark.

<!-- prettier-ignore-start -->
```ts
// ❌ No

class C {
    f() {
        // The quick brown fox jumps over the lazy dog. The quick brown fox
        // jumps over the lazy dog. The quick brown fox jumps over the lazy
        // dog. The quick brown fox jumps over the lazy dog.
    }
}
```
<!-- prettier-ignore-end -->

**💡 Why?** If we instead wrapped comments at the 100 character print width, whenever you indented
or dedented code with a comment you'd need to reformat the comment around your print width. At 80
characters, you can freely add indentation without reformatting the comment. 80 character long prose
is also better for legibility than 100 character long prose.

### Comments should use markdown formatting

When writing a comment use markdown formatting. This is because some tools which render comments
will apply markdown formatting.

If you're drawing a diagram with characters that depends on a monospace font (which is highly
encouraged! check out
[box drawing characters](https://en.wikipedia.org/wiki/Box-drawing_character)), make sure to wrap in
three backticks (` ``` `) so if your comment is rendered the diagram will be drawn with a monospace
font.

### Documentation lives in block comments, implementation commentary lives in inline comments

If you are writing a comment where the audience is some consumer of that code, use a JSDoc style
block comment (`/**`).

```ts
// ✅ Yes

/**
 * This documents how to use the function.
 */
function f() {}
```

Because JSDoc style block comments are for code consumers, you will usually only use them on public
exports. A block comment on a private variable usually doesn't make sense because only the function
which declares it can access it.

```ts
// ❌ No

function f() {
    /**
     * A block comment doesn't make sense here because `x` is private to `f`.
     */
    const x = 42;
}
```

If you are writing a comment to explain the implementation of some code to a future developer then
use an inline comment (`//`).

```ts
// ✅ Yes

function f() {
    // This explains how the function is implemented.
}
```

Sometimes you want a documentation comment and implementation commentary for the same declaration.
In that case put implementation commentary second.

```ts
// ✅ Yes

/**
 * This documents how to use the function.
 */
// This explains how the function is implemented.
function f() {}
```

**💡 Why?** JSDoc style block comments (`/**`) are used by some tools to generate documentation for
a function. For example, in an IDE TypeScript may expose a JSDoc style block comment (`/**`) when
you hover over a function or see it in autocomplete to aid developers. In the future we might
generate an internal website which collects all the JSDoc style block documentation comments in our
codebase and renders them in an easy to explore way. So it's useful to intentionally use two styles
of comment based on the intended audience.

This is the same style as
[plain Rust comments (`//`) vs documentation comments (`///`)](https://doc.rust-lang.org/rust-by-example/meta/doc.html).

### Section header comments

Most of the time, your code should be organized along clear function or file boundaries. However,
sometimes you have a long function or configuration object you want to organize into sections with
comments as section headers.

The style we use is an 80 character long block comment (not including indentation) forming a box
with the section title centered in the middle:

```ts
/* ========================================================================== *\
 *                                  Section                                   *
\* ========================================================================== */
```

An easy trick for centering text is to write your section title on the left, then add spaces until
the section title is right aligned, then select the spaces to see how many characters there are (in
VSCode this is shown in the bottom right) then delete half of those characters. Feel free to
optically center align, though.

Section headers are 80 characters ignoring indentation, like comments:

```ts
function myFunction() {
    if (condition) {
        /* ========================================================================== *\
         *                                  Section                                   *
        \* ========================================================================== */
    }
}
```

## TypeScript

### Avoid unsafe operators

Avoid operators that introduce type unsafety. This includes:

- `x!`: The null suppression operator turns type `T | null | undefined` into `T`. If your type
  includes null it means you need to handle null. Otherwise you may get null pointer exceptions at
  runtime. For example `const x: string | null = null; x!.toLowerCase()` is valid TypeScript but
  since null isn’t a string the function `toLowerCase()` this throws at runtime.

- `x as T`: The cast operator allows you to turn `T | U` into simply `T` ignoring `U`. If your type
  includes `U` it means you need to handle that case. Otherwise you may get errors at runtime
  because you didn’t handle `U`. For example
  `const x: string | number = 42; (x as string).toLowerCase()` is valid TypeScript but since 42
  doesn’t support the function `toLowerCase()` this throws at runtime.

- `any`: Completely turns off type checking for a variable. Should go without saying this is unsafe.

Alternatives to use instead:

- Instead of `x!.p`:
    - Use optional chaining: `x?.p`. this get property `p` if `x` isn’t `undefined` or `null` and
      will return `undefined` if `x` is `undefined` or `null`.

    - Use nullable coalescing: `(x ?? y).p`. If `x` is `undefined` or `null` then instead `x` will
      be replaced with the variable `y` and you’ll access property `p` on `y` instead of `x`.

        Prefer nullable coalescing to `||` (don’t do this `(x || y).p`) which was the convention
        before the nullable coalescing operator was introduced.

    - `assertExists(x)` immediately throws an error if `x` is `undefined` or `null` which is better
      than getting a nullable pointer exception later down the road when you try to access property
      `p` (or anything else) on `undefined` or `null`. You catch the error right where it happens
      instead of later on.

- Instead of `x as T`:
    - `cast<T>(x)` is a way to make sure `x` is type `T` in a type safe way.

    - `x satisfies T` is very similar to `cast<T>(x)`. It checks that `x` is valid for type `T`
      without changing the type of `x`.

    - `x as const` is type safe and encouraged. It switches TypeScript’s literal type inference into
      read-only mode which can be quite useful.

We don’t have an ESLint warning that warns when you try to use these unsafe operators. Because
they’re sometimes genuinely useful given JavaScript is fundamentally a dynamically typed language
and TypeScript can’t express everything JavaScript supports. Therefore it’s on you the developer to
avoid known unsafe language features whenever possible.

**💡 Why?** Maintaining a type safe codebase helps us reduce bugs shipped to production and makes
refactoring large parts of the application easier.

### Helper functions should be in individual modules

Avoid files with many unrelated helper functions. Instead, create a separate file for each helper.
For example, files ending with `_utils.ts`, `_helpers.ts`, or `_methods.ts` typically contain
unrelated helper functions and should be avoided.

A good heuristic is if you have multiple functions in a file which don't call each other or you have
multiple functions in a file whose implementation details aren't coupled then you may be better
served by putting those functions in different files.

**💡 Why?** Files with unrelated helper functions can be difficult to discover both when you need to
add a new helper function and when you need to find the file a helper function is defined in. Also,
unrelated code in a single file will bloat frontend bundle sizes.

- When you need to add a couple new helper functions and there's an existing `_utils.ts` file you
  don't know about you're instinct may be to create a new `_utils.ts` file somewhere else. Putting
  helper functions in separate files avoids this.

- If you're looking for the definition of a particular helper function you may use the fuzzy file
  search feature in your editor and search for the function's name. If the function is in a
  `_utils.ts` file you won't be able to find it with this method.

### Prefer function declarations for module scope functions

When writing a function you can either use function declaration syntax or you can use arrow function
syntax.

Function declaration syntax:

```ts
function getSomething() {
    /* ... */
}
```

Arrow function syntax:

```ts
const getSomething = () => {
    /* ... */
};
```

When writing functions at the top level of a module (module scoped) prefer function declaration
syntax. This is preferred:

```ts
// ✅ Yes
function foo() {
    /* ... */
}

// ✅ Yes
export function bar() {
    /* ... */
}
```

…to this:

```ts
// ✅ Yes
function foo() {
    /* ... */
}

// ❌ No
export const bar = () => {
    /* ... */
};
```

…or this:

```ts
// ❌ No
const foo = () => {
    /* ... */
};

// ❌ No
export const bar = () => {
    /* ... */
};
```

Nested functions can use whatever syntax you'd like. For example:

```ts
function foo() {
    const bar = () => {
        /* ... */
    };
}
```

This applies to React components to:

```ts
// ✅ Yes
function MyComponent() {
    /* ... */
}

// ❌ No
const MyComponent = () => {
    /* ... */
};
```

**💡 Why?** We prefer function declarations purely for consistency. There’s very little practical
difference between the two syntaxes.
[Function declarations can be hoisted](https://developer.mozilla.org/en-US/docs/Glossary/Hoisting)
which makes then slightly more capable but it’s a weak reason to prefer them to function
declarations. We started using function declarations in our backend since it looks consistent with
functions in other popular backend languages (e.g. [Go](https://go.dev/tour/basics/4)) and we prefer
how async functions look (`async function f() {}` vs `const f = async () => {};`). Since we have a
reason to prefer function declarations in the backend, we’ve chose to consistently use function
declarations everywhere.

### Avoid classes

Most things you can accomplish with a class, you can also accomplish with an object type and some
functions.

Prefer composition over inheritance as a way to share code. Prefer discriminated unions you can
exhaustively switch over to subclasses.

You may still use classes when they are a good fit for the problem, but don't reach for a class by
default. We want to avoid large, spaghetti code, classes. If you do use classes ideally they'd be
small and focused.

Instead of:

```ts
// ❌ No

abstract class Animal {
    doSomething() {
        // ...
    }
}

class Cat extends Animal {
    doSomething() {
        super.doSomething();
        // ...
    }
}

class Dog extends Animal {
    doSomething() {
        super.doSomething();
        // ...
    }
}
```

Write something like:

```ts
// ✅ Yes

type Animal =
    | {
          type: "Cat";
      }
    | {
          type: "Dog";
      };

function doSomethingShared(animal: Animal) {
    // ...
}

function doSomething(animal: Animal) {
    switch (animal.type) {
        case "Cat": {
            doSomethingShared();
            // ...
            break;
        }
        case "Dog": {
            doSomethingShared();
            // ...
            break;
        }
        default:
            throw exhaustive(animal);
    }
}
```

Our `exhaustive()` helper will generate a TypeScript error if a new variant is added in the future
and you forgot to handle it. Helping maintainability.

**💡 Why?** Classes fundamentally bundle data with behavior. With a class, you can't write a
function on all your variants in a separate file. For large classes this can lead to bundle bloat.
By putting the behavior for each of your variants in a single function and composing shared logic,
it makes the behavior code easier to follow and organize.

### When using classes, only extend abstract classes

If you are going to use classes, the super class should be abstract. If you want a "default" case to
instantiate then create a special, simple, sub-class. As a convention, add `Base` to the end of your
super class's name. Don't extend from a non-abstract class.

**💡 Why?**
[Kotlin syntactically forces this convention](https://kotlinlang.org/docs/inheritance.html). It
makes it much easier to reason about your class if you don't have to constantly think about "will
this be extended or not". If a class is meant to be extended, it's `abstract`.

### Avoid shared mutability

Avoid mutating shared objects or `let` variables. Instead, prefer immutable objects and producing
new objects when you need to change something.

Immutability is a convention you need to follow for React that we encourage everywhere else in the
codebase (including server code) by convention. Shared helpers should generally encourage immutable
patterns, for instance.

Local mutability is totally fine and often leads to easier to read code! What do we mean by local
mutability? You're free to mutate objects in the scope which they are created. Using React as an
example, this is ok:

```ts
// ✅ Yes

function MyComponent1() {
    const items = [];

    for (const item of iterator) {
        items.push(/* ... */);
    }

    // ...
}
```

We are creating a new `items` variable in the `MyComponent` scope and mutating it as a way of
filling in the variable with data.

These examples are not ok:

```ts
// ❌ No

const items = [];

function MyComponent2() {
    for (const item of iterator) {
        items.push(/* ... */);
    }

    // ...
}
```

```ts
// ❌ No

function MyComponent3({items}) {
    for (const item of iterator) {
        items.push(/* ... */);
    }

    // ...
}
```

In both examples, `items` is created outside of `MyComponent`'s scope. We don't know how it was
created or how other code will be consuming it. We should treat `items` as immutable. You can use
the `ReadonlyArray<T>` type in this case if you want to ensure that's the case.

**💡 Why?** Immutable objects are generally easier to reason about than mutable objects. It's easier
to reason about how data flows through a program and easier to think about how sharing a value may
behave.

## React

### Avoid React context

Generally avoid
[React’s context feature](https://beta.reactjs.org/learn/passing-data-deeply-with-context)
(`createContext()` and `useContext()`) and prefer passing props manually through many layers of
components (known as “prop drilling”). You are recommended to use React context for system level
functionality. (Explained later.)

So instead of components like this:

```tsx
// ❌ No

const TimelineContext = createContext();

function Timeline() {
    const [state, dispatch] = useReducer();

    return (
        // ...
        <TimelineContext.Provider value={state}>
            <TimelineScrollView />
        </TimelineContext.Provider>
        // ...
    );
}

function TimelineScrollView() {
    return (
        // ...
        entries.map(() => {
            <TimelineEntry />;
        })
        // ...
    );
}

function TimelineEntry() {
    return (
        // ...
        <TimelineEntryInput />
        // ...
    );
}

function TimelineEntryInput() {
    const {state} = useContext(TimelineContext);

    // ...
}
```

Write your components like this:

```tsx
// ✅ Yes

function Timeline() {
    const [state, dispatch] = useReducer();

    return (
        // ...
        <TimelineScrollView state={state} />
        // ...
    );
}

function TimelineScrollView({state}) {
    return (
        // ...
        entries.map(() => {
            <TimelineEntry state={state} />;
        })
        // ...
    );
}

function TimelineEntry({state}) {
    return (
        // ...
        <TimelineEntryInput state={state} />
        // ...
    );
}

function TimelineEntryInput({state}) {
    // ...
}
```

**💡 Why?** React context creates an implicit dependency between a component and some data or state.
By explicitly passing that data/state down through props you explicitly document what the component
needs to run. TypeScript will then check that the component actually receives the data/state it
needs to.

This code takes a little more time to write since you have to dig through many layers of components.
However, it makes the code easier to read, verify, and maintain in the long run. The exercise of
forcing yourself to go through all levels of the component hierarchy is also useful for discovering
edge cases. Maybe one place the component is rendered should behave differently? If you use context
and skipped auditing the code you might have missed such call sites.

**Exception:** The exception to this guidance is when implementing system level functionality.
System level functionality is functionality which needs to be shared by _every_ React component in
our app (or the vast majority). An example of this is tooltips. Any component in our app may render
a tooltip and tooltips need to globally coordinate to make sure only one is showing at a time. You
may use React context for tooltips.

A useful rule of thumb is that if you could have a reasonable context implementation in Jest unit
tests _without_ a context provider then your context implements system level functionality. In our
timeline example above, you could hardcode some mock state for Jest but it wouldn’t be interactive
and your state wouldn’t be located with the test which needs to reference the state to make
assertions. A timeline component’s context does not have a reasonable implementation in a Jest unit
test so you shouldn’t use context.

### When handling the `keydown` event call `event.preventDefault()` and `event.stopPropagation()`

If your code is handling the `keydown` event, call both `event.preventDefault()` and
`event.stopPropagation()`.

- `event.preventDefault()` tells the browser to not perform its default action for the keypress.
  (e.g. Browsers scroll the page down on space keypress by default.)
- `event.stopPropagation()` stops other event handlers in _our_ code from handling the keypress. We
  install keyboard event listeners at the root `document` level for global keyboard shortcuts, if
  you handle a keypress a global handler shouldn’t. (e.g. Peeks are closed by a global keyboard
  listener when you press escape. If you close a menu inside a peek on escape it shouldn’t also
  close the peek. It would if you don’t stop event propagation.)

The `<GlobalKeyDownEvent>` component is what we recommend using for global keyboard shortcuts. This
component respects `event.stopPropagation()`. Once any event handler calls this function, no other
handler may respond to the event.

**💡 Why?** We recommend against `event.stopPropagation()` in general (see below). However, creating
an abstraction that spans all `keydown` listeners in our app is impractical.

Some keyboard shortcuts should be handled locally by the interactive element with focus. For
example, when you focus a menu button pressing the down arrow key should open the menu. Some
keyboard shortcuts should be handled globally. For example, in inbox when you press the down arrow
key it should go to the next entry. If a local component handles a `keydown` event it should stop
global handlers from also handling the `keydown` event. Using our examples: if a menu button in our
inbox is focused then pressing down should open the menu button and not select the next entry in the
inbox.

So instead, we use the builtin browser API `event.stopPropagation()` to communicate across local and
global `keydown` handlers.

You should always call both `event.preventDefault()` and `event.stopPropagation()` because even if
there isn’t a browser behavior (cancelled by `event.preventDefault()`) or app behavior (cancelled by
`event.stopPropagation()`) triggered on the same keypress today, there may be one added tomorrow. Or
in the case of browsers, there may be a new fancy browser with its own keyboard shortcuts.

### Avoid `event.stopPropagation()` (unless you are handling a `keydown` event)

Don’t use `event.stopPropagation()` unless you are handling a `keydown` event. If you are handling a
`keydown` event always use `event.stopPropagation()`. See the above section for more context on our
`keydown` event guidance.

**💡 Why?** For many events, parents depend on event propagation to implement some system level
behavior. For example:

- A parent component may listen for a `mouseenter` event to apply a hover style or a tooltip
- A parent component may listen for a `focus` event to apply a focus within style
- A parent component may listen for a `click` event as a heuristic that a user is interacting with
  their children

Without extensively auditing code, it’s really hard to know what events your parent components
depend on. Even if you happen to know that your parent component isn’t listening to a propagated
event today, it might tomorrow.

By adopting this recommendation we get the benefit that parent components can _reliably_ depend on
event propagation. When writing a parent component you don’t have to wonder “what happens if a child
stops propagation on this” since we have a shared style guide recommendation that child components
shouldn’t stop event propagation in the first place.

### When using `z-index` create a component local stacking context for local reasoning

If two elements are overlapping, the browser picks one to render on top of the other using the
`z-index` CSS property (or DOM position if the `z-index` CSS property doesn’t exist). The `z-index`
only applies in the nearest
[stacking context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index/Stacking_context).
There are many ways to create a new stacking context, such as the CSS
`position: relative; z-index: 0` or the CSS `isolation: isolate`.

If you are using `z-index` you should create a new stacking context at the root of the nearest
component which contains the two element’s whose z-order you’re trying to influence.

We typically use `<Box position="relative" zIndex="0">` to create a new stacking context.

**💡 Why?** Creating a new stacking context allows you to reason about z-order locally and use small
values like 10, 20, and 30 instead of trying to find the highest z-index globally like 999999 or
`Number.MAX_SAFE_INTEGER` as used in some CSS. It also reduces the chance of their being bugs as
adjacent components evolve since their z-order should be isolated from your component’s z-order.

### Treat `data-testid` attributes as if they only exist in test environments

Don’t look for elements with some `data-testid` attribute outside of unit tests or integration
tests. They’re only used as a way to programmatically find elements that aren’t annotated in an
accessibility friendly way.

**💡 Why?** `data-testid` attributes add unnecessary bloat to the DOM. Someday we’d like to write an
SWC plugin that strips `data-testid` attributes away in non-production builds. Today we sometimes
manually check that `NODE_ENV` is not production when assigning `data-testid`.

### When performing a network request in a `useEffect()` protect the request from being executed unnecessarily with a ref

If you have a network request (e.g. an RPC call) in a `useEffect()` then consider creating a ref
that tracks some value and only send the network request when that value changes. You should also
consider applying this recommendation for any other resource consuming side effect you may make in a
`useEffect()` besides network requests.

For example:

```ts
// ✅ Yes

const lastTimeZoneRef = useRef(null);

useEffect(() => {
    if (lastTimeZoneRef.current === clientInfo.timeZone) return;
    lastTimeZoneRef.current = clientInfo.timeZone;

    updateOurAccountLastClientTimeZone(context, {
        timeZone: clientInfo.timeZone,
    });
}, [context, clientInfo.timeZone]);
```

Here `lastTimeZoneRef` tracks `clientInfo.timeZone`. We only send our network request (the RPC
`updateOurAccountLastClientTimeZone()`) when `clientInfo.timeZone` changes. Don't set your effect's
dependency array to `[clientInfo.timeZone]`. You'd have to add an `eslint-disable` directive for
`react-hooks/exhaustive-deps`.

Another example is if you only want to run your network request on initial mount. Don't set your
effect's dependency array to `[]`, instead use a ref:

```ts
// ✅ Yes

const hasInitiallyMountedRef = useRef(false);

useEffect(() => {
    if (hasInitiallyMountedRef.current) return;
    hasInitiallyMountedRef.current = true;

    updateOurAccountLastClientTimeZone(context, {
        timeZone: clientInfo.timeZone,
    });
}, [context, clientInfo.timeZone]);
```

**💡 Why?** React may re-run an effect at any time. In
[strict mode each effect runs twice](https://react.dev/reference/react/StrictMode#fixing-bugs-found-by-re-running-effects-in-development)
as a way to help you find bugs. Even outside of strict mode you may have a dependency on a value
that changes frequently. Even if all the values in your dependency array don't change frequently
when you write the effect, some developer may make a change later that violates your assumptions.

For instance, in the above examples we have a dependency on `context`. Right now that variable
basically only changes when the URL changes but maybe in the future someone will decide `context`
should update when a peek opens in addition to when the URL changes. By putting the network request
behind a `lastTimeZoneRef.current === clientInfo.timeZone` check we make sure we won't send our
network request when `context` changes.

Also, the ESLint `react-hooks/exhaustive-deps` rule's auto fix is really handy and can help catch
real bugs where your effect captures a stale value. Disabling it means you may run into bugs where
your effect captures a stale value.

## Testing

### Use `describe` blocks to group related tests by API or high-level functionality

When writing test suites, use `describe` blocks to organize tests by the API surface or high-level
functionality being tested. This makes test output easier to parse, helps group related tests
together, and enables `.skip()` and `.only()` in development for larger sets of tests.

Within your `describe` blocks, you can also set up important test fixtures that are related to those
specific tests, as opposed to the global scope.

```ts
// ✅ Yes

describe("getChannelIfExists()", () => {
    test("returns channel when it exists and user has access", async () => {
        // ...
    });

    test("returns null when channel does not exist", async () => {
        // ...
    });

    test("throws PermissionDeniedError when user lacks access", async () => {
        // ...
    });
});

describe("getChannelIfPossible()", () => {
    test("returns result with channel when user has access", async () => {
        // ...
    });

    test("returns null when channel does not exist", async () => {
        // ...
    });

    test("returns error result when user lacks access", async () => {
        // ...
    });
});
```

For React components, group tests by component behavior or user interactions:

```ts
// ✅ Yes

describe("TaskList component", () => {
    describe("task filtering", () => {
        test("shows only completed tasks when filter is set to completed", () => {
            // ...
        });

        test("shows all tasks when no filter is applied", () => {
            // ...
        });
    });

    describe("task creation", () => {
        test("adds new task when form is submitted", () => {
            // ...
        });

        test("shows validation error for empty task title", () => {
            // ...
        });
    });
});
```

Don't simply prefix a test case with the method name.

```ts
// ❌ No

test("getChannelIfExists() - returns channel when it exists and user has access", async () => {
    // ...
});

test("getChannelIfExists() - returns null when channel does not exist", async () => {
    // ...
});

test("getChannelIfExists() - throws PermissionDeniedError when user lacks access", async () => {
    // ...
});

test("getChannelIfPossible() - returns result with channel when user has access", async () => {
    // ...
});

test("getChannelIfPossible() - returns null when channel does not exist", async () => {
    // ...
});

test("getChannelIfPossible() - returns error result when user lacks access", async () => {
    // ...
});
```

Don't group tests within a single `test` call.

```ts
// ❌ No

test("getChannelIfExists()", async () => {
    {
        // returns channel when it exists and user has access ...
    }

    {
        // returns null when channel does not exist ...
    }

    {
        // throws PermissionDeniedError when user lacks access ...
    }
});

test("getChannelIfPossible()", async () => {
    {
        // returns result with channel when user has access ...
    }

    {
        // returns null when channel does not exist ...
    }

    {
        // returns error result when user lacks access ...
    }
});
```

**💡 Why?** Grouped tests make test output much easier to scan when you have failures. Instead of
seeing a flat list of test names, you see a hierarchy that immediately tells you what area of
functionality is broken. This is especially valuable when running tests in CI where you need to
quickly identify what broke. During development, grouped tests also let you use `.only` to quickly
iterate on tests you care about.

_Note:_ All tests before 2025-08-15 were not written with this rule. Anything not using this rule is
considered deprecated and we want to migrate to using `describe()`.

### Use parameterized tests are strongly encouraged

When you need to test the same logic with different inputs, use parameterized tests. Set up
parameterization **outside** of the `test` function and include the parameterized values in the test
name. There are a few methods of parameterizing tests that are recommended.

Don't parameterize within a `test` function:

```ts
// ❌ No

test("validates email addresses", () => {
    const testCases = [
        ["user@example.com", true],
        ["user@", false],
        ["userexample.com", false],
    ];

    testCases.forEach(([input, expected]) => {
        // if this fails, it's difficult to determine which of the test cases failed
        expect(isValidEmail(input)).toBe(expected);
    });
});
```

#### Test case loops

Place all your test cases in an array, then loop over each with a clear test name. This method is
helpful when you want to clearly state a large amount of cases. However, you cannot isolate tests
with `.skip()` or `.only()` during development.

```ts
// ✅ Yes

describe("isValidEmail()", () => {
    const testCases = [
        {
            input: "user@example.com",
            expected: true,
        },
        {
            input: "user@",
            expected: false,
        },
        {
            input: "userexample.com",
            expected: false,
        },
    ];

    testCases.forEach(({input, expected}) => {
        // Result:
        //
        // - isValidEmail()
        //     - returns true for user@example.com
        //     - returns false for user@
        //     - returns false for userexample.com
        test(`returns ${expected} for ${input}`, () => {
            const result = isValidEmail(input);
            expect(result).toBe(expected);
        });
    });
});
```

#### Test abstraction

Create a common `testCase` method that you call separately from within individual tests. This is
helpful when test names need more description in what they're testing, or you need quick control
over which tests are executed during development.

```ts
// ✅ Yes

describe("isValidEmail()", () => {
    const testCase(input: string, expected: boolean) {
        const result = isValidEmail(input);
        expect(result).toBe(expected);
    }

    test("returns true for user@example.com", () => {
        testCase("user@example.com", true);
    });

    test("returns false for user@", () => {
        testCase("user@", false);
    });

    test("returns false for userexample.com", () => {
        testCase("userexample.com", false);
    });
});
```

#### Programmatic test generation

In some cases you may have a large amount of tests cases to cover that is not feasible to write out,
or you want future test cases to be auto generated. In this case, you can generate objects to cover
your test cases for you. However, these tests can grow to be difficult to read.

```ts
// ✅ Yes

describe("multiply()", () => {
    const firstParams = [1, 2, 3, 4, 5];
    const secondParams = [6, 7, 8, 9, 10];
    const thirdParams = [11, 12, 13, 14, 15];

    const testCases = firstParams.flatMap(first =>
        secondParams.flatMap(second =>
            thirdParams.map(third => ({
                first, second, third;
            })),
        ),
    );

    for (const {first, second, third} of testCases) {
        test(`can multiply ${first}, ${second}, and ${third} without throwing`, () => {
            multiply(first, second, third);
        });
    }
});
```

**💡 Why?** Parameterized tests group common test cases, maintain readability, and help prevent test
files that are thousands of lines of duplicate tests. Including parameterized values in test names
helps you understand which specific case failed when looking at test output. When parameterizing
within a test, failures do not clearly indicate which test case failed - often leading to the
developer manually commenting out test cases to find the failure.

### Assert everything you expect, but nothing more

When writing test assertions in unit tests, assert everything that's relevant to what you're
testing, but avoid asserting unrelated details. Assertions are free, but parsing through 1000
unrelated test failures is not. This rule is relatively nuanced, and strongly applies to unit tests
(integration and smoke tests can break this rule if the developer believes it makes sense).

```ts
// ✅ Yes

test("creates new task with correct properties", async () => {
    const task = await createTask(context, {
        title: "Buy groceries",
        dueDate: "2025-08-12",
        assigneeId: "user123",
    });

    // Assert everything relevant to task creation
    expect(task).toMatchObject({
        title: "Buy groceries",
        dueDate: "2025-08-12",
        assigneeId: "user123",
        status: "pending",
        createdAt: expect.any(Date),
        id: expect.stringMatching(/^task_[a-zA-Z0-9]+$/),
    });
});
```

Don't assert implementation details that aren't relevant to the behavior being tested:

```ts
// ❌ No

test("creates new task with correct properties", async () => {
    const task = await createTask(context, {
        title: "Buy groceries",
        dueDate: "2025-08-12",
        assigneeId: "user123",
    });

    expect(task.title).toBe("Buy groceries");

    // This assertion is testing behavior not related to the test title Add another
    // test to assert this behavior
    const totalTaskCount = getUserTotalTaskCount("user123");
    expect(totalTaskCount).toBe(1);
});
```

Don't under-assert and miss important behavior:

```ts
// ❌ No

test("creates new task", async () => {
    const task = await createTask(context, {
        title: "Buy groceries",
        dueDate: "2025-08-12",
        assigneeId: "user123",
    });

    // This only tests that the function returns something truthy
    expect(task).toBeTruthy();
});
```

**💡 Why?** Comprehensive and targeted assertions help you catch regressions when refactoring code.
Asserting irrelevant details makes tests brittle and creates noise when you need to find logic that
actually broke. When 50 tests fail because you renamed an internal property, it becomes much harder
to spot the 2 tests that failed because of an actual bug you introduced.

_Note:_ All tests before 2025-08-15 were not written with this rule. Any tests written before this
date were actually written with the opposite rule in mind, and we'd like to migrate.
