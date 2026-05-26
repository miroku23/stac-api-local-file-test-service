from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    data_root_dir: str = "/app/data"
    stac_catalog_dir: str = "/app/stac/catalog"
    nginx_api_path: str = "/api"
    nginx_stac_path: str = "/stac"
    project_name: str = "Zarr-API"
    temp_root_dir: str = "/app/temp"
    zarr_convert_max_workers: int = 2

    @property
    def data_root(self) -> str:
        return self.data_root_dir.rstrip("/")

    @property
    def data_raw_dir(self) -> str:
        return f"{self.data_root}/DATA"

    @property
    def data_processed_dir(self) -> str:
        return f"{self.data_root}/ZARR"

    @property
    def upload_temp_dir(self) -> str:
        return self.temp_root_dir.rstrip("/")

    @property
    def api_context_path(self) -> str:
        return self.nginx_api_path.rstrip("/") or "/api"

    @property
    def stac_api_url(self) -> str:
        return self.nginx_stac_path.rstrip("/") or "/stac"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
