# Use an immutable digest so we always get the same version of `ubuntu`.
#
# We want to use the same Ubuntu version as our GitHub runners which are
# currently on Ubuntu 24.04 LTS (codename Noble) so that we get the same
# version of LibreOffice in our GitHub runners and in file upload service.
# Probably all our services should be on the same operating system as our
# GitHub Runners. We arbitrarily picked `@debian_image` as the base image for
# `AppService`, didn't consider other options, and have given each new service
# the same base image.
FROM ubuntu@sha256:99c35190e22d294cdace2783ac55effc69d32896daaa265f0bbedbcde4fbe3e5

# Use `--snapshot` to install a specific, immutable, version of `libreoffice`.
# We need to install a rolling version of `ca-certificates` first since it's
# required to download snapshot files.
RUN apt install ca-certificates --update --yes && \
    apt install libreoffice --update --snapshot 20241107T000000Z --no-install-recommends --yes
