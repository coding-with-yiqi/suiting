"""用独立空数据目录验证 Mac 安装包；不读取个人凭证、不发微信。

--hold-seconds 可为浏览器检查留出时间。退出时停止测试实例。
"""
import argparse
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--hold-seconds", type=int, default=0)
    parser.add_argument("--state-file", type=Path)
    args = parser.parse_args()
    versions = ast.parse((Path(__file__).resolve().parents[1] / "backend/app/release_notes.py").read_text())
    version = next(ast.literal_eval(node.value) for node in versions.body
                   if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "APP_VERSION" for target in node.targets))
    with tempfile.TemporaryDirectory(prefix="suiting-release-check-") as temporary:
        root = Path(temporary)
        env = dict(os.environ, BACKCHANNEL_HEADLESS="1", BACKCHANNEL_DATA_DIR=str(root), SUITING_WECHAT_DIR=str(root / "wechat"))
        for key in ("OPENAI_API_KEY", "GEMINI_API_KEY", "OPENAI_COMPATIBLE_API_KEY", "DATABASE_URL", "DATA_DIR"):
            env.pop(key, None)
        process = subprocess.Popen([str(args.app.resolve() / "Contents/MacOS/Backchannel")], env=env)
        try:
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"安装包提前退出：{process.returncode}")
                try:
                    state = json.loads((root / "launcher.json").read_text())
                    base = f"http://127.0.0.1:{state['port']}"
                    with urllib.request.urlopen(base + "/api/health", timeout=2) as response:
                        if response.status == 200 and response.headers.get("X-Backchannel-Instance") == state["token"]:
                            break
                except (OSError, ValueError, KeyError):
                    pass
                time.sleep(.5)
            else:
                raise RuntimeError("安装包健康检查超时")

            def request(path, payload=None, headers=None):
                raw = json.dumps(payload).encode() if payload is not None else None
                req = urllib.request.Request(base + path, data=raw, headers={"Content-Type": "application/json", **(headers or {})})
                with urllib.request.urlopen(req, timeout=45) as response:
                    return json.load(response)

            assert request("/api/meta")["version"] == version
            assert request("/api/endpoints") == [], "全新安装不应附带模型账号"
            assert request("/api/sessions") == [], "全新安装不应附带会议记录"
            assert request("/api/updates")["enabled"] is False
            local_asr = request("/api/diagnostics/local-asr")
            assert local_asr["usable"], local_asr.get("reason")
            try:
                request("/api/updates/apply", {}, {"X-Backchannel-Instance": state["token"]})
                raise AssertionError("停用的更新安装请求应被拒绝")
            except urllib.error.HTTPError as error:
                assert error.code == 409
            # A rejected update must not reserve shutdown and block normal work.
            demo = request("/api/sessions", {"name": "发布验证示例", "meeting_type": "general", "meeting_context": "本场主题：公开软件演示\n场景：回放；无直播入口"})
            assert demo["meeting_context"].startswith("本场主题：公开软件演示")
            with urllib.request.urlopen(base + "/", timeout=10) as response:
                assert "随听" in response.read().decode()
            print(f"PASS：空账号/空会议、v{version}、语音运行库、停用上游更新、会议信息保存、前端页面。", flush=True)
            print("说明：语音运行库探测不等于首次模型下载或真实转写验收。", flush=True)
            print(f"浏览器验证地址：{base}", flush=True)
            if args.state_file:
                args.state_file.write_text(json.dumps({"port": state["port"], "data_dir": str(root), "pid": process.pid}))
            finish = time.monotonic() + args.hold_seconds
            while time.monotonic() < finish and not (root / "finish-check").exists():
                time.sleep(.5)
        except Exception:
            log = root / "backchannel.log"
            if log.exists():
                print("\n".join(log.read_text(errors="replace").splitlines()[-40:]))
            raise
        finally:
            deadline = time.monotonic() + 30
            while process.poll() is None and time.monotonic() < deadline:
                (root / "stop").touch()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
            if process.poll() is None:
                process.kill()
                process.wait()
                raise RuntimeError("测试实例未正常关闭")
        assert process.returncode == 0
        print("PASS：测试实例正常关闭。", flush=True)


if __name__ == "__main__":
    main()
