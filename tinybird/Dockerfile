FROM python:3.13-slim

RUN sed -i 's|http://deb.debian.org|https://mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/tinybird

COPY handleLogin.sh /usr/local/bin/tinybird-login
COPY getTokens.sh /usr/local/bin/get-tokens
COPY tb-wrapper /usr/local/bin/tb-wrapper

RUN chmod +x /usr/local/bin/tinybird-login /usr/local/bin/get-tokens /usr/local/bin/tb-wrapper \
    && pip install --no-cache-dir \
        --index-url https://mirrors.cloud.tencent.com/pypi/simple \
        tinybird==4.6.9
