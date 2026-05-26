FROM node:20-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/file-manage/package.json ./apps/file-manage/package.json
COPY apps/geo-viewer/package.json ./apps/geo-viewer/package.json
COPY packages/ui/package.json ./packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173 5174 6006

CMD ["pnpm", "dev:docker"]
