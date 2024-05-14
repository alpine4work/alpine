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
    --//native/mobile/ios:base_url=$BASE_URL
```

Where `$BASE_URL` is the URL devices on your network can use to access your developer environment.
This URL is printed when you run the `dev` command next to "Other devices on your network can
access". For example: `http://192.168.1.160:3000`.

The easiest way to install the app is to launch Xcode then go to “Windows > Devices and Simulators”.
Then under apps click the plus button and find the `.ipa` file you just built (should be at
`bazel-bin/native/mobile/ios/app.ipa`).
