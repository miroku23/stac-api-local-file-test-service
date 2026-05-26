import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.services.download.cmems_service import cmems_service
from app.services.download.ecmwf_service import ecmwf_service
from app.services.download.gfs_service import gfs_service
from app.services.download.noaa_service import noaa_service
from app.services.download.tle_service import tle_service

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


class WeatherDownloadRequest(BaseModel):
    date: str
    time: str = "00"
    category: str
    area: List[float] = Field(default_factory=list)
    extra_params: Dict[str, Any] = Field(default_factory=dict)


class SatelliteDatasetRequest(BaseModel):
    satellite: str
    product_type: str = ""
    level: str = "L2"
    count: int | None = None


@router.post("/ecmwf")
async def api_download_ecmwf(req: WeatherDownloadRequest):
    try:
        result = await run_in_threadpool(
            ecmwf_service.execute,
            date=req.date,
            time=req.time,
            category=req.category,
            area=req.area,
            extra_params=req.extra_params,
        )
        return {"status": "success", "provider": "ECMWF", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gfs")
async def api_download_gfs(req: WeatherDownloadRequest):
    try:
        result = await run_in_threadpool(
            gfs_service.execute,
            date=req.date,
            time=req.time,
            category=req.category,
            area=req.area,
            extra_params=req.extra_params,
        )
        return {"status": "success", "provider": "GFS", "data": result}
    except Exception as e:
        logger.exception("GFS download failed")
        raise HTTPException(status_code=500, detail=str(e))


async def _download_cmems(req: WeatherDownloadRequest):
    try:
        logger.info(
            "CMEMS download request received: date=%s time=%s category=%s area=%s extra_keys=%s",
            req.date,
            req.time,
            req.category,
            req.area,
            list((req.extra_params or {}).keys()),
        )
        result = await run_in_threadpool(
            cmems_service.execute,
            date=req.date,
            time=req.time,
            category=req.category,
            area=req.area,
            extra_params=req.extra_params,
        )
        return {"status": "success", "provider": "CMEMS", "data": result}
    except Exception as e:
        logger.exception("CMEMS download failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cmems")
async def api_download_cmems(req: WeatherDownloadRequest):
    return await _download_cmems(req)


@router.post("/cms")
async def api_download_cms_alias(req: WeatherDownloadRequest):
    return await _download_cmems(req)


@router.post("/tle")
async def api_download_tle(req: WeatherDownloadRequest):
    try:
        result = await run_in_threadpool(
            tle_service.execute,
            date=req.date,
            time=req.time,
            category=req.category,
            area=req.area,
            extra_params=req.extra_params,
        )
        return {"status": "success", "provider": "TLE", "data": result}
    except Exception as e:
        logger.exception("TLE download failed")
        raise HTTPException(status_code=500, detail=str(e))


async def _download_noaa(req: WeatherDownloadRequest, satellite: str):
    try:
        result = await run_in_threadpool(
            noaa_service.execute,
            date=req.date,
            time=req.time,
            category=req.category,
            area=req.area,
            extra_params=req.extra_params,
            satellite=satellite,
        )
        return {"status": "success", "provider": satellite, "data": result}
    except Exception as e:
        logger.exception("%s NOAA satellite download failed", satellite)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tempo")
async def api_download_tempo(req: WeatherDownloadRequest):
    return await _download_noaa(req, "TEMPO")


@router.post("/sentinel5p")
async def api_download_sentinel5p(req: WeatherDownloadRequest):
    return await _download_noaa(req, "SENTINEL5P")


@router.post("/datasets")
async def api_search_satellite_datasets(req: SatelliteDatasetRequest):
    try:
        result = await run_in_threadpool(
            noaa_service.search_datasets,
            satellite=req.satellite,
            product_type=req.product_type,
            level=req.level,
            count=req.count,
        )
        return {"status": "success", "provider": req.satellite.upper(), "data": result}
    except Exception as e:
        logger.exception("%s satellite dataset search failed", req.satellite)
        raise HTTPException(status_code=500, detail=str(e))
