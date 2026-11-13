FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ARG API_PROXY_TARGET=http://api:3001
ENV API_PROXY_TARGET=${API_PROXY_TARGET}

EXPOSE 5173
CMD ["npm", "run", "preview"]
