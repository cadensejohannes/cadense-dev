FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.js ./
COPY src ./src
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/cadense.sqlite USERS_FILE=/data/users.json
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
