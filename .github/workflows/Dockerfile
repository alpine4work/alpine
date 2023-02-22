# Dockerfile for the `calebmer/cyberworlds-ci` container.
#
# To update run:
#
# ```
# docker buildx build --platform linux/amd64 .github/workflows
# docker push calebmer/cyberworlds-ci
# ```
#
# `docker buildx` performs a cross-platform build in case you're running on
# an M1 Mac (which has an arm cpu instead of an amd cpu).

FROM ubuntu

RUN apt-get update

# Dependencies necessary for running WebKit with Playwright. Unfortunately
# Playwright doesn't install these on its own.
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
