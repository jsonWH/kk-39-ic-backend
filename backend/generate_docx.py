"""
Python wrapper that calls the Node.js docx generator.
Writes data to a temp JSON file, runs the Node script, returns the docx path.
"""
import json, subprocess, os, tempfile, shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

def generate_docx(data: dict, output_path: str) -> str:
    """Generate a docx from data dict. Returns output_path."""
    tmp_json = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
    json.dump(data, tmp_json)
    tmp_json.close()

    tmp_out = output_path + ".tmp.docx"

    # Patch the Node script to use dynamic paths from env vars
    result = subprocess.run(
        ["node", str(SCRIPT_DIR / "generate_docx_cli.js")],
        env={
            **os.environ,
            "IC_DATA_PATH": tmp_json.name,
            "IC_OUTPUT_PATH": tmp_out,
        },
        capture_output=True, text=True
    )
    os.unlink(tmp_json.name)

    if result.returncode != 0:
        raise RuntimeError(f"docx generation failed: {result.stderr}")

    shutil.move(tmp_out, output_path)
    return output_path
