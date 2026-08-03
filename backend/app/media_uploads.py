"""Bounded streaming helpers for large browser video uploads."""

from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile


class EmptyUploadError(ValueError):
    pass


class UploadTooLargeError(ValueError):
    pass


def stream_upload_to_path(
    upload: UploadFile,
    destination: Path,
    *,
    max_size: int,
    chunk_size: int = 1024 * 1024,
) -> int:
    """Write an UploadFile in chunks and delete partial files on failure."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    total_size = 0

    try:
        with destination.open("wb") as output:
            while True:
                chunk = upload.file.read(chunk_size)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > max_size:
                    raise UploadTooLargeError
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    if total_size == 0:
        destination.unlink(missing_ok=True)
        raise EmptyUploadError
    return total_size
