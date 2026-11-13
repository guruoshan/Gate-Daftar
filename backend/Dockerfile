FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migrations ./migrations
COPY openapi.json ./
COPY scripts ./scripts
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001
CMD ["node", "src/index.js"]
