FROM python:3.12-alpine

WORKDIR /app

# Copy version file first (for caching)
COPY VERSION ./VERSION

# Copy and install MCP server package
COPY mcp-server/ ./
RUN pip install --no-cache-dir .

# Non-root user
RUN adduser -D -u 1001 appuser
USER appuser

EXPOSE 8001

CMD ["python", "-m", "turbo_ea_mcp", "--host", "0.0.0.0", "--port", "8001"]
