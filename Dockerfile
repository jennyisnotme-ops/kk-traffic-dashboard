FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache build-base g++ cairo-dev pango-dev giflib-dev \
  && npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
