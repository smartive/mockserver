FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 as deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --only=production

COPY index.js .
COPY cert/ ./cert

FROM deps

EXPOSE 25
EXPOSE 1080

CMD npm start
