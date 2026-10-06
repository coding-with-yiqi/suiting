"""Offline checks for reviewed multi-group delivery; never call GeWe."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
try:
    import httpx
except ImportError:
    httpx = types.ModuleType("httpx")
    httpx.HTTPError = type("HTTPError", (Exception,), {})
    sys.modules["httpx"] = httpx
spec = importlib.util.spec_from_file_location("reviewed_gewe", ROOT / "app/services/gewe.py")
gewe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gewe)


class DeliveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = patch.object(gewe, "DATA_DIR", Path(self.temp.name))
        self.directory.start()
        self.addCleanup(self.directory.stop)
        gewe.SEND_LOCK = asyncio.Lock()
        gewe._write(gewe.DATA_DIR / "gewe.json", {"base_url": "https://example.invalid", "token": "test-only-secret", "app_id": "device-1"})
        gewe._write(gewe.DATA_DIR / "gewe-groups.json", {"app_id": "device-1", "groups": [{"id": "a@chatroom", "name": "测试群甲"}, {"id": "b@chatroom", "name": "测试群乙"}]})

    async def test_reading_review_does_not_send_or_expose_credentials(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock) as post:
            result = gewe.review("question", "文案")
        post.assert_not_awaited()
        self.assertTrue(result["configured"])
        self.assertNotIn("test-only-secret", json.dumps(result))
        self.assertEqual([], result["default_targets"])

    async def test_default_targets_are_local_and_scoped_to_the_connected_account(self):
        saved = gewe.save_default_targets(["a@chatroom", "filehelper", "a@chatroom"])
        self.assertEqual(["a@chatroom", "filehelper"], saved)
        self.assertEqual(
            ["a@chatroom", "filehelper"],
            gewe.review("question", "文案")["default_targets"],
        )
        gewe._write(
            gewe.DATA_DIR / "gewe.json",
            {"base_url": "https://example.invalid", "token": "other", "app_id": "other-device"},
        )
        self.assertEqual([], gewe.review("question", "文案")["default_targets"])

    async def test_default_targets_can_be_cleared_without_network_access(self):
        gewe.save_default_targets(["a@chatroom"])
        with patch.object(gewe, "_post", new_callable=AsyncMock) as post:
            self.assertEqual([], gewe.clear_default_targets())
        post.assert_not_awaited()
        self.assertEqual([], gewe.review("question", "文案")["default_targets"])

    async def test_sending_a_reviewed_selection_remembers_it_without_an_extra_network_call(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}]) as post:
            await gewe.send_reviewed("question", "正文", ["b@chatroom"])
        self.assertEqual(["b@chatroom"], gewe.review("question", "正文")["default_targets"])
        self.assertEqual(2, post.await_count)

    async def test_one_off_send_does_not_replace_an_explicit_default(self):
        gewe.save_default_targets(["a@chatroom"])
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}]):
            await gewe.send_reviewed("question", "正文", ["b@chatroom"])
        self.assertEqual(["a@chatroom"], gewe.review("question", "正文")["default_targets"])

    async def test_cleared_default_stays_cleared_after_a_one_off_send(self):
        gewe.save_default_targets(["a@chatroom"])
        gewe.clear_default_targets()
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}]):
            await gewe.send_reviewed("question", "正文", ["b@chatroom"])
        self.assertEqual([], gewe.review("question", "正文")["default_targets"])

    async def test_partial_failure_retries_only_failed_group(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {"newMsgId": "18446744073709551615"}, gewe.GeweError("请求未接受")]) as post:
            result = await gewe.send_reviewed("question", "审核后的正文", ["a@chatroom", "b@chatroom"])
        self.assertEqual(result["a@chatroom"]["state"], "sent")
        self.assertEqual(result["b@chatroom"]["state"], "failed")
        self.assertEqual(post.await_count, 3)
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}]) as retry:
            result = await gewe.send_reviewed("question", "审核后的正文", ["a@chatroom", "b@chatroom"])
        self.assertEqual(retry.await_count, 2)
        self.assertEqual(retry.await_args_list[-1].args[2]["toWxid"], "b@chatroom")
        self.assertEqual(result["a@chatroom"]["message_id"], "18446744073709551615")

    async def test_unknown_and_interrupted_sends_are_not_retried(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, gewe.GeweError("结果未知", uncertain=True)]):
            result = await gewe.send_reviewed("question", "正文", ["a@chatroom"])
        self.assertEqual(result["a@chatroom"]["state"], "unknown")
        config = gewe._config()
        saved = gewe._read(gewe._receipt_path("question"), {})
        saved[gewe._version(config, "正文")]["b@chatroom"] = {"state": "pending", "name": "测试群乙"}
        gewe._write(gewe._receipt_path("question"), saved)
        with patch.object(gewe, "_post", new_callable=AsyncMock) as post:
            await gewe.send_reviewed("question", "正文", ["a@chatroom", "b@chatroom"])
        post.assert_not_awaited()

    async def test_concurrent_double_click_sends_once(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}]) as post:
            await asyncio.gather(*(gewe.send_reviewed("question", "正文", ["a@chatroom"]) for _ in range(2)))
        self.assertEqual(post.await_count, 2)

    async def test_unknown_target_and_offline_block_send(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, return_value=False) as post:
            with self.assertRaises(gewe.GeweError):
                await gewe.send_reviewed("question", "正文", ["not-allowed@chatroom"])
            post.assert_not_awaited()
            with self.assertRaises(gewe.GeweError):
                await gewe.send_reviewed("question", "正文", ["a@chatroom"])
            self.assertEqual(post.await_count, 1)

    async def test_changed_text_is_a_new_review_and_message(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}, True, {}]) as post:
            await gewe.send_reviewed("question", "第一版", ["a@chatroom"])
            self.assertEqual(gewe.review("question", "第二版")["receipts"], {})
            await gewe.send_reviewed("question", "第二版", ["a@chatroom"])
        self.assertEqual(post.await_count, 4)

    async def test_group_refresh_does_not_send_messages(self):
        with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[{"friends": ["private-person"], "chatrooms": ["a@chatroom"]}, [{"userName": "a@chatroom", "nickName": "新的群名"}]]) as post:
            targets = await gewe.refresh_groups()
        self.assertEqual(targets[-1]["name"], "新的群名")
        self.assertTrue(all(call.args[1].startswith("contacts/") for call in post.await_args_list))
        self.assertNotIn("private-person", (gewe.DATA_DIR / "gewe-groups.json").read_text())

    async def test_cache_from_another_account_is_not_selectable(self):
        gewe._write(gewe.DATA_DIR / "gewe-groups.json", {"app_id": "another-device", "groups": [{"id": "a@chatroom", "name": "旧账号的群"}]})
        with patch.object(gewe, "_post", new_callable=AsyncMock) as post:
            with self.assertRaises(gewe.GeweError):
                await gewe.send_reviewed("question", "正文", ["a@chatroom"])
        post.assert_not_awaited()

    async def test_legacy_receipts_and_group_cache_stay_with_legacy_config(self):
        current = Path(self.temp.name) / "wechat"
        with patch.object(gewe, "DATA_DIR", current), patch.object(gewe.sys, "platform", "darwin"), patch.dict(gewe.os.environ, {"DATA_DIR": self.temp.name}, clear=True):
            self.assertTrue(gewe.review("question", "正文")["configured"])
            with patch.object(gewe, "_post", new_callable=AsyncMock, side_effect=[True, {}]) as post:
                await gewe.send_reviewed("question", "正文", ["a@chatroom"])
                await gewe.send_reviewed("question", "正文", ["a@chatroom"])
            self.assertEqual(post.await_count, 2)
            self.assertTrue((Path(self.temp.name) / "gewe-receipts/question.json").exists())
            self.assertFalse(current.exists())


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.environ = patch.dict(gewe.os.environ, {"HOME": str(self.home)}, clear=True)
        self.environ.start()
        self.addCleanup(self.environ.stop)
        self.home_patch = patch.object(gewe.Path, "home", return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)

    def test_explicit_wechat_directory_wins_over_application_directory(self):
        with patch.dict(gewe.os.environ, {"SUITING_WECHAT_DIR": "~/private-wechat", "DATA_DIR": "/another-app"}):
            self.assertEqual(gewe.default_directory(), self.home / "private-wechat")

    def test_application_directory_uses_wechat_subdirectory(self):
        with patch.dict(gewe.os.environ, {"DATA_DIR": str(self.home / "app")}):
            self.assertEqual(gewe.default_directory(), self.home / "app/wechat")

    def test_packaged_desktop_finds_the_same_default_as_standalone_setup(self):
        with patch.object(gewe.sys, "platform", "darwin"):
            setup_directory = gewe.default_directory()
            gewe._write(setup_directory / "gewe.json", {"base_url": "https://example.invalid", "token": "test-token", "app_id": "test-device"})
            with patch.dict(gewe.os.environ, {"BACKCHANNEL_DESKTOP": "1", "DATA_DIR": str(self.home / "Library/Application Support/Backchannel/data")}):
                self.assertEqual(gewe.default_directory(), setup_directory)
                with patch.object(gewe, "DATA_DIR", gewe.default_directory()):
                    self.assertEqual(gewe._config()["_directory"], setup_directory)

    def test_packaged_desktop_explicit_override_and_frozen_detection(self):
        with patch.object(gewe.sys, "platform", "darwin"), patch.object(gewe.sys, "frozen", True, create=True), patch.dict(gewe.os.environ, {"DATA_DIR": str(self.home / "app/data")}):
            self.assertEqual(gewe.default_directory(), self.home / "Library/Application Support/Suiting/wechat")
            with patch.dict(gewe.os.environ, {"SUITING_WECHAT_DIR": str(self.home / "chosen")}):
                self.assertEqual(gewe.default_directory(), self.home / "chosen")

    def test_mac_launcher_data_subdirectory_keeps_old_root_configuration(self):
        legacy = self.home / "Library/Application Support/Backchannel"
        gewe._write(legacy / "gewe.json", {"base_url": "https://example.invalid", "token": "test-token", "app_id": "test-device"})
        with patch.object(gewe.sys, "platform", "darwin"), patch.dict(gewe.os.environ, {"BACKCHANNEL_DESKTOP": "1", "DATA_DIR": str(legacy / "data")}):
            with patch.object(gewe, "DATA_DIR", gewe.default_directory()):
                config = gewe._config()
                self.assertEqual(config["_directory"], legacy)
                self.assertEqual(gewe._receipt_path("question", config), legacy / "gewe-receipts/question.json")
                self.assertFalse((legacy / "data").exists())

    def test_packaged_mac_preserves_an_existing_data_wechat_configuration(self):
        application_data = self.home / "custom-app/data"
        gewe._write(application_data / "wechat/gewe.json", {"base_url": "https://example.invalid", "token": "test-token", "app_id": "test-device"})
        with patch.object(gewe.sys, "platform", "darwin"), patch.dict(gewe.os.environ, {"BACKCHANNEL_DESKTOP": "1", "DATA_DIR": str(application_data)}):
            with patch.object(gewe, "DATA_DIR", gewe.default_directory()):
                self.assertEqual(gewe._config()["_directory"], application_data / "wechat")

    def test_platform_defaults_and_user_overrides(self):
        for platform, suffix in [("darwin", "Library/Application Support/Suiting/wechat"), ("win32", "AppData/Local/Suiting/wechat"), ("linux", ".local/share/suiting/wechat")]:
            with self.subTest(platform=platform), patch.object(gewe.sys, "platform", platform):
                self.assertEqual(gewe.default_directory(), self.home / suffix)
        with patch.object(gewe.sys, "platform", "win32"), patch.dict(gewe.os.environ, {"LOCALAPPDATA": str(self.home / "windows-data")}):
            self.assertEqual(gewe.default_directory(), self.home / "windows-data/Suiting/wechat")
        with patch.object(gewe.sys, "platform", "linux"), patch.dict(gewe.os.environ, {"XDG_DATA_HOME": str(self.home / "linux-data")}):
            self.assertEqual(gewe.default_directory(), self.home / "linux-data/suiting/wechat")

    def test_mac_legacy_config_is_used_only_if_new_file_is_absent(self):
        current = self.home / "Library/Application Support/Suiting/wechat"
        legacy = self.home / "Library/Application Support/Backchannel"
        gewe._write(legacy / "gewe.json", {"base_url": "https://example.invalid", "token": "old-test-token", "app_id": "old-device"})
        with patch.object(gewe, "DATA_DIR", current), patch.object(gewe.sys, "platform", "darwin"):
            self.assertEqual(gewe._config()["_directory"], legacy)
            gewe._write(current / "gewe.json", {"base_url": "https://example.invalid", "token": "new-test-token", "app_id": "new-device"})
            self.assertEqual(gewe._config()["app_id"], "new-device")
            self.assertEqual(gewe._config()["_directory"], current)
            # An incomplete new configuration must not silently revive an old account.
            gewe._write(current / "gewe.json", {})
            with self.assertRaises(gewe.GeweError):
                gewe._config()

    def test_https_root_address_is_required(self):
        with patch.object(gewe, "DATA_DIR", self.home), patch.object(gewe.sys, "platform", "linux"):
            for address in ["http://example.invalid", "https://user:pass@example.invalid", "https://example.invalid/api", "https://example.invalid?token=value", "https://example.invalid#fragment"]:
                with self.subTest(address=address):
                    gewe._write(self.home / "gewe.json", {"base_url": address, "token": "test-token", "app_id": "test-device"})
                    with self.assertRaises(gewe.GeweError):
                        gewe._config()

    @unittest.skipIf(sys.platform == "win32", "Windows uses inherited directory ACLs")
    def test_configuration_and_receipts_have_private_file_permissions(self):
        path = self.home / "gewe.json"
        path.with_suffix(".tmp").touch(mode=0o644)
        gewe._write(path, {"token": "test-token"})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
