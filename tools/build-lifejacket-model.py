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
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic

ROOT = Path(__file__).resolve().parents[1]
EXTENSION_VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
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
# The pinned MobileBERT checkpoint remains below the 40 MiB ceiling after
# per-channel QUInt8 quantization and selective FP16 preservation. The final
# encoder layer, classifier, and layer-22 bottleneck output are sensitive to
# dynamic integer quantization; preserving their weights avoids collapsed or
# language-dependent logits without shipping the full FP32 checkpoint.
MAX_OUTPUT_BYTES = 40 * 1024 * 1024


def quantization_exclusions(model: onnx.ModelProto) -> list[str]:
    """Return the model nodes that must retain high-fidelity weights."""

    excluded = [
        node.name
        for node in model.graph.node
        if node.op_type == "MatMul"
        and (
            node.name.startswith("/mobilebert/encoder/layer.23/")
            or node.name
            in {
                "/mobilebert/encoder/layer.22/output/bottleneck/dense/MatMul",
                "/classifier/MatMul",
            }
        )
    ]
    required = {
        "/mobilebert/encoder/layer.22/output/bottleneck/dense/MatMul",
        "/classifier/MatMul",
    }
    if not required.issubset(excluded) or not any(
        name.startswith("/mobilebert/encoder/layer.23/") for name in excluded
    ):
        raise RuntimeError("pinned MobileBERT graph is missing expected sensitive MatMul nodes")
    return sorted(excluded)


def preserve_sensitive_weights_as_fp16(
    model: onnx.ModelProto, excluded_nodes: list[str]
) -> list[str]:
    """Store excluded weights as FP16 and cast them back to FP32 at runtime.

    The cast keeps the surrounding graph in FP32, which is important for the
    quantized MobileBERT graph and for ONNX Runtime Web compatibility. The
    lower-precision initializer halves the storage cost of the intentionally
    unquantized weights while introducing only FP16 rounding error.
    """

    original_nodes = list(model.graph.node)
    target_nodes = [
        node
        for node in original_nodes
        if node.name in excluded_nodes and node.op_type == "MatMul" and len(node.input) > 1
    ]
    target_weights = {node.input[1] for node in target_nodes}
    replaced_weights: list[str] = []
    cast_nodes: list[onnx.NodeProto] = []
    new_initializers: list[onnx.TensorProto] = []

    for initializer in model.graph.initializer:
        if initializer.name not in target_weights or initializer.data_type != TensorProto.FLOAT:
            new_initializers.append(initializer)
            continue

        fp16_initializer = numpy_helper.from_array(
            numpy_helper.to_array(initializer).astype("float16"),
            name=initializer.name,
        )
        new_initializers.append(fp16_initializer)
        cast_output = f"companion_sensitive_weight_{len(cast_nodes)}_fp32"
        cast_nodes.append(
            helper.make_node(
                "Cast",
                [initializer.name],
                [cast_output],
                name=f"CompanionSensitiveWeightCast_{len(cast_nodes)}",
                to=TensorProto.FLOAT,
            )
        )
        for node in target_nodes:
            for input_index, input_name in enumerate(node.input):
                if input_name == initializer.name:
                    node.input[input_index] = cast_output
        replaced_weights.append(initializer.name)

    if not replaced_weights:
        raise RuntimeError("no sensitive FP32 weights were found to preserve")

    model.graph.ClearField("initializer")
    model.graph.initializer.extend(new_initializers)
    model.graph.ClearField("node")
    model.graph.node.extend(cast_nodes + original_nodes)
    return replaced_weights


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
        headers={"User-Agent": f"COMPANION-Lifejacket-build/{EXTENSION_VERSION}"},
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
        excluded_nodes = quantization_exclusions(onnx.load(str(source_model), load_external_data=True))
        quantize_dynamic(
            model_input=str(source_model),
            model_output=str(temporary_output),
            per_channel=True,
            reduce_range=False,
            weight_type=QuantType.QUInt8,
            op_types_to_quantize=["MatMul", "Gemm"],
            nodes_to_exclude=excluded_nodes,
            extra_options={"MatMulConstBOnly": True},
        )
        quantized_model = onnx.load(str(temporary_output), load_external_data=True)
        preserved_weights = preserve_sensitive_weights_as_fp16(quantized_model, excluded_nodes)
        onnx.checker.check_model(quantized_model, full_check=False)
        onnx.save(quantized_model, str(temporary_output))
        if temporary_output.stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeError(
                f"Quantized model exceeds {MAX_OUTPUT_BYTES} bytes: {temporary_output.stat().st_size}"
            )
        shutil.copyfile(temporary_output, OUTPUT_MODEL)
        os.chmod(OUTPUT_MODEL, 0o644)

    output_hash = sha256(OUTPUT_MODEL)
    model_file_hashes = {
        relative: {
            "bytes": (OUTPUT_ROOT / relative).stat().st_size,
            "sha256": sha256(OUTPUT_ROOT / relative),
        }
        for relative in MODEL_FILES
    }
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
        "model_files": model_file_hashes,
        "build": {
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
            "quantization": {
                "kind": "dynamic",
                "per_channel": True,
                "reduce_range": False,
                "weight_type": "QUInt8",
                "operators": ["MatMul", "Gemm"],
                "excluded_nodes": excluded_nodes,
                "fp16_weight_casts": preserved_weights,
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
