# AGENTS.md

The `client/web` directory contains all of Alpine’s TypeScript code that runs the web desktop and
mobile experience. Alpine is a React app using the Remix framework on `react-router` v6. Remix
routes are defined in the `app/routes` directory.

Client code is organized by feature area. Some of the important shared packages are:

- `client/web/helpers`: A collection of generic helpers when working with React.

- `client/web/design`: Contains shared components like `<Box>`, `<Button>`, `<Menu>`, and
  `<Overlay>`.

- `client/web/styles`: CSS and shared style constants. We write our CSS in Vanilla Extract files
  (`.css.ts`) these TypeScript files are executed to generate CSS at build time. Though instead of
  writing new CSS most of the time you want to use the `<Box>` component or `sprinkles()` which are
  the primitives of our design system. You can’t directly import `.css.ts` files, instead you can
  get the exports of these files by importing `client/web/styles/styles.ts`.

- `client/web/content`: Our rich text content editor. Implemented using ProseMirror. The
  `<ContentEditor>` component is used in most product surfaces. To render read-only content you can
  use the `<ContentView>` component.

## `<Box>` and `sprinkles()`

For styling HTML elements in Alpine you should use `<Box>` and `sprinkles()`. `<Box>` is basically
implemented like this:

```tsx
function Box({children, ...props}) {
    return <div className={sprinkles(props)}>{children}</div>;
}
```

`<Box>` is a `<div>` that uses `sprinkles()` to generate a `class` attribute. `sprinkles()` is built
using a library from Vanilla Extract (our CSS framework) for building design systems. You pass in an
object like: `{color: "red-50", padding: "4"}` and it converts to a CSS class like
`color-red-50 padding-4` (though the real class is a generated mess). In this case `red-50`
references a color from our design system and `4` references a spacing value from our design system
(spacing `4` = `1rem`).

Styles supported by `<Box>` and `sprinkles()` and the values they support. To see the full set of
sprinkles values check out `client/web/styles/core/internal/sprinkles.css.ts`. All values provided
to these helpers must be strings.

- `overflow`, `overflowX`, and `overflowY` (`hidden`, `visible`, and `auto`)
- `position` (`relative`, `absolute`, `sticky`, etc.)
- `zIndex` (`-10`, `0`, `10`, `20`, etc.)
- `cursor` (`auto`, `default`, `pointer`, `text`, etc.)
- `pointerEvents` (`auto`, `none`)
- `userSelect` (`none`, `text`)
- `fontStyle` (`normal`, `semi-bold`, `bold`, `code`, `code-semi-bold`, `code-bold`, `truncate`,
  `truncate-code`, etc.)
- `fontSize` (`75` is the default font size for buttons and UI copy with a line height of spacing
  `4`, `100` is the font size for user paragraph content with a line height of spacing `5`, there
  are more values like `50`, `200`, `300`, etc.)
- `display` (`none`, `block`, `flex`, etc.)
- `inset`, `top`, `bottom`, `left`, `right` (spacing values or percentages like `1/2`, `2/3`,
  supports denominators of `n/2`, `n/3`, `n/4`, `n/5`, `n/6`, and `n/12`)
- `flexDirection` (`row`, `column`, etc.)
- `flexGrow` (`0`, `1`)
- `flexShrink` (`0`, `1`)
- `justifyContent` (`flex-start`, `flex-end`, `center`, etc.)
- `alignItems` (`flex-start`, `flex-end`, `center`, etc.)
- `gap`, `rowGap`, `columnGap` (spacing values)
- `padding`, `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`, `paddingX`, `paddingY`
  (spacing values)
- `margin`, `marginTop`, `marginBottom`, `marginLeft`, `marginRight`, `marginX`, `marginY` (spacing
  values, allows negative spacing values like `-4`)
