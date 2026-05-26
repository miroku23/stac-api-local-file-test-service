FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libpq-dev \
    libeccodes-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /root/.copernicusmarine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["sh", "-lc", "uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${BACKEND_WORKERS:-4}"]
