ARG CONFIG_UI_TAG_OR_HASH=cd0b33ce788286b60289185bfcd58ccc931e7092

FROM node:22.13.1 as build

WORKDIR /tmp/buildApp

COPY ./package*.json ./

RUN npm ci
COPY . .
RUN npm run build

FROM node:22.13.1 as build-ui

WORKDIR /tmp/buildApp
RUN apt-get update && apt-get install -y git
RUN git clone https://github.com/MapColonies/config-ui.git && \
    cd config-ui && \
    git checkout ${CONFIG_UI_TAG_OR_HASH} && \
    npm ci && \
    npm run build

FROM node:22.13.1-alpine3.21 as production

RUN apk add dumb-init

ENV NODE_ENV=production
ENV SERVER_PORT=8080
ENV SERVER_ENABLE_STATIC=true
ENV SERVER_API_PREFIX=/api

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci --only=production

COPY --chown=node:node --from=build /tmp/buildApp/dist .
COPY --chown=node:node ./config ./config
COPY --chown=node:node --from=build-ui /tmp/buildApp/config-ui/dist ./static


USER node
EXPOSE 8080
CMD ["dumb-init", "node", "--max_old_space_size=512", "--require", "./common/tracing.js", "./index.js"]
