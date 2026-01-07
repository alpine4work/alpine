# \[2023-01-21\] `<VirtualizedScrollView>`

## Context

For our forum product we have this experience where you have a list of posts and for any post you
can expand the comment section and read all of its comments inline.
[Here is a screenshot of a post with its comments expanded](https://drive.google.com/file/d/1YEjO6J5R2-wzSuSCLgTcfVYHIscatjuO/view?usp=sharing).

You can have tens of thousands of posts to scroll through and any post can have tens of thousands of
comments. The cost of loading all that data to the client at once is unacceptable and even if we did
load all that data web browsers can't handle thousands of DOM nodes being rendered at once. FPS will
drop.

To have acceptable performance we need to implement two techniques:

- **List virtualization:** Only rendering items that are currently visible on the user's screen.
  (For more information see [this article](https://www.patterns.dev/posts/virtual-lists/).)
- **Infinite loading:** As the user scrolls to the end of the list we load more data. Alternatively
  we allocate enough space for all items in the list and if the user drags the scroll bar to a
  random location within the list we load data at that location.

Requirements for our virtualization solution:

- Can render heterogenous data in the same list with dynamic heights. If you know every item is
  100px tall and you know there are 1,000 items in the list then you know the height of your list.
  We can not know this about our items. Every post and comment is user data of arbitrary height.

- Item heights can not be statically known. We can't predict the height of text rendered by the
  browser engine. We can only determine the final height of an item by first rendering it then
  positioning it in a second pass.

- Item heights can resize at any time without forcing a full re-layout. Users can edit the contents
  of their posts and comments. Doing so should immediately update so the user doesn't see a glitch
  but should not cause an expensive recomputation where we need to recompute the offsets of each
  item underneath the one who's height changed.

- Manually implements
  [scroll anchoring](https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md). Browsers
  manually implement a technique called scroll anchoring so that if the height of content above the
  user's scroll window changes it does not shift the content the user is looking at (causing a
  disruptive experience). Scroll anchoring does not kick in on virtualized lists since everything is
  absolutely positioned so our virtualized list solution needs to reimplement scroll anchoring.

    Scroll anchoring is essential for rendering a chat interface where the user starts scrolled all
    the way at the bottom of the view and then scrolls up. As the user scrolls up we render and
    measure un-rendered items. This changes the height of content above where the user is currently
    scrolled. If we don't anchor the user then the experience scrolling from bottom to top of such a
    list is incredibly janky.

- Can be server-side rendered. We use Remix which server-side renders all content first. React as a
  framework is moving towards adding more and more server-side rendering features for performance.
  To align ourselves with our frameworks, we want as much of our product to be server-side rendered
  as possible.

- We can implement advanced sticky elements that tightly integrate with the scroll window. There are
  two other scroll linked features in our designs. First is the post comment input, if you are
  viewing a post then its comment input is pinned to the bottom of your screen. Until you scroll the
  post out of view. Second is the channel sidebar. If the channel sidebar gets too tall for you
  screen then it should scroll down with the rest of your content and then stop once you reach the
  bottom of the sidebar while the rest of the post content continues scrolling down.

    It's
    [hard to build scroll-linked effects](https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html)
    that aren't jittery. because scrolling happens asynchronously in a separate browser thread.
    `position: sticky` was designed for this use case but requires tight integration with the
    scrollable view so your virtualized list implementation needs to support escape hatches.

## Decision

I wrote my own virtualized list implementation: the `<VirtualizedScrollView>` component. The
`<VirtualizedScrollView>` is backed by the `VirtualizedScrollViewState` class which is an immutable
object that implements the windowing logic for our scroll view.

Simplifying `VirtualizedScrollViewState` to its absolute essence would look like:

```ts
type VirtualizedScrollViewState = BinaryTree<
    OrderKey,
    | {
          type: "Item";
          key: Key;
          height: number;
      }
    | {
          type: "Buffer";
          itemCount: number;
      }
>;
```

A binary tree where items are keyed by a
[fractional index](https://observablehq.com/@dgreensp/implementing-fractional-indexing) (which we
call `OrderKey`). We can generate a new fractional index between any two existing fractional
indexes. This allows us to insert new items anywhere in the list in O(log(n)) time without updating
every item's index. We have a `Buffer` range wherever we don't have measured items. We estimate the
height of this buffer range.

Because we are using a binary tree we get efficient insertion into the virtualized scroll view as we
render and measure new items. We also can cache computations on subtrees! For example, to get the
total height of the virtualized scroll view we recursively sum up the heights of items in all
subtrees and cache those heights. This is O(n) the first time. If the height of a single item
changes we run this computation again but because of structural sharing, we still have the height of
subtrees that weren't touched. So getting the total height of the tree is O(log(n)) after an
insertion. We can also compute the offset of an item in the virtualized list this way. We can get
the height of content to the left of an item which is fast because we've cached this computation for
each subtree.

The state object is the innovative part compared to other virtualized scroll views on the market.
The component itself is fairly standard (absolutely positioned elements) but we can implement all
our requirements that aren't present in other virtualized scroll view libraries like a custom
[scroll anchoring](https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md) implementation.

## Consequences

We have to maintain our own virtualized scroll view instead of relying on the open source
community…Since core parts of our product need to be virtualized it can be good that we have our
virtualization solution in house so we can really tune it for performance and user experience.

Also, we now have a virtualization solution that is far ahead of what is available in open source
that can be applied to other use cases! For example Kanban like interfaces where you similarly have
cards of unknown dynamic size you need to virtualize. Hopefully this component sees more use across
the product.

## Alternatives considered

The popular virtualization solutions for React,
[`react-window`](https://www.npmjs.com/package/react-window) and
[`react-virtualized`](https://www.npmjs.com/package/react-virtualized) do not support our advanced
requirements.

I tried for a bit using `react-window` as a base and adding some of these features on top but very
quickly realized it was too difficult to get the performance and functionality I needed.
