FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
RUN npm install --workspace=@rwp/db --workspace=@rwp/worker
COPY packages/db/src ./packages/db/src
COPY packages/db/migrations ./packages/db/migrations
COPY apps/worker/src ./apps/worker/src
RUN npm run build --workspace=@rwp/db && npm run build --workspace=@rwp/worker

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
CMD ["node", "apps/worker/dist/main.js"]
