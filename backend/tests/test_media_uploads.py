import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import UploadFile

from app.media_uploads import (
    EmptyUploadError,
    UploadTooLargeError,
    stream_upload_to_path,
)


class MediaUploadTests(unittest.TestCase):
    def test_streams_file_in_chunks(self) -> None:
        payload = b"a" * (2 * 1024 * 1024 + 17)
        upload = UploadFile(filename="video.webm", file=io.BytesIO(payload))
        with TemporaryDirectory() as directory:
            path = Path(directory) / "video.webm"
            saved_size = stream_upload_to_path(
                upload,
                path,
                max_size=3 * 1024 * 1024,
            )
            self.assertEqual(saved_size, len(payload))
            self.assertEqual(path.read_bytes(), payload)

    def test_oversized_partial_file_is_deleted(self) -> None:
        upload = UploadFile(
            filename="video.webm",
            file=io.BytesIO(b"a" * 2048),
        )
        with TemporaryDirectory() as directory:
            path = Path(directory) / "video.webm"
            with self.assertRaises(UploadTooLargeError):
                stream_upload_to_path(
                    upload,
                    path,
                    max_size=1024,
                    chunk_size=256,
                )
            self.assertFalse(path.exists())

    def test_empty_upload_is_rejected(self) -> None:
        upload = UploadFile(filename="video.webm", file=io.BytesIO())
        with TemporaryDirectory() as directory:
            path = Path(directory) / "video.webm"
            with self.assertRaises(EmptyUploadError):
                stream_upload_to_path(upload, path, max_size=1024)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
