# Use an immutable digest so we always get the same version of `ubuntu`.
#
# We want to use the same Ubuntu version as our GitHub runners which are
# currently on Ubuntu 24.04 LTS (codename Noble) to accurately reproduce test
# runner conditions.
FROM ubuntu@sha256:99c35190e22d294cdace2783ac55effc69d32896daaa265f0bbedbcde4fbe3e5

# Why we install the following dependencies:
#
# - `sudo`: Allow our test user to have root access
# - `curl`: Needed by `bazelisk` to install Bazel
# - `zip`: Needed to patch `dynamo_local`
# - `build-essential`, `python3`, and `python3-setuptools`: Needed to install
#   node modules with a native build step that uses the Python-based `node-gyp`
RUN apt-get update && apt install --yes \
    sudo \
    curl \
    zip \
    build-essential \
    python3 \
    python3-setuptools

# Add a `test` user with the password `test`.
RUN useradd -m test -s /bin/bash && \
    echo "test:test" | chpasswd && \
    usermod -aG sudo test && \
    echo 'export PATH=$PATH:/home/test/cyberworlds/admin/bin' >> /home/test/.bashrc

USER test
VOLUME /home/test/cyberworlds
WORKDIR /home/test/cyberworlds
CMD ["/bin/bash"]
