FROM node:22.19.0-alpine as deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --only=production

COPY index.js .
COPY cert/ ./cert

FROM deps

EXPOSE 25
EXPOSE 1080

CMD npm start
