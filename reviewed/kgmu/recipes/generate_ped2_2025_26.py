from pathlib import Path

# Loader for the manually reviewed pediatrics course 2 bundle (rules through R74).
parts_dir = Path(__file__).with_name("ped2_2025_26_parts")
parts = sorted(parts_dir.glob("part*.txt"))
if not parts:
    raise SystemExit("No recipe parts found")
source = "".join(path.read_text(encoding="utf-8") for path in parts)
exec(compile(source, str(Path(__file__)), "exec"))
