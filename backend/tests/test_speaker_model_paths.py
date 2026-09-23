"""Exercise model lookup without importing ONNX or loading speech models."""

import ast
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "app/services/speaker_diarizer.py"


def models_dir(module_file: Path, bundle_root: Path | None = None) -> Path:
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    function = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_models_dir"
    )
    namespace = {
        "Path": Path,
        "sys": SimpleNamespace(**({"_MEIPASS": str(bundle_root)} if bundle_root else {})),
        "__file__": str(module_file),
    }
    module = ast.Module(body=[function], type_ignores=[])
    exec(compile(module, str(SOURCE), "exec"), namespace)
    return Path(namespace["_models_dir"]())


class SpeakerModelPathsTest(unittest.TestCase):
    def test_source_checkout_uses_backend_models(self):
        self.assertEqual(models_dir(SOURCE), SOURCE.resolve().parents[2] / "models")

    def test_frozen_bundle_needs_no_physical_python_package_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            bundle_root = Path(temporary) / "Frameworks"
            model_file = bundle_root / "models/silero_vad.onnx"
            model_file.parent.mkdir(parents=True)
            model_file.write_bytes(b"model-path-fixture")
            virtual_source = bundle_root / "app/services/speaker_diarizer.py"
            self.assertFalse(virtual_source.parent.exists())
            located = models_dir(virtual_source, bundle_root) / model_file.name
            self.assertEqual(located.read_bytes(), b"model-path-fixture")

    def test_source_symlink_resolves_to_real_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            link = Path(temporary) / "speaker_diarizer.py"
            link.symlink_to(SOURCE)
            self.assertEqual(models_dir(link), SOURCE.resolve().parents[2] / "models")


if __name__ == "__main__":
    unittest.main()
