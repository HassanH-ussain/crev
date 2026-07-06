# CREV Backend — FastAPI + CREV analysis engine
FROM python:3.12-slim

# Run as a non-root user; CREV writes its config/cache under $HOME/.crev
RUN useradd --create-home --shell /usr/sbin/nologin crev

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY crev/ ./crev/
COPY server.py .

USER crev
ENV HOME=/home/crev

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
