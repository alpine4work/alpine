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

-   Hover states help the user understand the hit target of a “quiet” button. A button that is only
    text or an icon without a background color. While it’s clear these buttons are interactive, it’s
    not clear where it’s safe to click on the button to activate it. A hover state communicates the
    hit target.

    For mobile devices the user jabs at the button and we hope for the best.

-   Hide controls on desktop that create visual clutter. For example the reply button and more
    button on message bubbles. On mobile you access these controls through other interactions like a
    long press or swipe.
