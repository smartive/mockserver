FROM node:10

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY index.js .

EXPOSE 1080

ENTRYPOINT [ "npm", "run" ]
CMD [ "start" ]