- `width`, `minWidth`, `maxWidth`, `height`, `minHeight`, `maxHeight` (spacing values or percentages
  like `1/2`, `2/3`, supports denominators of `n/2`, `n/3`, `n/4`, `n/5`, `n/6`, and `n/12`)
    - `minWidth="flex-fit"` is the same as `minWidth="0"` and explicitly documents we're overriding
      `min-width: auto` for a flex item to make sure it doesn't overflow its container.
- `borderRadius`, `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomLeftRadius`,
  `borderBottomRightRadius` (spacing values)
- `border`, `borderTop`, `borderBottom`, `borderLeft`, `borderRight`, `borderX`, `borderY` (any
  color)
- `borderWidth` (all you need is `border` and a color for a 1px border, for a 2px border use
  `borderWidth` of `thick`)
- `boxShadow` (`elevation-5`, `elevation-10`, `elevation-20`, `elevation-30`, `elevation-40`, etc.
  see `client/web/styles/core/internal/elevation.css.ts`)
- `color` (any color)
- `backgroundColor` (any color)
- `opacity` (`0`, `10`, `20`, `30`, etc.)

Some properties allow you to configure them based on the color scheme or platform by passing in an
object. For example:

```tsx
<Box width={{desktop: "4", mobile: "6"}} color={{light: "red-40", dark: "green-60"}}>
    Test
</Box>
```

This `<div>` will be wider on mobile (`6`) than desktop (`4`) and will be red in light mode but
green in dark mode.

## Design atoms

The design atoms of our system.

### Colors

Our color scheme is defined in `shared/design/core/colors.ts`. It includes:

- `grey-0` (white background), `grey-5` (often used for borders or hover backgrounds), `grey-10`,
  `grey-20`, `grey-30` (placeholder text color), `grey-40`, `grey-50` (often used for light
  interface text), `grey-60` (text color for quote blocks in rich text), `grey-70`, `grey-80`,
  `grey-90`, `grey-100` (black background and body text color)

- `red-${shade}`, `orange-${shade}`, `yellow-${shade}`, `green-${shade}`, `cyan-${shade}`,
  `blue-${shade}`, `indigo-${shade}`, `purple-${shade}`, and `pink-${shade}` where `${shade}` is
  `10`, `20`, `30`, `40`, `50`, `60`, `70`, `80`, or `90`. Usually shade `50` is good in light mode
  for a rich, vibrant, version of a color.

However, you won’t usually import `shared/design/core/colors.ts` as these are the constant
hexadecimal codes for our colors. Instead what you usually want is `colorSchemeVars` imported from
`client/web/styles/styles.ts` (defined in `client/web/styles/core/internal/color_scheme.css.ts` but
you can’t directly important `.css.ts` files).

While `colors["blue-30"]` will give you a hexadecimal code, `colorSchemeVars["blue-30"]` will give
you a CSS variable that’s `blue-30` in light mode and `blue-70` in dark mode. We automatically
invert colors based on the system color scheme.

`<Box>` and `sprinkles()` use `colorSchemeVars` automatically. So:

```tsx
<Box color="blue-30">Test</Box>
```

…will give you the right blue in light mode and dark mode.

`colorSchemeVars` provides some other useful variables:

- `${color}-${shade}-const` (e.g. `blue-30-const` or `grey-100-const`) will be the same color
  whether you’re in light mode or dark mode. Appending `-const` stands for "constant".

- `theme-${shade}` will use the theme color of the current space (default is `indigo`). The space
  owner gets to pick a color that’ll be used throughout their space to customize their space. Use
  this as an accent color.

- `grey-${shade}-translucent` when rendered over `grey-0` (the background color, white in light mode
  and black in dark mode) will be the specified `${shade}`. But the color has ~10% opacity so if
  rendered over a colored background it lets the color underneath shine throw. Looks very slick when
  your element is rendered over a colorful background. Often used for borders of scrollable areas so
  the scrollable content gently shows through when scrolling underneath instead of their being a
  hard stop.

You can’t reliably get the color scheme in React! That’s because when server-side rendering with
Remix we don’t know the color scheme because the color scheme may be based on the user’s system
configuration. So always make sure to use color scheme CSS variables that automatically switch or
the `<Box>`/`sprinkles()` functionality of passing in an object with light mode / dark mode values
(e.g. `<Box color={{light: "green-50", dark: "red-60"}}>`).

