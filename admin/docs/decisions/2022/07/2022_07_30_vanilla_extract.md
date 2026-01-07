# \[2022-07-30\] Vanilla-extract

## Context

We are building a web app so we need to style it with CSS. CSS is unmaintainable to write by hand so
we need a framework. What I (Caleb Meredith) want in a CSS framework:

1.  **Style with design atoms not raw values.** You should pick from a color pallette or spacing
    scale, not set a manual hex code or pixel value. Atomic CSS is also the most performant way to
    structure CSS at scale. You have a set of share style across all your routes.
2.  **TypeScript support for design atoms.** In addition to styling with design atoms, TypeScript
    should know about them. So you get TypeScript autocomplete and can use your design atom types as
    props to components. (e.g. A button component's `color` prop uses your color pallette.)
3.  **CSS is not generated at runtime.** Many CSS frameworks (e.g. [styled components][1]) generate
    CSS at runtime and insert it into the DOM. This is unnecessary cost for nice ergonomics given
    CSS is easy to statically generate and cache. It is also hard (and sometimes inefficient) to
    server-side render runtime generated CSS.
4.  **Styles are inline with HTML elements.** This is a stylistic preference. Naming things is a
    hard problem. Naming all your elements is a pointless exercise and creates an unnecessary level
    of indirection between the thing and how the thing behaves. Ideally the syntax for styles are
    React component props like [jsxstyle][2] and not
    `className={classNames("some long string", {"other long string": nonStandardCondition})}`
    shenanigans.

[1]: https://styled-components.com/
[2]: https://www.npmjs.com/package/jsxstyle

## Decision

[Vanilla-extract][3] is the CSS framework we've chosen. At its core, vanilla-extract lets you write
CSS in TypeScript. Your style files (with a `.css.ts` extension) are executed at build time to
generate CSS. It's a simple idea that unlocks a lot of power! You can write reusable abstractions in
your CSS with functions (instead of adopting a new language like [SASS][4]) and you can share code
and types across runtime and buildtime.

It hits all of our above requirements:

1. The [sprinkles][5] package lets you build atomic CSS systems. It's a build your own [Tailwind
   CSS][6] that's type-safe and has zero runtime
2. You write your CSS in TypeScript
3. CSS is generated statically
4. It's all TypeScript, you can take your sprinkles styles and create a `<Box>` component that
   exposes your sprinkles styles as props (which we've done)

[3]: https://vanilla-extract.style/
[4]: https://sass-lang.com/
[5]: https://vanilla-extract.style/documentation/packages/sprinkles/
[6]: https://tailwindcss.com/

## Consequences

Vanilla-extract is a little harder to integrate into your build system than other CSS frameworks.
Particularly integrating Remix with vanilla-extract. The way we integrate vanilla-extract ([as
recommended by one of the maintainers][7]) is to put all `.css.ts` files in a folder and build them
together into one CSS file with a separate process.

Because we use Bazel it's easy to compose build tools but would make development more annoying
otherwise.

Some problems with this approach:

- There is no CSS bundle splitting. All CSS is in one file. However, because we use atomic CSS with
  sprinkles our CSS file is relatively small (you have one set of shared styles for every route). We
  can also cache this CSS file for every subsequent page load.
- Custom CSS is not written inline with components. Vanilla-extract normally recommends writing
  `.css.ts` files next to the files which need them. For example `content_editor.tsx` and
  `content_editor.css.ts`. However, we can't do this because styles need to be in one directory.
  Given we use atomic CSS with sprinkles, most styles are written inline in HTML so this is not
  really a problem.
- No just-in-time (JIT) compiler. [Tailwind CSS has a JIT][8] compiler which scans your source code
  and only includes CSS for classes you actually use. All styles in our sprinkles atomic CSS system
  need to be included in the CSS bundle regardless of if they are ever used or not.

All in all, these problems don't seem too bad.

[7]:
    https://github.com/vanilla-extract-css/vanilla-extract/discussions/178#discussioncomment-3522559
[8]: https://tailwindcss.com/docs/upgrade-guide#migrating-to-the-jit-engine

## Alternatives considered

[Tailwind CSS][9] is a great CSS framework and close to what we want but:

- Isn't type safe like vanilla-extract
- The React ergonomics is a gnarly `className` instead of a prop-based `<Box>` component

Given atomic CSS is the CSS methodology which performs best at scale (see this talk on [Facebook's
stylex framework][10], also see [React Native for Web][11] which compiles styles to atomic CSS for
performance) I wasn't looking at CSS frameworks which did not do atomic CSS.

[9]: https://tailwindcss.com/
[10]: https://www.youtube.com/watch?v=ur-sGzUWId4
[11]: https://necolas.github.io/react-native-web/docs/styling/
