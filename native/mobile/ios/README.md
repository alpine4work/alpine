# Alpine iOS Mobile App

## Run the app in a simulator

This will build and launch the app in a simulator:

```
bazel run //native/mobile/ios:app
```

## Build the app for a development device

First ask @calebmer to create you a provisioning profile from the company's Apple Developer Account.
Once you have your provisioning profile move it to
`native/mobile/ios/Resources/LocalDevelopmentProvisioningProfile.mobileprovision`.

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

## Build the app for production

To distribute the app in the Apple app store, you need to:

1. Build the app for production
2. Upload the app to Apple

To build the app for production run:

```
bazel build //native/mobile/ios:app \
    --compilation_mode=opt \
    --ios_multi_cpus=arm64 \
    --apple_generate_dsym \
    --define=apple.add_debugger_entitlement=no \
    --//native/mobile/ios:run_environment=production \
    --//native/mobile/ios:provisioning_profile=local \
    --//native/mobile/ios:base_url=https://alpine.inc
```

Run the following command to upload the app to Apple. You'll be prompted for a username and
password. The username is the email associated with your Apple ID. The password should be an
app-specific password. To generate an app-specific password log into
[https://appleid.apple.com](https://appleid.apple.com).

```
echo -n "Username: " && read username && \
echo -n "Password: " && read password && \
xcrun altool \
    --upload-app \
    --type ios \
    -file bazel-bin/native/mobile/ios/app.ipa \
    -u "$username" \
    -p "$password"
```
