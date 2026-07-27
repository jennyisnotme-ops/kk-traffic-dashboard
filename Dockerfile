FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache build-base g++ cairo-dev pango-dev giflib-dev pkgconfig python3 fontconfig font-noto font-noto-cjk \
  && npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
