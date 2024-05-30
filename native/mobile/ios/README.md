# Alpine iOS Mobile App

## Run the app in a simulator

This will build and launch the app in a simulator:

```
bazel run //native/mobile/ios:app
```

## Build the app for a device

First ask @calebmer to create you a provisioning profile from the company's Apple Developer Account.
Once you have your provisioning profile move it to
`native/mobile/ios/Resources/LocalProvisioningProfile.mobileprovision`.

Then build with:

```
bazel build //native/mobile/ios:app \
    --ios_multi_cpus=arm64 \
    --//native/mobile/ios:provisioning_profile=local \
    "--//native/mobile/ios:base_url=http://$(ifconfig en0 | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -n 1):3000"
```

Here the `--//native/mobile/ios:base_url` option uses a subcommand that attempts to automatically
read your computer’s IP address on your local network. This should result in the same IP address
printed when you run the `dev` command next to "Other devices on your network can access". For
example: `http://192.168.1.160:3000`. To make sure the subcommand has the right IP address you can
add `echo` before `bazel build` (e.g. `echo bazel build //native/mobile/ios:app ...`) to debug the
final command that’ll run.

The easiest way to install the app is to launch Xcode then go to “Windows > Devices and Simulators”.
Then under apps click the plus button and find the `.ipa` file you just built (should be at
`bazel-bin/native/mobile/ios/app.ipa`).
