# SWC Plugin Crate

This crate hosts all repository-wide SWC transforms.

## Adding or updating crates

1. Update `Cargo.toml` with the new dependency.
2. Regenerate the Cargo lockfile:

```bash
cargo generate-lockfile
```

3. Repin Bazel crate metadata (generates/updates `cargo-bazel-lock.json`):

```bash
CARGO_BAZEL_REPIN=1 bazel sync --only=swc_plugin_crates
```

## Notes

- Bazel consumes two lockfiles:
    - `Cargo.lock` (Cargo resolver output)
    - `cargo-bazel-lock.json` (crate_universe metadata)
- The `swc_plugin_crates` repository is configured in `WORKSPACE` and feeds dependencies to
  `//admin/swc/plugin:plugin_wasm`.

# Vendoring

We've vendored the built WASM SWC plugin because it takes a while to build the plugin otherwise. We
don't want to pay that cost on every dev machine, CI run, and cloud agent run when the plugin
updates so infrequently.

If you update the plugin, you'll need to run the following to update the vendored WASM file:

```bash
bazel build //admin/swc/plugin:plugin_wasm --compilation_mode=opt --@rules_rust//rust/settings:lto=fat && cp bazel-bin/admin/swc/plugin/plugin_wasm.wasm admin/swc/plugin/plugin_wasm_vendored.wasm && chmod +w admin/swc/plugin/plugin_wasm_vendored.wasm
```
