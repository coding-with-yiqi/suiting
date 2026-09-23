"""Offline release checks; no app imports, network, models, or user data."""

import ast
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def load_function(path, name, **namespace):
    tree = ast.parse(source(path))
    function = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    )
    future = ast.ImportFrom(
        module="__future__", names=[ast.alias(name="annotations")], level=0,
    )
    module = ast.fix_missing_locations(
        ast.Module(body=[future, function], type_ignores=[])
    )
    exec(compile(module, str(ROOT / path), "exec"), namespace)
    return namespace[name]


class SuitingReleaseContractTest(unittest.TestCase):
    def test_upstream_service_is_disabled_and_cached(self):
        factory = Mock()
        get_service = load_function(
            "backend/app/services/update_service.py", "get_update_service",
            _service=None, UpdateService=factory,
        )
        self.assertIs(get_service(), get_service())
        factory.assert_called_once_with(enabled=False)

    def test_startup_does_not_schedule_an_upstream_check(self):
        start = load_function(
            "backend/app/routers/updates.py", "start_background_check",
        )
        # No task scheduler or update service is supplied: either use fails.
        self.assertIsNone(start())

    def test_old_apply_marker_cannot_launch_an_updater(self):
        helper = Mock(side_effect=AssertionError("upstream updater launched"))
        launch = load_function(
            "desktop/launcher.py", "_launch_requested_update",
            _launch_update_helper=helper,
        )
        self.assertEqual(launch(True, Path("unused"), Mock()), 0)
        self.assertEqual(launch(False, Path("unused"), Mock()), 0)
        helper.assert_not_called()

    def test_packaged_interactive_launch_disables_update_apply(self):
        environment = {}
        configure = load_function(
            "desktop/launcher.py", "_configure_update_environment",
            os=SimpleNamespace(environ=environment),
            sys=SimpleNamespace(frozen=True),
            install_root=lambda: Path("bundle"),
            resource=lambda name: Path("bundle") / name,
            updater_path=lambda root: root / "unused-updater",
            LOOPBACK_HOST="127.0.0.1",
        )
        configure("test-instance", headless=False)
        self.assertEqual(environment["BACKCHANNEL_UPDATE_APPLY_DISABLED"], "1")

    def test_tray_opens_own_release_page_without_an_update_watcher(self):
        pystray = Mock()
        pystray.Menu.side_effect = lambda *items: items
        pystray.MenuItem.side_effect = lambda label, action: (label, action)
        browser = Mock()
        forbidden_thread = Mock(side_effect=AssertionError("update watcher started"))
        run_tray = load_function(
            "desktop/launcher.py", "_run_tray",
            _tray_image=Mock(), BROWSER_HOST="localhost", webbrowser=browser,
            threading=SimpleNamespace(Thread=forbidden_thread, Event=Mock()),
        )
        with patch.dict(sys.modules, {"pystray": pystray}):
            self.assertFalse(run_tray(8474, Path("unused"), "test-instance"))
        forbidden_thread.assert_not_called()
        menu = pystray.Icon.call_args.kwargs["menu"]
        releases = [action for label, action in menu if label == "随听下载与更新"]
        self.assertEqual(len(releases), 1)
        releases[0](None, None)
        browser.open.assert_called_once_with(
            "https://github.com/coding-with-yiqi/suiting/releases"
        )

    def test_reverse_proxy_preserves_host_port_for_review_origin_check(self):
        nginx = source("frontend/nginx.conf")
        for route in ("/api/", "/ws/"):
            with self.subTest(route=route):
                block = re.search(
                    r"location\s+" + re.escape(route) + r"\s*\{([^}]+)\}",
                    nginx,
                )
                self.assertIsNotNone(block)
                hosts = re.findall(r"proxy_set_header\s+Host\s+([^;]+);", block[1])
                self.assertEqual(hosts, ["$http_host"])

    def test_docker_defaults_are_lightweight_and_local_only(self):
        compose = source("docker-compose.yml")
        defaults = re.findall(
            r"INSTALL_SORTFORMER:\s*\$\{INSTALL_SORTFORMER:-([^}]+)\}", compose,
        )
        self.assertEqual(defaults, ["false", "false"])
        self.assertRegex(source("backend/Dockerfile"), r"(?m)^ARG INSTALL_SORTFORMER=false$")
        mappings = re.findall(r'^\s+-\s+"([^"\n]+:\d+)"\s*$', compose, re.MULTILINE)
        self.assertEqual(len(mappings), 3)
        for mapping in mappings:
            self.assertRegex(mapping, r"^127\.0\.0\.1:\d+:\d+$")

    def test_diarizer_models_have_matching_download_and_bundle_locations(self):
        diarizer = ast.parse(source("backend/app/services/speaker_diarizer.py"))
        assignments = {
            node.targets[0].id: node.value
            for node in diarizer.body
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
        }
        self.assertEqual(assignments["MODELS_DIR"].func.id, "_models_dir")
        model_dir = load_function(
            "backend/app/services/speaker_diarizer.py", "_models_dir",
            Path=Path, sys=SimpleNamespace(_MEIPASS="/bundle/Frameworks"),
        )
        self.assertEqual(Path(model_dir()), Path("/bundle/Frameworks/models"))
        preferred = ast.literal_eval(assignments["EMBED_MODEL_FILENAME"])
        downloads = ast.parse(source("backend/scripts/download_models.py"))
        model_urls = next(
            ast.literal_eval(node.value) for node in downloads.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "MODELS" for target in node.targets)
        )
        self.assertIn(preferred, model_urls)
        self.assertIn("silero_vad.onnx", model_urls)
        spec = source("desktop/backchannel.spec")
        self.assertIn('(str(repo / "backend" / "models"), "models")', spec)
        self.assertIn('collect_data_files(_package)', spec)
        self.assertIn('("onnx_asr",)', spec)

    def test_upstream_mit_notice_is_preserved(self):
        license_text = source("LICENSE")
        self.assertIn("MIT License", license_text)
        self.assertIn("Copyright (c) 2026 Talbert Houle", license_text)
        self.assertIn("Permission is hereby granted, free of charge", license_text)
        self.assertIn("The above copyright notice and this permission notice", license_text)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', license_text)


if __name__ == "__main__":
    unittest.main()
