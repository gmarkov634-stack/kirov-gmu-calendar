#!/usr/bin/env python3
"""Course-specific normalization layer for Dentistry 391-394.

The official upper grid contains the literal label ``ИОК врача- стоматолога`` in
one block, while the lower reference table carries the full discipline name.
Canonical C08 permits this unambiguous source-local title normalization.

The base builder intentionally remains fail-closed under C20. After it records
that intermediate evidence, a separate source-SHA-specific manual resolution
layer applies only the explicitly confirmed exceptional-day semantics for the
current official XLSX. The raw mechanical probe and canonical C20/C21 rules are
not modified.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILDER = HERE / "build_dentistry_391_394_candidate.py"
RESOLVER = HERE / "resolve_dentistry_391_394_manual_review.py"

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

resolver_spec = importlib.util.spec_from_file_location("dentistry_391_394_resolver", RESOLVER)
if resolver_spec is None or resolver_spec.loader is None:
    raise SystemExit("cannot load dentistry 391-394 manual resolver")
resolver = importlib.util.module_from_spec(resolver_spec)
resolver_spec.loader.exec_module(resolver)
resolver.resolve(module)
