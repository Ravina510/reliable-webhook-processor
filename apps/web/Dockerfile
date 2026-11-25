FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/tsconfig.json apps/web/next.config.mjs ./apps/web/
RUN npm install --workspace=@rwp/web
COPY apps/web/src ./apps/web/src
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@rwp/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=builder /app/apps/web/.next ./apps/web/.next
EXPOSE 3000
CMD ["npx", "next", "start", "apps/web", "-p", "3000", "-H", "0.0.0.0"]