### Spacing

All spacing values (widths, heights, paddings, margins, font line heights) are defined in rems so we
can scale them up/down depending on the platform. There are three "spacing scales":

- `small`: 1rem = 16px, used for small laptops (screen size less than 1280px and greater than 768px)
- `medium`: 1rem = 18px, used for large monitors (screen size greater than 1280px)
- `large`: 1rem = 20px, used for mobile (screen size less than 768px)

Our spacing values are:

- `0` = 0rem
- `0.5` = 0.125rem
- `1` = 0.25rem
- `2` = 0.5rem
- `3` = 0.75rem
- `4` = 1rem
- `5` = 1.25rem
- `6` = 1.5rem
- `7` = 1.75rem
- `8` = 2rem
- `9` = 2.25rem
- `10` = 2.5rem
- `12` = 3rem
- `16` = 4rem
- `24` = 6rem
- `28` = 7rem
- `32` = 8rem
- `48` = 12rem
- `64` = 16rem
- `96` = 24rem
- `128` = 32rem
- `192` = 48rem
- `256` = 64rem

We don’t support more spacing values than this. Generally try to only use these spacing values to
create rhythm in the interface.

`shared/design/core/spacing.ts` exports a `spacing` object you can use to get the rem value for each
of these (e.g. `spacing["4"]` gives the string `"1rem"`) but you can also directly pass in spacing
values to `<Box>` and `sprinkles()` (e.g. `<Box width="4">`).

If you need to do precise pixel calculations in a React component you can `useSpacingScale()` to get
the current spacing scale (`small`, `medium`, or `large`) and
`convertRemLengthToPx(spacing, spacingScale)` to get a pixel value (e.g.
`convertRemLengthToPx("4", useSpacingScale())`).

### Fonts

There are two fonts in Alpine:

- Inter: a sans-serif font we use for basically everything
- Commit Mono: a monospace font used for code

These are both variable fonts. You change fonts with the `fontStyle` prop and size with the
`fontSize` prop in `<Box>` or `sprinkles()`. `fontStyle`s and `fontSize` are both defined in
`shared/design/core/fonts.ts`.

The common font sizes are:

- `50`: 0.875rem line height
- `75` (default): 1rem line height
- `100` (default for rich text paragraph): 1.25rem line height
- `200`: 1.5rem line height

## Platform

`client/web` supports two platforms `desktop` and `mobile`. We choose the platform based on screen
size. Screen sizes below 768px are considered the `mobile` platform. A lot in our design changes
across `desktop` and `mobile`. On `desktop` platforms we assume there’s more horizontal screen space
so we can have sidebars and can expect the pointer device can hover over elements. On `mobile`
everything must be usable via touch and work with less screen space.

You can call `usePlatform()` in a React component to get the current platform.

Instead of checking the platform, often instead we check the route layout with `useRouteLayout()`
which could be `narrow` (mobile) or `wide` (desktop). Often we need a `narrow` route layout on the
`desktop` platform. For example search previews use a `narrow` route layout or peeks which show a
preview of a route before opening it on desktop use a `narrow` route layout. So if writing UI for
narrow screen sizes, usually you want to check `useRouteLayout()` and if you’re changing interaction
behavior to favor touch usually you want to check `usePlatform()`.

## RPCs

When the client communicates with the backend it uses RPCs. First data is loaded from the server via
Remix loaders. After that the client calls RPC functions on the backend. For example
`updateOurAccountName(context, input)` defined in `shared/rpc/accounts_rpc_definitions.ts` (and
implemented in `server/rpc/accounts_rpc_implementations.ts`). All RPCs are defined in `shared/rpc`
and implemented in `server/rpc`.

You need an `AppContext` object to call an RPC on the client which you can get via `useContext()`.
RPCs ultimately call `fetch()` to send an HTTP request to `AppService`.

