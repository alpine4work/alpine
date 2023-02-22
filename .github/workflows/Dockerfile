# Dockerfile for the `calebmer/cyberworlds-ci` container.

FROM ubuntu

RUN apt-get update

# Dependencies necessary for running WebKit with Playwright. Unfortunate Bazel
# or Playwright can't install these.
RUN apt-get install -y libvpx7 \
    libevent-2.1-7 \
    libopus0 \
    libwoff1 \
    libharfbuzz-icu0 \
    libgstreamer-plugins-base1.0-0 \
    libgstreamer-gl1.0-0 \
    libhyphen0 \
    libmanette-0.2-0 \
    libgles2 \
    gstreamer1.0-libav
