FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 VRP_SIMULATION_DB=/app/data/routescope.db
COPY backend/requirements*.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
RUN useradd --create-home app && mkdir -p /app/data && chown -R app:app /app/data
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

