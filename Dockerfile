FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8765

WORKDIR /app
COPY --chown=node:node index.html preview-server.cjs ./
USER node

EXPOSE 8765
CMD ["node", "preview-server.cjs"]
