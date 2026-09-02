#!/usr/bin/env python3
"""Course-specific alias layer for Dentistry 391-394 candidate builder.

The official upper grid contains the literal label ``ИОК врача- стоматолога`` in
one block, while the lower reference table carries the full discipline name.
Canonical C08 permits this unambiguous source-local title normalization. The raw
mechanical probe remains untouched; only parser input strings are normalized.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILDER = HERE / "build_dentistry_391_394_candidate.py"

spec = importlib.util.spec_from_file_location("dentistry_391_394_builder", BUILDER)
if spec is None or spec.loader is None:
    raise SystemExit("cannot load dentistry 391-394 builder")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

base_compact = module.compact


def source_compact(value):
    text = base_compact(value)
    aliases = {
        "ИОК врача- стоматолога": "ИОК врача-стоматолога",
    }
    return aliases.get(text, text)


module.compact = source_compact
module.main()
