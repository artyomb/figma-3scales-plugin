# TODO Not working ((
# docker build . --progress=plain
FROM node:22
RUN npm install -g figcd
WORKDIR /app
COPY . .
ENV FIGMA_WEB_AUTHN_TOKEN=figd_F-...
RUN figcd current-version
RUN npx figcd prepare
# RUN npx figcd release