`client/web/rpc/use_lazy_load_rpc.ts` is useful for calling RPCs within a component. When using this
hook, two components making the same call always share data and the data is refreshed when the user
leaves the page then comes back. It has a similar design to the [`useSwr()`](https://swr.vercel.app)
library.

## Best practices

A collection of best practices to consider while writing frontend code in our codebase.

### Useful helpers

- `client/web/helpers`:
    - `use_state_with_optimistic_updates.ts`: Optimistically update local state with automatic
      rollback on promise rejection.
    - `use_error_state.ts`: Returns a function that when called `throw`s an error from the component
      to show our page error handler.
    - `use_local_storage.ts`: Manages some piece of local storage state. Re-renders components that
      depend on the state when it changes.
- `client/web/helpers/lifecycle`:
    - `use_event.ts`: Function who's referential identity never changes and can reference the
      current value of props. (Similar to `useEffectEvent()`.)
    - `use_state_without_dependencies.ts`: Local state that reinitializes if anything in a
      dependency array changes. Useful for state that's partially derived from props.

### Always assume `useEffect()`s execute on every render

Write your `useEffect()`s assuming they have no dependency array and will execute on every render.
It’s very easy for a developer to add a dependency to a dependency array that functionally forces
the effect to run on every render.

One way to defend against effects executing on every render is always protecting side effects with a
ref. For example:

```ts
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
`updateOurAccountLastClientTimeZone()`) when `clientInfo.timeZone` changes.

Another example is if you only want to run your network request on initial mount. Don't set your
effect's dependency array to `[]`, instead use a ref:

```ts
const hasInitiallyMountedRef = useRef(false);

useEffect(() => {
    if (hasInitiallyMountedRef.current) return;
    hasInitiallyMountedRef.current = true;

    updateOurAccountLastClientTimeZone(context, {
        timeZone: clientInfo.timeZone,
    });
}, [context, clientInfo.timeZone]);
```

### Avoid hover interactions

Hover interactions don’t work on mobile. Our app needs to work on both desktop and mobile. Also,
hover interactions can take a lot of dexterity to navigate (hover over element, show overlay,
carefully move mouse into overlay to avoid overlay closing). We do use hover interactions throughout
the product but we don’t recommend them.

Always add press interactions for interactive elements instead. Press interactions are essential on
mobile and feel good on desktop too.

### When using `z-index` create a component local stacking context

We typically use `<Box position="relative" zIndex="0">` to create a new stacking context. That way
you can reason about your `zIndex`es locally to the current component instead of making sure they’re
correct across the entire application.

### When handling the `keydown` event call `event.preventDefault()` and `event.stopPropagation()`

If your code is handling the `keydown` event, call both `event.preventDefault()` and
`event.stopPropagation()`. This prevents parent `keydown` handlers from running. For example, if you
press escape there are sometimes multiple `keydown` handlers and you want the one nearest focus to
run.

### Avoid `event.stopPropagation()` (unless you are handling a `keydown` event)

Don’t use `event.stopPropagation()` unless you are handling a `keydown` event. This way we make sure
parent event handlers always run. For example, if a parent is tracking hover states and you stop
propagation on a `mouseleave` even the parent may think it’s forever hovered.

### Call `setValue()` (from `useState()`) in render to derive state from props

Calling `setValue()` in a React component's render function causes the component to locally
re-render without painting the previous render to the DOM. It's very useful for deriving state from
props. For example, the correct implementation of a `usePrevious()` hook should call `setValue()` in
the render function (instead of `useEffect()`):

```ts
function usePrevious<Value>(value: Value): Value {
    const [[previousValue, currentValue], setPreviousValueState] = useState([value, value]);

    if (value !== currentValue) {
        setPreviousValueState([currentValue, value]);
        return currentValue;
    }

    return previousValue;
}
```

Instead of reaching for `useEffect()` to derive state from props, instead call `setValue()` in the
render function. Only `useEffect()` if there's some side effect you must perform that can't be done
in React render.
