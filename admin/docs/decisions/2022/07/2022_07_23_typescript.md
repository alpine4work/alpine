# \[2022-07-23\] TypeScript

## Context

We need to pick a programming language for the frontend and backend of our product. Since we’re
building a web app, we’re constrained right now to programming languages that compile to JavaScript
for the frontend. On the backend we’re unconstrained. Some things to consider when making this
decision:

- **Developer productivity:** How fast is it for our founding team and new team members to write
  code in our chosen language?

- **Community support:** Do our chosen languages have a rich, mature, ecosystem of libraries for
  challenging technical problems? We don’t care about whether the ecosystem has many small helper
  libraries or database ORMs, we’re comfortable building out our own helper library and database
  access layer. We care more about libraries for building reactive UIs at scale (e.g. React),
  libraries for building rich text editors, and libraries for advanced data structures like
  [red-black trees](https://en.wikipedia.org/wiki/Red%E2%80%93black_tree).

- **Type safety:** We’ll have to write a lot of code. It will be impossible for a single developer
  to reason about the whole system at once, or even a major subsystem. We need tooling to help
  guarantee program correctness at scale. Programming language type systems do a good job at this
  while keeping code composable.

- **Process boundary safety:** When we communicate between two processes (e.g. client → server, or
  service 1 → service 2 or even one server “communicating” with another through a database) we want
  these communications to be safe. Both processes should speak the same protocol that’s resilient to
  version upgrades and data migrations.

- **Performance:** Is the programming language fast? Basically every programming language is fast
  enough. Programming language choice impacts user perceived performance significantly less than
  good system design and algorithmic choice.

## Decision

[**TypeScript**](https://www.typescriptlang.org/). For both the frontend and the backend.

I (Caleb Meredith) am a programming language nerd. I worked at Meta on [Flow](http://flow.org/)
(Meta’s internal TypeScript alternative). I’ve built
[programming languages and compilers](https://docs.google.com/document/d/1hPFmUk2GOWfX3d3G-uvGvs7NoTuUHnlWSyG8aErA8wM/edit)
outside of Meta as well. In addition to shipping lots of production JavaScript/TypeScript/Flow code
I’ve shipped production code in Haskell, OCaml, Java, Objective-C, and Python. I’ve also done a
considerable amount of high level Rust programming for side projects.

With all this experience, the language I’m most productive in is TypeScript. I’m most comfortable
with C-style syntaxes and TypeScript’s dynamism allows me to build rich abstractions when necessary.
This makes TypeScript a natural choice.

It hits all our considerations above:

- **Developer productivity:** This is the language I’m fastest in and is widely known. I’ve also
  seen developers pick up TypeScript quickly at previous companies.

- **Community support:** JavaScript has one of the richest package ecosystems out there. There are
  many bad packages, too many small utility packages, but still there are great solutions for
  advanced technical problems.

- **Type safety:** TypeScript is widely adopted across the JavaScript ecosystem. At this point, you
  basically must have TypeScript support for your package to get any adoption. It also has this
  wonderful mix of type safety and dynamism. You can always `any` your way into dynamic JavaScript
  where the type system is missing. This is great for productivity.

- **Process boundary safety:** By using TypeScript and both the frontend and the backend we can
  easily share types and code. This makes implementing rich collaborative experiences much easier
  where the frontend and backend need to work in concert to provide a great user experience.

- **Performance:** There’s heavy investment in JavaScript engine performance across the industry
  given it’s THE language right now for developing on the web. (WebAssembly exists but isn’t
  commonly used for building web apps.) Recently JavaScript developers have also been getting more
  tools to work with
  [binary data](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray),
  interact with the
  [garbage collector](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry),
  and
  [share data across processes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).

    JavaScript is fast enough. What makes the biggest difference on perceived user performance is
    system design and algorithmic choice.

    I also believe a garbage collected language like JavaScript can be faster for application
    workloads because of fast memory allocation. More on this when we discuss Rust below.

## Alternatives considered

- [Elixir](https://elixir-lang.org/) and TypeScript: Elixir is appealing as a backend language
  because it has [Phoenix](https://www.phoenixframework.org/), a
  [Ruby on Rails](https://rubyonrails.org/) quality web app framework, and is based on Erlang which
  is designed for supporting highly distributed and concurrent backend systems. I started
  prototyping in Elixir but found I wasn’t as productive as with TypeScript (maybe due to not
  knowing the language well) and struggled when it came time to build realtime text editing because
  my chosen library ([ProseMirror](https://prosemirror.net/)) needs JavaScript on the server to
  properly implement its
  [Operational Transform](https://en.wikipedia.org/wiki/Operational_transformation) algorithm.

    You also can’t server-side render your React code when using Phoenix as your web server. Given
    just about everything in our application is interactive, there’s almost nothing for a static
    Phoenix web server to render.

- [Rust](https://www.rust-lang.org/) and TypeScript: I spent a lot of time prototyping in Rust. I
  even ended up building a
  [streaming GraphQL server implementation in Rust](https://github.com/calebmer/cyberworlds-legacy/blob/main-legacy-1/server/graphql/core/executor.rs).
  However, my productivity in Rust (while pretty high) is still lower than TypeScript. When doing
  anything advanced you often run into fights with the borrow checker.

    Performance-wise memory allocation in Rust is theoretically slower if you don’t use a custom
    allocator. By default memory allocation in Rust is like `malloc()` memory allocation in C. The
    allocator finds a chunk of memory for your data, puts it there, then later frees that chunk.
    Over time your memory gets fragmented since the free gaps for data could be anywhere. So
    allocating new memory (like for an array) requires jumping around the heap looking for a gap
    that will fit your array.

    However, most JavaScript engines use a generational garbage collector which allocates new memory
    in a “young generation” using a bump allocator. So allocating new memory only requires
    incrementing a pointer (vs scanning the heap). You do need to scan the heap during garbage
    collection though but when you care about interactive performance I’d rather memory allocation
    be fast.

    In Rust you can use custom allocator to get even better memory performance. e.g. An arena
    allocator (I used [this library](https://docs.rs/typed-arena/latest/typed_arena/)) allocates
    memory using a bump allocator then frees it all at once. This is great for an HTTP request where
    your goal is to stream a string response then throw away any memory you used. However using
    custom allocators can be tricky and you end up in fights with the borrow checker. Slowing down
    productivity for developers not familiar with Rust.

    Overall I picked TypeScript since it’s easier to be productive with good performance. Code
    sharing is also an important factor to not pick Rust.
