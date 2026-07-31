#!/usr/bin/env python3
"""Compare the shipped Q8 Lifejacket checkpoint with its pinned FP32 source.

This is a quantization-fidelity and runtime gate, not a claim that the source
checkpoint is semantically perfect. Browser behavior, protected-span safety,
and user-visible fallback are covered separately by the extension suite.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import time
from typing import Any

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "lifejacket-prompts.json"
DEFAULT_SOURCE = ROOT / ".cache" / "lifejacket" / "source" / "onnx" / "model.onnx"
DEFAULT_QUANTIZED = ROOT / "src" / "models" / "lifejacket" / "onnx" / "model_quantized.onnx"
DEFAULT_TOKENIZER = ROOT / "src" / "models" / "lifejacket" / "tokenizer.json"
DEFAULT_JSON_REPORT = ROOT / "dist" / "lifejacket-model-quality.json"
DEFAULT_MARKDOWN_REPORT = ROOT / "dist" / "lifejacket-model-quality.md"
MAX_SEQUENCE_LENGTH = 128
EXPECTED_SOURCE_SHA256 = "caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def softmax_keep_probability(logits: np.ndarray) -> np.ndarray:
    if logits.ndim != 3 or logits.shape[0] != 1 or logits.shape[2] < 2:
        raise ValueError(f"unexpected token-classification logits shape: {logits.shape}")
    pair = logits[0, :, :2].astype(np.float64)
    pair -= pair.max(axis=1, keepdims=True)
    exp = np.exp(pair)
    probabilities = exp / exp.sum(axis=1, keepdims=True)
    return probabilities[:, 1]


def session_inputs(session: ort.InferenceSession, encoding: Any) -> dict[str, np.ndarray]:
    ids = np.asarray([encoding.ids[:MAX_SEQUENCE_LENGTH]], dtype=np.int64)
    attention = np.asarray([encoding.attention_mask[:MAX_SEQUENCE_LENGTH]], dtype=np.int64)
    types = np.asarray([encoding.type_ids[:MAX_SEQUENCE_LENGTH]], dtype=np.int64)
    positions = np.arange(ids.shape[1], dtype=np.int64)[None, :]
    values = {
        "input_ids": ids,
        "attention_mask": attention,
        "token_type_ids": types,
        "position_ids": positions,
    }
    inputs: dict[str, np.ndarray] = {}
    for item in session.get_inputs():
        if item.name not in values:
            raise ValueError(f"unsupported ONNX input {item.name!r}")
        inputs[item.name] = values[item.name]
    return inputs


def infer(session: ort.InferenceSession, inputs: dict[str, np.ndarray]) -> tuple[np.ndarray, float]:
    started = time.perf_counter()
    outputs = session.run(None, inputs)
    duration_ms = (time.perf_counter() - started) * 1000
    if not outputs:
        raise ValueError("ONNX session returned no outputs")
    return np.asarray(outputs[0]), duration_ms


def top_overlap(left: np.ndarray, right: np.ndarray, keep_ratio: float) -> float:
    count = max(1, min(len(left), math.ceil(len(left) * keep_ratio)))
    left_top = set(np.argsort(left)[-count:].tolist())
    right_top = set(np.argsort(right)[-count:].tolist())
    return len(left_top & right_top) / count


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    thresholds = fixture["thresholds"]
    keep_ratio = float(fixture.get("keepRatio", 0.65))
    prompts = fixture["prompts"]

    for path in [args.source, args.quantized, args.tokenizer]:
        if not path.exists() or path.stat().st_size == 0:
            raise FileNotFoundError(f"required model-quality input is missing: {path}")
    source_hash = sha256(args.source)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise ValueError(
            f"FP32 source hash mismatch: expected {EXPECTED_SOURCE_SHA256}, got {source_hash}"
        )

    tokenizer = Tokenizer.from_file(str(args.tokenizer))
    fp32 = ort.InferenceSession(str(args.source), providers=["CPUExecutionProvider"])
    q8 = ort.InferenceSession(str(args.quantized), providers=["CPUExecutionProvider"])

    rows: list[dict[str, Any]] = []
    q8_latencies: list[float] = []
    total_labels = 0
    matching_labels = 0
    probability_errors: list[float] = []
    ranking_overlaps: list[float] = []

    # Warm both runtimes outside the measured corpus.
    warm_encoding = tokenizer.encode("Lifejacket local model warmup.")
    infer(fp32, session_inputs(fp32, warm_encoding))
    infer(q8, session_inputs(q8, warm_encoding))

    for item in prompts:
        encoding = tokenizer.encode(str(item["text"]))
        fp32_logits, _ = infer(fp32, session_inputs(fp32, encoding))
        q8_logits, q8_ms = infer(q8, session_inputs(q8, encoding))
        sequence = min(fp32_logits.shape[1], q8_logits.shape[1], len(encoding.ids), MAX_SEQUENCE_LENGTH)
        if sequence <= 2:
            raise ValueError(f"fixture {item['id']} produced too few tokens")

        # Drop the leading and trailing special-token positions.
        fp32_keep = softmax_keep_probability(fp32_logits[:, :sequence, :])[1:-1]
        q8_keep = softmax_keep_probability(q8_logits[:, :sequence, :])[1:-1]
        fp32_labels = fp32_keep >= 0.5
        q8_labels = q8_keep >= 0.5
        agreements = int(np.equal(fp32_labels, q8_labels).sum())
        label_count = int(fp32_labels.size)
        mae = float(np.abs(fp32_keep - q8_keep).mean())
        overlap = float(top_overlap(fp32_keep, q8_keep, keep_ratio))

        total_labels += label_count
        matching_labels += agreements
        probability_errors.extend(np.abs(fp32_keep - q8_keep).tolist())
        ranking_overlaps.append(overlap)
        q8_latencies.append(q8_ms)
        rows.append(
            {
                "id": item["id"],
                "category": item["category"],
                "tokensCompared": label_count,
                "labelAgreement": agreements / label_count,
                "rankingOverlap": overlap,
                "probabilityMae": mae,
                "q8LatencyMs": q8_ms,
                "unknownTokenCount": int(sum(token == "[UNK]" for token in encoding.tokens)),
            }
        )

    metrics = {
        "labelAgreement": matching_labels / max(1, total_labels),
        "rankingOverlap": statistics.fmean(ranking_overlaps),
        "probabilityMae": statistics.fmean(probability_errors),
        "q8LatencyMedianMs": statistics.median(q8_latencies),
        "q8LatencyP95Ms": percentile(q8_latencies, 0.95),
        "modelBytes": args.quantized.stat().st_size,
        "prompts": len(rows),
        "tokensCompared": total_labels,
    }
    gates = {
        "labelAgreement": metrics["labelAgreement"] >= float(thresholds["minimumLabelAgreement"]),
        "rankingOverlap": metrics["rankingOverlap"] >= float(thresholds["minimumRankingOverlap"]),
        "probabilityMae": metrics["probabilityMae"] <= float(thresholds["maximumProbabilityMae"]),
        "q8LatencyP95Ms": metrics["q8LatencyP95Ms"] <= float(thresholds["maximumP95LatencyMs"]),
        "modelBytes": metrics["modelBytes"] <= int(thresholds["maximumModelBytes"]),
    }
    return {
        "schema": 1,
        "description": "Q8 quantization fidelity against the pinned FP32 Lifejacket checkpoint",
        "source": {
            "path": str(args.source.relative_to(ROOT)),
            "sha256": source_hash,
            "bytes": args.source.stat().st_size,
        },
        "quantized": {
            "path": str(args.quantized.relative_to(ROOT)),
            "sha256": sha256(args.quantized),
            "bytes": args.quantized.stat().st_size,
        },
        "fixture": str(args.fixture.relative_to(ROOT)),
        "thresholds": thresholds,
        "metrics": metrics,
        "gates": gates,
        "passed": all(gates.values()),
        "cases": rows,
    }


def markdown(report: dict[str, Any]) -> str:
    metrics = report["metrics"]
    gates = report["gates"]
    lines = [
        "# Lifejacket model quality report",
        "",
        "> This measures Q8 fidelity to the pinned FP32 checkpoint. It does not treat the source model as ground truth.",
        "",
        f"**Result:** {'PASS' if report['passed'] else 'FAIL'}",
        "",
        "| Gate | Result | Value |",
        "| --- | --- | ---: |",
        f"| Label agreement | {'PASS' if gates['labelAgreement'] else 'FAIL'} | {metrics['labelAgreement']:.4f} |",
        f"| Top-token ranking overlap | {'PASS' if gates['rankingOverlap'] else 'FAIL'} | {metrics['rankingOverlap']:.4f} |",
        f"| Keep-probability MAE | {'PASS' if gates['probabilityMae'] else 'FAIL'} | {metrics['probabilityMae']:.4f} |",
        f"| Q8 p95 latency | {'PASS' if gates['q8LatencyP95Ms'] else 'FAIL'} | {metrics['q8LatencyP95Ms']:.1f} ms |",
        f"| Q8 model size | {'PASS' if gates['modelBytes'] else 'FAIL'} | {metrics['modelBytes']:,} bytes |",
        "",
        "| Case | Category | Agreement | Ranking overlap | MAE | Q8 latency |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for case in report["cases"]:
        lines.append(
            f"| {case['id']} | {case['category']} | {case['labelAgreement']:.4f} | "
            f"{case['rankingOverlap']:.4f} | {case['probabilityMae']:.4f} | {case['q8LatencyMs']:.1f} ms |"
        )
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--quantized", type=Path, default=DEFAULT_QUANTIZED)
    parser.add_argument("--tokenizer", type=Path, default=DEFAULT_TOKENIZER)
    parser.add_argument("--json-report", type=Path, default=DEFAULT_JSON_REPORT)
    parser.add_argument("--markdown-report", type=Path, default=DEFAULT_MARKDOWN_REPORT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = evaluate(args)
    args.json_report.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_report.parent.mkdir(parents=True, exist_ok=True)
    args.json_report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.markdown_report.write_text(markdown(report), encoding="utf-8")
    print(markdown(report))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"error: {error}", file=sys.stderr)
        raise
