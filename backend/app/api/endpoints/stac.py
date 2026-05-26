from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.services.stac_catalog import stac_catalog_service

router = APIRouter()


class StacCatalogRequest(BaseModel):
    path: str
    source: str = "raw"


@router.post("/catalog")
async def create_stac_catalog(req: StacCatalogRequest):
    try:
        return await run_in_threadpool(stac_catalog_service.create_item, req.path, req.source)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STAC catalog generation failed: {str(e)}")
