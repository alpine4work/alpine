# \[2024-01-15\] Web based mobile apps

## Context

We expect usage of workplace software like Alpine to be ~70% desktop and ~30% mobile. Therefore we
need a mobile app with full feature compatibility with Alpine's desktop apps so users can access
their Alpine workspace on the go. A couple considerations when picking the technology to power our
mobile apps:

- **As much shared code as possible:** We need to do more with less at Alpine. After all, we're
  trying to build an entire productivity suite over the next ten years _as a startup_. Building
  completely native iOS and Android apps is a complete non-starter. This would, long term, require
  major engineering headcount investments in native iOS and Android teams. Ideally, we'd hire
  product engineers that build their features across desktop and mobile all at once.

    Not only do we want native iOS and Android apps but we also want our mobile web experience to be
    good! Since Alpine content may be shared with users who don't have the Alpine app on their
    phone.

- **See a path long term to a quality level that matches the platform's own apps:** Over the next
  ten years we'll eventually reach a place where we're competing against the platform's own built in
  apps. (e.g. on Apple our documents product competes against Apple Notes, our tasks product
  competes against Apple Reminders, and our chat product competes against iMessage.) We need to see
  a path where our products can reach a similar level of quality as the platform's own apps so we
  can compete on features + integration not fundamentals.

    However, this is not our #1 priority when the company first meets the market. We need a high
    enough quality level to pitch ourselves as the craft obsessed company but we can sacrifice some
    quality for other goals, like shared code.

