#!/usr/bin/env python3
"""Build the pinned local Q8 MobileBERT LLMLingua-2 model for COMPANION."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
import urllib.parse

import onnx
import onnxruntime
from onnxruntime.quantization import QuantType, quantize_dynamic

ROOT = Path(__file__).resolve().parents[1]
CACHE_ROOT = ROOT / ".cache" / "lifejacket" / "source"
OUTPUT_ROOT = ROOT / "src" / "models" / "lifejacket"
SOURCE_REPOSITORY = "atjsh/llmlingua-2-js-mobilebert-meetingbank"
SOURCE_REVISION = "900ed52628d7b153a276a220483d26d5f8dfe0f7"
SOURCE_ONNX_PATH = "onnx/model.onnx"
SOURCE_ONNX_BYTES = 99170493
SOURCE_ONNX_SHA256 = "caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07"
MODEL_FILES = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.txt",
)
OUTPUT_MODEL = OUTPUT_ROOT / "onnx" / "model_quantized.onnx"
# The pinned MobileBERT checkpoint measures 39,411,097 bytes after stable
# per-channel QInt8 MatMul/Gemm quantization. A 40 MiB ceiling leaves less than
# 6.5% slack while still failing a silent regression back toward FP32 size.
MAX_OUTPUT_BYTES = 40 * 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(relative_path: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded_path = "/".join(urllib.parse.quote(part, safe="") for part in relative_path.split("/"))
    url = (
        f"https://huggingface.co/{SOURCE_REPOSITORY}/resolve/"
        f"{SOURCE_REVISION}/{encoded_path}?download=true"
    )
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "COMPANION-Lifejacket-build/1.3.0"},
    )
    last_error: Exception | None = None
    for attempt in range(4):
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            temporary.replace(destination)
            return
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            last_error = error
            temporary.unlink(missing_ok=True)
            if attempt < 3:
                time.sleep(2**attempt)
    raise RuntimeError(f"Failed to download {relative_path}: {last_error}")


def ensure_source(relative_path: str) -> Path:
    destination = CACHE_ROOT / relative_path
    if not destination.exists() or destination.stat().st_size == 0:
        download(relative_path, destination)
    return destination


def verify_source_model(path: Path) -> None:
    actual_bytes = path.stat().st_size
    actual_hash = sha256(path)
    if actual_bytes != SOURCE_ONNX_BYTES:
        raise RuntimeError(f"Source ONNX size mismatch: expected {SOURCE_ONNX_BYTES}, got {actual_bytes}")
    if actual_hash != SOURCE_ONNX_SHA256:
        raise RuntimeError(f"Source ONNX SHA-256 mismatch: expected {SOURCE_ONNX_SHA256}, got {actual_hash}")


def deterministic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    source_model = ensure_source(SOURCE_ONNX_PATH)
    verify_source_model(source_model)
    source_metadata = {relative: ensure_source(relative) for relative in MODEL_FILES}

    preserved_gitkeep = OUTPUT_ROOT / ".gitkeep"
    if OUTPUT_ROOT.exists():
        for entry in OUTPUT_ROOT.iterdir():
            if entry == preserved_gitkeep:
                continue
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    OUTPUT_MODEL.parent.mkdir(parents=True, exist_ok=True)

    for relative, source in source_metadata.items():
        destination = OUTPUT_ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        os.chmod(destination, 0o644)

    with tempfile.TemporaryDirectory(prefix="companion-lifejacket-") as temporary_directory:
        temporary_output = Path(temporary_directory) / "model_quantized.onnx"
        quantize_dynamic(
            model_input=str(source_model),
            model_output=str(temporary_output),
            per_channel=True,
            reduce_range=False,
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["MatMul", "Gemm"],
            extra_options={"MatMulConstBOnly": True},
        )
        onnx.checker.check_model(str(temporary_output), full_check=False)
        if temporary_output.stat().st_size >= MAX_OUTPUT_BYTES:
            raise RuntimeError(
                f"Quantized model exceeds {MAX_OUTPUT_BYTES} bytes: {temporary_output.stat().st_size}"
            )
        shutil.copyfile(temporary_output, OUTPUT_MODEL)
        os.chmod(OUTPUT_MODEL, 0o644)

    output_hash = sha256(OUTPUT_MODEL)
    provenance = {
        "schema": 1,
        "model": {
            "architecture": "MobileBERTForTokenClassification",
            "compression_method": "LLMLingua-2 extractive token classification",
            "dtype": "q8",
            "runtime": "Transformers.js 4.2.0 / ONNX Runtime Web",
        },
        "source": {
            "repository": SOURCE_REPOSITORY,
            "revision": SOURCE_REVISION,
            "onnx": {
                "path": SOURCE_ONNX_PATH,
                "bytes": SOURCE_ONNX_BYTES,
                "sha256": SOURCE_ONNX_SHA256,
            },
        },
        "build": {
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
            "quantization": {
                "kind": "dynamic",
                "per_channel": True,
                "weight_type": "QInt8",
                "operators": ["MatMul", "Gemm"],
            },
        },
        "output": {
            "onnx": {
                "path": "onnx/model_quantized.onnx",
                "bytes": OUTPUT_MODEL.stat().st_size,
                "sha256": output_hash,
            }
        },
    }
    deterministic_json(OUTPUT_ROOT / "provenance.json", provenance)

    checksum_targets = [
        path
        for path in OUTPUT_ROOT.rglob("*")
        if path.is_file() and path.name not in {".gitkeep", "SHA256SUMS"}
    ]
    checksum_targets.sort(key=lambda path: path.relative_to(OUTPUT_ROOT).as_posix())
    sums = "".join(
        f"{sha256(path)}  {path.relative_to(OUTPUT_ROOT).as_posix()}\n"
        for path in checksum_targets
    )
    (OUTPUT_ROOT / "SHA256SUMS").write_text(sums, encoding="utf-8")
    print(
        f"Built {OUTPUT_MODEL.relative_to(ROOT)}: "
        f"{OUTPUT_MODEL.stat().st_size} bytes, sha256={output_hash}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI must surface a concise fatal error
        print(f"error: {error}", file=sys.stderr)
        raise
