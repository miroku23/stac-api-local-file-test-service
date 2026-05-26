from pathlib import Path


def safe_join(base_dir: str, relative_path: str | None = "") -> Path:
    base = Path(base_dir).resolve()
    requested = (relative_path or "").strip().lstrip("/\\")
    target = (base / requested).resolve()

    if target != base and base not in target.parents:
        raise ValueError("Requested path is outside the configured data directory.")

    return target
