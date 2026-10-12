# Runs the FeedMyAgent MCP server (stdio) from source, e.g. for Glama's checks.
FROM node:22-alpine
WORKDIR /app
COPY mcp/ ./
RUN npm install --omit=dev --no-audit --no-fund
# Tags any key the server self-provisions so these runs can be excluded from adoption counts.
ENV FEEDMYAGENT_REF=glama
CMD ["node", "server.js"]
