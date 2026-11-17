ARG BASE_IMAGE=python:3.12-slim
FROM ${BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    SUPERCHARGE_DATA=/srv/data SUPERCHARGE_FRONTEND=/srv/frontend

WORKDIR /srv
COPY app/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt

COPY implementations/python/supercharge /srv/supercharge
COPY app/backend /srv/backend
COPY app/frontend /srv/frontend
COPY website/data/reference-instance.json website/data/reference-area.geojson /srv/data/

RUN useradd --create-home --uid 10001 lab
USER lab
WORKDIR /srv/backend
ENV PYTHONPATH=/srv
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
