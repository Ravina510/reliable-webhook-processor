FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
RUN npm install --workspace=@rwp/db --workspace=@rwp/api
COPY packages/db/src ./packages/db/src
COPY packages/db/migrations ./packages/db/migrations
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace=@rwp/db && npm run build --workspace=@rwp/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
EXPOSE 3001
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node apps/api/dist/main.js"]
