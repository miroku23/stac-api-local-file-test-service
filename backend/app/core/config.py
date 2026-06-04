from pydantic import Field
from pydantic_settings import BaseSettings


DATA_ROOT_DIR = "/app/data"
TEMP_ROOT_DIR = "/app/temp"


class Settings(BaseSettings):
    # Route values are supplied by compose/env so backend-generated hrefs match the running deployment.
    nginx_api_path: str = Field(validation_alias="NGINX_API_PATH")
    nginx_stac_path: str = Field(validation_alias="NGINX_STAC_PATH")
    nginx_stac_api_alias: str = Field(validation_alias="NGINX_STAC_API_ALIAS")
    nginx_stac_api_port: int = Field(validation_alias="NGINX_STAC_API_PORT")
    enable_data_watch: bool = False
    zarr_convert_max_workers: int = 2

    @property
    def data_root(self) -> str:
        return DATA_ROOT_DIR

    @property
    def upload_temp_dir(self) -> str:
        return TEMP_ROOT_DIR

    @property
    def api_context_path(self) -> str:
        return self.nginx_api_path.rstrip("/")

    @property
    def stac_api_url(self) -> str:
        return self.nginx_stac_path.rstrip("/")

    @property
    def stac_api_internal_url(self) -> str:
        return f"http://{self.nginx_stac_api_alias}:{self.nginx_stac_api_port}"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
