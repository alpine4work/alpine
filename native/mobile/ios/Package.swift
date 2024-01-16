// swift-tools-version:5.3

import PackageDescription

// Create a fake Swift package so we can use the Swift VSCode plugin to provide
// autocompletion and type checking for our iOS code. We build our app with
// Bazel, not SwiftPM.
let package = Package(
    name: "Cyberworlds",
    platforms: [.iOS(.v14)],
    products: [.library(name: "Cyberworlds", targets: ["Cyberworlds"])],
    targets: [.target(name: "Cyberworlds", path: "Sources")]
)
