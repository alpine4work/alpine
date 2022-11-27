# Code Style

This document describes common conventions used throughout the codebase. It is recommended that you
follow any conventions here for consistency.

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

**Why?** Many tools for navigating codebases provide a fuzzy global file name match. For example,
VSCode has a fuzzy file matcher accessible through cmd+p and GitHub has a fuzzy file matcher
accessible through the "find files" button. Globally unique file names make code easier to recall
using one of these tools.

A corollary to this is exported variable names should also be as global unique as possible. Likewise
we have tooling (like the TypeScript language server) which can auto-import based on a variable
name. If you have multiple variables with the same name it becomes harder to correctly auto-import
based on variable name alone.

### Prefer long, descriptive names

When naming a variable, type, function, class, or any other declaration prefer longer descriptive
names to shorter names with accompanying documentation.

Include context in the name for how it's supposed to be used when appropriate. For example: "A for
B" (e.g. `fooForBar`) tells you that A should only be used in context B. "C with D" (e.g.
`fooWithBar`) tells you that C includes some extra information D that doesn't usually come with C.
"internal E" (e.g. `internalFoo`) tells you that a name is an implementation detail of E and should
be used to implement E.

Avoid acronyms unless they are common outside of our codebase (e.g. HTML). Acronyms are confusing
and intimidating for folks without context on what the acronym stands for. Generally avoid acronyms
in written communication as well.

**Why?** Variable names are visible not just at the point where you declare the variable but also
everywhere you use the variable. Meaning you put in a variable name can not be missed by future
developers using that variable.

### Exported names should be globally unique

When you export a name from a TypeScript module, the name should be globally unique.

One strategy to make your names more globally unique is adding a namespace at the beginning of a
related group of names.

**Why?** This helps when doing analysis across the codebase. You can do a global search for a
globally unique name and find all the places it appears. If an exported name is reused you need to
sift through all usages to figure out which ones you care about. TypeScript also provides an
auto-import feature which works best with global names. As you start typing a name it will give you
recommended files to import from.

We recommend most of your module scoped names to be globally unique. This keeps things stylistically
consistent (since exported module scoped names need to be unique) and means less work for you if you
want to export a previously private name.

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

-   `namespace`: A namespace for a related group of types. By using a namespace with a related group
    of types you make the type globall unique, make sure the type names sort together, and generally
    communicate what part of the system a name is a part of.
-   `subClass` and `superClass`: `subClass` is a kind of `superClass`. For a class declaration this
    naming convention may look like `class {subClass}{superClass} extends {superClass}`. Even if
    your type is not a class, sometimes you will have an inheritance relationship between types. For
    example a discriminated union will have a `superClass` (e.g. `Expression`) and a `subClass`
    (e.g. `Variable` or `Function` which becomes `VariableExpression` and `FunctionExpression`).
-   `member`: If your type "owns" another type (perhaps through a property) that other type is said
    to be a member. For example `type Foo = {bar: FooBar}`. Here `bar` is owned by `Foo` (it doesn't
    appear anywhere else) so we give it the name `FooBar`.

Each part of the name is optional.

This naming convention is recursive. Say you have a `member` that itself has a `subClass` and
`superClass`.

### Variable names and type names should mirror each other

Your variable names shouldn't diverge too far from your type names. Same with function names.

Suggestion for how to pick a variable name: start with the type name, convert to camel case, remove
redundant information (if locally scoped), and add extra context (e.g. `fooForBar` or `fooWithBar`).

If you're following the [recommended type naming convention](#recommended-type-naming-convention)
the namespace is usually redundant in a locally scoped variable name. Since you typically know the
systems you're working with within a function implementation so the namespace doesn't add much
value. If you are exporting the variable and want it's name to be globally unique then include the
namespace.

**Why?** The variable name is not just seen where the variable is declared but also everywhere the
variable is used. You don't write the type of the variable where it's used, just the name. If you
include some of the type name in the variable name it is clear wherever the variable is used what
type of thing you're interacting with.

## Comments

### Code comments should be 80 characters in length

Our code formatters are configured with a 100 character print width, but code comments we should aim
to be no more than 80 characters long _not_ including indentation.

As an example, here's a comment with no indentation wrapped at 80 characters:

```ts
// The quick brown fox jumps over the lazy dog. The quick brown fox jumps over
// the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown
// fox jumps over the lazy dog.
```

Here is a comment with two levels of indentation (8 spaces). We make sure the comment is still 80
characters wide.

```ts
// Right

class C {
    f() {
        // The quick brown fox jumps over the lazy dog. The quick brown fox jumps over
        // the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown
        // fox jumps over the lazy dog.
    }
}
```

We don't wrap a comment with two levels of indentation at the file-wide 80 character mark.

```ts
// Wrong

class C {
    f() {
        // The quick brown fox jumps over the lazy dog. The quick brown fox
        // jumps over the lazy dog. The quick brown fox jumps over the lazy
        // dog. The quick brown fox jumps over the lazy dog.
    }
}
```

**Why?** If we instead wrapped comments at the 100 character print width, whenever you indented or
dedented code with a comment you'd need to reformat the comment around your print width. At 80
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
/**
 * This documents how to use the function.
 */
function f() {}
```

Because JSDoc style block comments are for code consumers, you will usually only use them on public
exports. A block comment on a private variable usually doesn't make sense because only the function
which declares it can access it.

```ts
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
function f() {
    // This explains how the function is implemented.
}
```

Sometimes you want a documentation comment and implementation commentary for the same declaration.
In that case put implementation commentary second.

```ts
/**
 * This documents how to use the function.
 */
// This explains how the function is implemented.
function f() {}
```

**Why?** JSDoc style block comments (`/**`) are used by some tools to generate documentation for a
function. For example, in an IDE TypeScript may expose a JSDoc style block comment (`/**`) when you
hover over a function or see it in autocomplete to aid developers. In the future we might generate
an internal website which collects all the JSDoc style block documentation comments in our codebase
and renders them in an easy to explore way. So it's useful to intentionally use two styles of
comment based on the intended audience.

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

### Helper functions should be in individual modules

Avoid files with many unrelated helper functions. Instead, create a separate file for each helper.

A good heuristic is if you have multiple functions in a file which don't call each other or you have
multiple functions in a file whose implementation details aren't coupled then you may be better
served by putting those functions in different files.

**Why?** Files with unrelated helper functions can be difficult to discover both when you need to
add a new helper function and when you need to find the file a helper function is defined in. Also,
unrelated code in a single file will bloat frontend bundle sizes.

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

**Why?** Classes fundamentally bundle data with behavior. With a class, you can't write a function
on all your variants in a separate file. For large classes this can lead to bundle bloat. By putting
the behavior for each of your variants in a single function and composing shared logic, it makes the
behavior code easier to follow and organize.

### When using classes, only extend abstract classes

If you are going to use classes, the super class should be abstract. If you want a "default" case to
instantiate then create a special, simple, sub-class. As a convention, add `Base` to the end of your
super class's name. Don't extend from a non-abstract class.

**Why?**
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
const items = [];

function MyComponent2() {
    for (const item of iterator) {
        items.push(/* ... */);
    }

    // ...
}
```

```ts
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

**Why?** Immutable objects are generally easier to reason about than mutable objects. It's easier to
reason about how data flows through a program and easier to think about how sharing a value may
behave.
