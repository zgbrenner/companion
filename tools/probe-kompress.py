from __future__ import annotations

import hashlib
import json
import pathlib
import shutil

import numpy as np
import onnx
import onnxruntime as ort
from huggingface_hub import HfApi, snapshot_download
from onnxruntime.quantization import QuantType, quantize_dynamic
from optimum.exporters.onnx import main_export
from transformers import AutoTokenizer

REPO = "chopratejas/kompress-small"
REVISION = "eacbdc589d039a1a39f76a92844979ad4e266bcd"
SOURCE = pathlib.Path("probe-source")
ROOT = pathlib.Path("probe-model")


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


for directory in (SOURCE, ROOT):
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)

snapshot_download(
    repo_id=REPO,
    revision=REVISION,
    local_dir=SOURCE,
    allow_patterns=["*.json", "*.txt", "*.model", "*.safetensors"],
)

config_path = SOURCE / "config.json"
config = json.loads(config_path.read_text(encoding="utf-8"))
if config.get("architectures") != ["ModernBertForTokenClassification"]:
    raise SystemExit(f"unexpected architecture: {config.get('architectures')}")
if config.get("model_type") not in (None, "modernbert"):
    raise SystemExit(f"unexpected model_type: {config.get('model_type')}")
config["model_type"] = "modernbert"
config_path.write_text(json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8")

main_export(
    model_name_or_path=str(SOURCE),
    output=ROOT,
    task="token-classification",
    device="cpu",
    dtype="fp32",
    framework="pt",
    monolith=True,
    no_post_process=True,
    do_validation=True,
    trust_remote_code=False,
    library_name="transformers",
    opset=18,
)

for name in (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.txt",
    "merges.txt",
):
    source = SOURCE / name
    destination = ROOT / name
    if source.exists() and not destination.exists():
        shutil.copy2(source, destination)

candidates = [path for path in ROOT.rglob("*.onnx") if "quant" not in path.name]
if len(candidates) != 1:
    raise SystemExit(f"expected one exported ONNX graph, found: {candidates}")
source_onnx = candidates[0]
onnx_dir = ROOT / "onnx"
onnx_dir.mkdir(exist_ok=True)
target = onnx_dir / "model_quantized.onnx"

quantize_dynamic(
    model_input=str(source_onnx),
    model_output=str(target),
    per_channel=True,
    reduce_range=False,
    weight_type=QuantType.QInt8,
    use_external_data_format=False,
    extra_options={"WeightSymmetric": True},
)

for path in candidates:
    path.unlink(missing_ok=True)
for path in ROOT.rglob("*.onnx_data"):
    path.unlink(missing_ok=True)
for path in ROOT.rglob("*.onnx.data"):
    path.unlink(missing_ok=True)

graph = onnx.load(str(target), load_external_data=True)
onnx.checker.check_model(graph)
session = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
tokenizer = AutoTokenizer.from_pretrained(str(ROOT), local_files_only=True)
sample = (
    "Please summarize the project plan while preserving Alice, Bob, invoice 42, "
    "the June 15 deadline, and every required caveat, but remove repeated polite filler."
)
encoded = tokenizer(sample, return_tensors="np")
feeds = {
    item.name: encoded[item.name].astype(np.int64)
    for item in session.get_inputs()
    if item.name in encoded
}
outputs = session.run(None, feeds)
shapes = [list(np.asarray(value).shape) for value in outputs]
if not outputs or np.asarray(outputs[0]).shape[-1] != 2:
    raise SystemExit(f"unexpected logits shape: {shapes}")

info = HfApi().model_info(REPO, revision=REVISION, files_metadata=True)
license_name = (info.card_data or {}).get("license") if info.card_data else None
if license_name != "apache-2.0":
    raise SystemExit(f"unexpected model license: {license_name}")

report = {
    "repo": REPO,
    "revision": REVISION,
    "license": license_name,
    "pipeline_tag": info.pipeline_tag,
    "config_patch": {"model_type": "modernbert"},
    "quantized": {
        "path": str(target),
        "size": target.stat().st_size,
        "sha256": sha256(target),
    },
    "graph": {
        "inputs": [item.name for item in session.get_inputs()],
        "outputs": [item.name for item in session.get_outputs()],
        "opset": max((item.version for item in graph.opset_import), default=None),
        "output_shapes": shapes,
    },
    "files": [
        {
            "path": str(path.relative_to(ROOT)),
            "size": path.stat().st_size,
            "sha256": sha256(path),
        }
        for path in sorted(ROOT.rglob("*"))
        if path.is_file()
    ],
}
pathlib.Path("kompress-probe.json").write_text(
    json.dumps(report, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(report, indent=2))
