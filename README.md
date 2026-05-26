# Zarr API Project

기상/위성 데이터를 다운로드, 탐색, 변환하고 Zarr 결과를 WebGL 기반 뷰어에서 확인하는 Docker 기반 프로젝트입니다. 이 프로젝트는 Docker Compose 구동을 전제로 합니다.

## 전체 구조

| 영역 | 경로 | 설명 |
| --- | --- | --- |
| Backend | `backend/` | FastAPI 서버입니다. 파일 탐색, 업로드, 다운로드, 변환, 모니터링, STAC 연동 API를 제공합니다. |
| Frontend | `frontend/` | Vue/Vite 기반 모노레포입니다. `file-manage`와 `geo-viewer` 앱을 포함합니다. |
| Nginx | `nginx/` | 브라우저 진입점을 하나로 묶는 리버스 프록시입니다. `.env`의 Nginx 경로 값을 템플릿에 반영합니다. |
| STAC | `stac/` | `pgstac` DB와 `stac-fastapi-pgstac` API 서버를 포함합니다. |
| WASM | `wasm/` | Geo Viewer에서 사용할 수 있는 Rust/WebAssembly WebGL 가속 모듈입니다. |

## 환경 파일

루트의 `.env` 하나를 전역 환경 파일로 사용합니다. `.env.example`은 공유용 템플릿이며, 실제 로컬 경로와 계정값은 비워둡니다.

```bash
cp .env.example .env
docker compose up --build
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

## 중요한 마운트 값

가장 중요한 값은 호스트 경로를 컨테이너 경로로 연결하는 두 변수입니다.

```text
LOCAL_DATA_PATH -> /app/data
LOCAL_TEMP_PATH -> /app/temp
```

Backend 컨테이너 내부 경로는 고정값으로 다룹니다.

```text
/app/data/DATA   # 원본 데이터
/app/data/ZARR   # 변환된 Zarr 데이터
/app/temp        # 업로드/변환/다운로드 임시 파일
```

따라서 `.env`에서 `DATA_ROOT_DIR`, `TEMP_ROOT_DIR`를 따로 설정하지 않습니다. 필요한 경우 Backend 기본값은 `backend/app/core/config.py`에서 관리합니다.

## Docker 서비스

| 서비스 | 역할 | 내부 포트 | 외부 접근 |
| --- | --- | ---: | --- |
| `nginx` | 통합 리버스 프록시 | `80` | `${NGINX_PORT:-9000}` |
| `backend` | FastAPI API 서버 | `8000` | Nginx 경유 |
| `file-manage` | 파일 관리 Vite 앱 | `5173` | Nginx 경유 |
| `geo-viewer` | 지도/WebGL Vite 앱 | `5174` | Nginx 경유 |
| `pgstac` | STAC PostgreSQL/PostGIS DB | `5432` | Docker 내부 |
| `stac-api` | STAC FastAPI 서버 | `8080` | Nginx 경유 |

기본 접속 주소:

- File Manage: `http://localhost:9000/manage/`
- Geo Viewer: `http://localhost:9000/viewer/`
- Backend API context: `http://localhost:9000/api/`
- Inspect API: `http://localhost:9000/api/inspect/`
- Event Stream: `http://localhost:9000/api/events/watch`
- STAC API: `http://localhost:9000/stac/`

## Nginx 경로 설정

Nginx는 `nginx/default.conf.template`을 사용합니다. 컨테이너 시작 시 루트 `.env`의 `NGINX_*` 값이 실제 Nginx conf에 반영됩니다.

```env
NGINX_PORT=9000

NGINX_FILE_MANAGE_PATH=/manage
NGINX_GEO_VIEWER_PATH=/viewer
NGINX_API_PATH=/api
NGINX_STAC_PATH=/stac

NGINX_BACKEND_ALIAS=backend-api
NGINX_BACKEND_PORT=8000
NGINX_FILE_MANAGE_ALIAS=file-manage-app
NGINX_FILE_MANAGE_PORT=5173
NGINX_GEO_VIEWER_ALIAS=geo-viewer-app
NGINX_GEO_VIEWER_PORT=5174
NGINX_STAC_API_ALIAS=stac-api-upstream
NGINX_STAC_API_PORT=8080
```

`NGINX_API_PATH`는 Backend 전체 외부 context입니다. 브라우저에서는 `/api/monitor/root`, `/api/inspect/structure`, `/api/events/watch`, `/api/data/zarr`처럼 호출하고, Nginx가 `/api` context를 제거한 뒤 Backend 컨테이너로 전달합니다.

Nginx upstream host는 Docker Compose 서비스명 대신 network alias를 사용합니다. alias도 `.env`에서 관리하며, Compose가 각 서비스에 alias를 등록하고 Nginx 템플릿에도 같은 값을 렌더링합니다.

```text
NGINX_BACKEND_ALIAS=backend-api
NGINX_FILE_MANAGE_ALIAS=file-manage-app
NGINX_GEO_VIEWER_ALIAS=geo-viewer-app
NGINX_STAC_API_ALIAS=stac-api-upstream
```

같은 Compose 네트워크여도 `localhost`는 사용할 수 없습니다. Nginx 컨테이너 안에서 `localhost`는 Nginx 컨테이너 자신을 의미하고, 다른 서비스 컨테이너를 의미하지 않습니다. upstream 이름을 바꾸고 싶으면 대응되는 `NGINX_*_ALIAS`, 내부 포트를 바꾸고 싶으면 대응되는 `NGINX_*_PORT`를 바꾸면 됩니다.

Frontend의 Vite base path는 별도 `VITE_FILE_MANAGE_BASE`, `VITE_GEO_VIEWER_BASE`를 사용하지 않습니다. `frontend/apps/*/vite.config.js`가 `NGINX_FILE_MANAGE_PATH`, `NGINX_GEO_VIEWER_PATH`를 읽어서 자동으로 base path를 만듭니다.

`VITE_BACKEND_URL`, `VITE_DATA_BASE_URL`, `VITE_RAW_DATA_BASE_URL`도 사용하지 않습니다. 프론트 앱은 `NGINX_API_PATH`를 기준으로 요청 URL을 만들고, 실제 Backend 서비스명은 Nginx conf의 upstream에서만 관리합니다.

`NGINX_STAC_PATH`는 STAC API의 외부 경로이며, `stac-api` 컨테이너의 `UVICORN_ROOT_PATH`에도 같은 값으로 전달됩니다. 별도 `STAC_API_URL`은 사용하지 않습니다.

## 실행

전체 스택 실행:

```bash
docker compose up --build
```

백그라운드 실행:

```bash
docker compose up --build -d
```

로그 확인:

```bash
docker compose logs -f
```

중지:

```bash
docker compose down
```
