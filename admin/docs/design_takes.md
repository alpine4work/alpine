# Design Takes

This document records some, potentially controversial, opinions about software design that have been
applied to Alpine. By no means is this document comprehensive. When we come across a design decision
that warrants some explanation that explanation goes into this document.

The takes in this document are by no way rules for designing Alpine. You may disagree with these
takes and go a different direction in a surface you design. However, it must not jeopardize the
overall feeling of consistency across the product’s design. By knowing why a pattern was established
you can more carefully adapt or break the pattern.

<!--
TODO(calebmer, 2024-03-08): Add a take on color. The interface is mostly monochromatic and color
should come from the user.
-->

<!--
TODO(calebmer, 2024-03-08): I created this document while playing with removing `<MessageInput>`
borders. I like the design but I want to come up with some kind of philosophy on when to use
borders vs not.

The quick version is: `grey-10` to divide different scrollable views (sticky views have different
scroll behaviors), `grey-5` (but not full width) to divide content within a scrollable view,
`grey-10` for creating shapes (e.g. a card). Message inputs are a bit of an exception. They don't
always extend full width and they have an inner `grey-10` border around the input itself. Borders
around inputs are typically `grey-20`.

NOTE(calebmer, 2024-04-08): Now that there are sawtooth borders between document comment threads in
the comment thread notification view, the border discussion is more interesting. The guideline for
comments underneath a post could contribute to this discussion too.
-->

## Avoid hover states

We, as much as possible, avoid changing the appearance of elements on hover or showing essential
information on hover.

Hover states on every interactive element (like a button) is a hallmark of _web_ software design.
It's everywhere on the web whereas in native applications hover states are applied more tastefully.
Play around with an application that comes with your operating system. For example Notes and
Reminders on MacOS. Notice how tabs, buttons, menus, many elements that a web designer would have
slapped a hover state on don’t respond to your mouse. The exception, for MacOS, is icon buttons.
Icon buttons have hover states to make their click target clear.

This is an interesting difference between web software and native software. Let’s reason from first
principles: Software design benefits from simplicity. A user engages software to _do_ something.
Software with many embellishments distracts the user ultimately hindering them from completing their
task. So what do hover states add? Well, for a button that’s already clearly interactive a hover
state does _nothing_. The user knows they’re hovering over the button because they see their mouse
cursor over the button. If anything, when the user is moving their mouse over many elements in the
interface hover states distract the user as elements keep flashing different colors on the screen.

So we avoid hover states that are pure embellishment. They don’t add value so we keep our software
simple by refusing to add them.

Furthermore, hover states don’t work on mobile devices! On a mobile device your pointer is not a
fine grained mouse but rather a coarse, imprecise, finger. The operating system only registers touch
interactions from the finger. There’s no concept of a hover interaction on a touch device. So hover
states can be outright hostile to the user if they hide important information or controls since the
user simply can’t access it on a mobile device.

We do use hover states when they add value and have a reasonable alternative on mobile devices. For
example:

- Hover states help the user understand the hit target of a “quiet” button. A button that is only
  text or an icon without a background color. While it’s clear these buttons are interactive, it’s
  not clear where it’s safe to click on the button to activate it. A hover state communicates the
  hit target.

    For mobile devices the user jabs at the button and we hope for the best.

- Hide controls on desktop that create visual clutter. For example the reply button and more button
  on message bubbles. On mobile you access these controls through other interactions like a long
  press or swipe.

## Vertical vs horizontal more menu three dots icon

The three dots icon is universally understood as an icon button that opens a menu with actions
related to what you’re looking at. We use this convention in our UI but sometimes we use horizontal
three dots and sometimes we use vertical three dots, what gives?

For example, in a document the three dots in the navigation bar are vertical. However, in a chat
message if you hover over the message on desktop the three dots next to the message are horizontal.

This decision was initially made to try and best visually balance the container of the more button
icon. Navigation bars on mobile when they only render the "back" button and "more" button look
visually balanced with vertical three dots. Horizontal three dots looks lopsided. (e.g. See
documents on mobile, scrolled to the top, with horizontal three dots. The navigation bar looks
lopsided.) However, in a message input the actions extend out horizontally when you hover so
horizontal three dots match that.

When in a navigation bar, consistently use vertical three dots. Everywhere else, you can make a
choice based on the container you're in. Another example is posts which use horizontal three dots
when in a feed to visually balance out the post header and create some symmetry with the reaction
button below.

## Use sentence case for all product copy

Use sentence case (“Add due date”) instead of title case (“Add Due Date”) for product copy. For
example: titles, menu items, button labels, and tooltips.

Consistent casing helps the product feel more polished. Sentence casing makes intuitive sense in
menu items and tooltips where text can be a couple words long, so for consistency we use that style
everywhere including button labels which are often two words or less.

From
[Adobe’s grammar style guide](https://spectrum.adobe.com/page/grammar-and-mechanics/#Sentence-case):

> Writing in sentence case has been proven to be easier for users to read and comprehend, it sounds
> more friendly and less formal, and it helps better identify proper nouns and branded terms that
> need to be capitalized.
