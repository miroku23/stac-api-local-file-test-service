import os

from ecmwf.opendata import Client

from app.core.config import settings


class ECMWFDownloadService:
    def __init__(self):
        self.base_dir = settings.data_raw_dir
        self.client = Client(source="ecmwf")

    def execute(self, date: str, time: str, category: str, area: list, extra_params: dict):
        extra_params = extra_params or {}
        category = (category or "WIND").upper()
        detail_tag, params = self._parameters(category, extra_params)

        yyyymm, dd = date[:6], date[6:]
        target_dir = os.path.join(self.base_dir, "ECMWF", category, yyyymm, dd)
        os.makedirs(target_dir, exist_ok=True)

        file_name = f"ECMWF_{category}_{detail_tag}_{date}_{time}.grib2"
        final_path = os.path.join(target_dir, file_name)

        try:
            download_args = {
                "date": int(date),
                "time": int(time),
                "step": int(extra_params.get("step", 0)),
                "param": params,
                "target": final_path,
            }

            if area != [90, -180, -90, 180]:
                download_args["area"] = area

            self.client.retrieve(**download_args)

            return {
                "file_name": file_name,
                "full_path": final_path,
                "category": category,
                "format": "GRIB2",
                "size_mb": round(os.path.getsize(final_path) / (1024 * 1024), 2),
            }

        except Exception as e:
            if os.path.exists(final_path):
                os.remove(final_path)
            raise Exception(f"ECMWF GRIB2 download failed: {str(e)}")

    def _parameters(self, category: str, extra_params: dict):
        if category == "TEMP":
            detail_tag = extra_params.get("type", "2t")
            return detail_tag, [detail_tag]

        if category == "WIND":
            level = extra_params.get("level", "10m")
            if level == "10m":
                return level, ["10u", "10v"]
            if level == "100m":
                return level, ["100u", "100v"]
            if level == "gust":
                return level, ["10fg"]
            raise ValueError("Unsupported ECMWF wind level.")

        if category == "PRECIP":
            detail_tag = extra_params.get("type", "tp")
            return detail_tag, [detail_tag]

        if category == "RH":
            return "r", ["r"]

        if category == "HPA":
            return "msl", ["msl"]

        raise ValueError(f"Unsupported ECMWF category: {category}")


ecmwf_service = ECMWFDownloadService()
