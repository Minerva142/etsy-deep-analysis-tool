# @duckdb/node-api yerel (native) ikili kullanıyor. Alpine'in musl libc'si
# için hazır ikili yayınlanmıyor, bu yüzden glibc tabanlı bookworm-slim.
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Önce yalnızca manifest'ler: kaynak değiştiğinde bağımlılık katmanı
# yeniden kurulmaz, imaj yeniden inşası saniyeler sürer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/cli/package.json apps/cli/

RUN pnpm install --frozen-lockfile

COPY . .

# Veritabanı bir volume'a bağlanır; container silinince veri kaybolmaz.
ENV DUCKDB_PATH=/app/data/etsy.duckdb
VOLUME ["/app/data"]

# `docker compose run --rm cli snapshot --niche ...` şeklinde çağrılır.
ENTRYPOINT ["pnpm"]
CMD ["test"]