- **Ideally, we have over-the-air updates:** Instead of going through Apple's app review every time
  we need to push a change, ideally we want the capability to deploy code changes at any time. This
  requires using a scripting language (like…JavaScript) and downloading scripts from the server.
  This capability is supported by
  [React Native frameworks like Expo](https://docs.expo.dev/eas-update/introduction/).

Eventually we'll also want to have an offline mode. It's not necessary for at least a couple years
but something to keep in mind while we make technical decisions.

## Decision

We're making a bet that we can build an amazing mobile app _with web technology_. This allows us to
have _one_ codebase across all platforms we support. Web is the premier cross platform environment
that's received a huge amount of investment from all the big tech companies over the last decade. We
can't do everything we want from a web browser but using a web browser plus a native wrapper can get
us very far. (After all, web views ultimately are rendered as platform views.)

Also, state-of-the art for rich text editing in native apps is to use
`<div contenteditable="true">`. This is what Airtable, Notion, and Dropbox Paper use. It's very hard
to build cross platform rich text editing on native APIs. (Notable exception:
[Lexical](https://lexical.dev/) by Meta has an
[iOS implementation](https://github.com/facebook/lexical-ios). But this is still a _very_ simple
editor with few of the features we need for `<ContentEditor>`.)

Rich text editing basically requires web code to be some part of our mobile app architecture. Given
rich text editing is such a big part of Alpine (all text is rich text) in some ways it's a useful
simplification to say the entire app is web code.

In order to create a best-in-class experience on top of a web view, here's some of what we implement
in our native wrapper for iOS:

- **Platform navigation animations.** When you tap to navigate to a new screen it uses the iOS
  platform animation. We do this by taking a screenshot of the page before it re-renders then
  animating the newly rendered page on top of the screenshot. We support both the standard iOS
  push/pop animations as well as modals opening from the bottom of the screen.

- **Push notification support.** We request device tokens in native Swift code and send them to our
  server through JavaScript code. This allows us to send proper push notifications to the app (as
  opposed to the [web push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) which is
  limited compared to what's natively supported).

- **Custom keyboard handling.** The default WebKit handling for keyboards in iOS is pretty bad. So
  we completely reimplement keyboard handling in Swift + JavaScript. Manually scrolling our views
  when the keyboard opens.

- **Custom keyboard accessory views.** Our message input animates up with the keyboard. We
  accomplish this by finding the `UIView` that renders the message input and animating it with the
  keyboard in native Swift code.

- **Proper scrollbar insets.** On views that use our `useNavigationBar()` UI for a navigation bar
  that disappears when you scroll we need the scrollbar to be inset so that it doesn't cover the
  navigation bar when the user has scrolled to the top of the view. There's no control for this in
  CSS but we can control this in Swift code.

- **Access to native APIs like haptic feedback.** We expose these native APIs through
  `NativeMobileBridge`. See the documentation on that class for what the various methods we support
  do.

With all this work, the app we've built feels pretty great! There's a lot of work left we can do to
improve the user experience but we have a _very_ promising starting point.

There are still some frustrating limitations. Here are some that we haven't yet found workarounds
for:

- JavaScript code is terminated by WebKit when the app is closed for ~30s causing us to reset the
  page's state whenever the user reopens the app.

- The text cursor is rendered on a layer above all other web views. So it's not covered by
  navigation bars or footers and doesn't move during the keyboard open animation or a scroll.

However, we're betting that long term we'll be able to fork the web browser to get complete control
over our application rendering environment to be able to fix every issue we run into. More on this
in the next section…

### Political environment

This bet is dependent on…politics. The EU has passed regulations that
[require Apple to allow browser engines besides WebKit to run on their phones](https://www.theverge.com/2024/1/25/24050478/apple-ios-17-4-browser-engines-eu).
Apple has built this capability to comply with the EU but the capability is only available…in the
EU.
[The framework Apple provides to comply with the EU regulation is `BrowserEngineKit`](https://developer.apple.com/documentation/BrowserEngineKit).

Apple doesn't allow other browser engines on their phone because they don't want web apps competing
with their app store model. If web apps become popular then Apple won't be able to take its 30% cut
of every purchase on an iPhone since payments would happen on the open web instead of through
Apple's frameworks.

We are aligned with Apple here. We want to distribute our app through the iOS App Store and pay fees
to Apple where applicable. We're not looking to disrupt their app store business model. If we use a
custom browser engine it would _only_ run web pages from https://alpine.inc.

Apple allows alternative JavaScript engines like
[Hermes from Meta for React Native](https://github.com/facebook/hermes). As opposed to Apple's own
[`JavaScriptCore` framework](https://developer.apple.com/documentation/javascriptcore). So now all
React Native apps using Hermes
([the default as of July 2022](https://reactnative.dev/blog/2022/07/08/hermes-as-the-default)) run
their own first-party JavaScript on a JavaScript engine not built by Apple. A logical extension
feels like the ability to run first-party web content on a web engine not built by Apple.

The difference with Hermes is we'd want the entitlements which allow us to run
[just-in-time (JIT) compiled code](https://developer.apple.com/documentation/browserenginekit/protecting-code-compiled-just-in-time).
These entitlements have extra security requirements from Apple. It's unlikely Apple will grant those
entitlements to us given React Native apps can't get access to a JIT. Though we could just accept
JIT will be turned off and use a forked browser engine anyway. That's what React Native has
accepted!

The cleanest path here is: The US government _also_ requires alternative browsers on the iPhone
causing Apple to make `BrowserEngineKit` available globally. This would give us a safe path to
forking the browser on iOS devices. This is what makes our technical bet dependent on the political
environment.

## Consequences

There is a significant amount of unprecedented work involved in getting mobile browsers (in the case
of iOS [`WKWebView`](https://developer.apple.com/documentation/WebKit/WKWebView)) to behave the way
we need. Often we end up writing hacky code (search for comments including
`#mobile-webkit-weirdness` in the codebase) to get what we want. No one building best-in-class apps
is following this path. There is [Cordova](https://cordova.apache.org/) and
[Ionic](https://ionicframework.com/) (built on Cordova) which have been around for a while but it's
commonly accepted these technologies aren't enough for best-in-class apps.

There's also a risk we're blocked from shipping our app _entirely_ by app store review. Given how we
override `WKWebView` behavior (see `native/mobile/ios/Sources/swizzleWKWebView.swift`). We're using
some tricks we've learned from StackOverflow that people say have passed App Store review
([example](https://stackoverflow.com/questions/32546394/hiding-keyboard-accessorybar-in-wkwebview/32620344#32620344)).
But we've also come up with more tricks after reading
[WebKit source code](https://github.com/WebKit/WebKit) that we don't know whether Apple will accept
or not.

There are also real limitations we run into with `WKWebView` which makes the user experience worse
that we can't fix unless we fork WebKit (e.g. cursor issues). These limitations are minor, for now,
but will need to be addressed if we hope to compete against apps like Apple Notes someday.

## Alternatives considered

- **Build fully native apps:** Straight up not an option right now. We don't have the engineering
  bandwidth. Maybe worth considering converting some screens to fully native views in the future but
  this would require staffing native development teams which is expensive. We'll likely always need
  some web views to render `<ContentEditor>`.

- **Use [React Native](https://reactnative.dev/) (and maybe
  [`react-native-web`](https://necolas.github.io/react-native-web/)):** Here we'd build the mobile
  app (and only the mobile app, not the desktop app) with React Native and ship it as the mobile web
  app with `react-native-web`. `<ContentEditor>` would still need to be a web view but everything
  else could be React Native.

    I quite like this architecture concept. If we run into issues with our web app approach this is
    my preferred backup option. It's a little frustrating we won't get JIT compilation for our
    JavaScript code anymore but that doesn't seem to effect apps like Discord.

    Ideally we could run React Native's JavaScript code in the same `WKWebView` as `<ContentEditor>`
    to share memory and allow React Native code to be JIT compiled. But unfortunately the
    [new React Native architecture requires JSI](https://reactnative.dev/architecture/landing-page)
    which needs synchronous access to JavaScript objects via C++ which isn't possible in `WKWebView`
    as far as I know know due to `WKWebView`'s threading model.
