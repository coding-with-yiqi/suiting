#!/usr/bin/env python3
"""互动保存随听的 GeWe 配置；仅使用 Python 标准库，不连接网络。"""
import argparse
import getpass
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
import warnings


def default_directory():
    if os.environ.get("SUITING_WECHAT_DIR"):
        return Path(os.environ["SUITING_WECHAT_DIR"]).expanduser()
    desktop = os.environ.get("BACKCHANNEL_DESKTOP") == "1" or getattr(sys, "frozen", False)
    if os.environ.get("DATA_DIR") and not desktop:
        return Path(os.environ["DATA_DIR"]).expanduser() / "wechat"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Suiting/wechat"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Suiting/wechat"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "suiting/wechat"


def configuration_directory():
    directory = default_directory()
    if (directory / "gewe.json").exists() or sys.platform != "darwin":
        return directory
    candidates = []
    if os.environ.get("DATA_DIR"):
        root = Path(os.environ["DATA_DIR"]).expanduser()
        candidates.extend([root / "wechat", root])
        if root.name == "data":
            candidates.append(root.parent)
    candidates.append(Path.home() / "Library/Application Support/Backchannel")
    return next((path for path in candidates if (path / "gewe.json").exists()), directory)


def validate_address(address):
    url = urlsplit(address)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise ValueError("请填写 HTTPS 服务根地址，不要附加接口路径、账号密码或查询参数。")
    return address.rstrip("/")


def save_configuration(directory, config):
    directory.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".gewe-", suffix=".tmp", dir=directory)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            os.chmod(temporary, 0o600)
            json.dump(config, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(directory / "gewe.json")
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="配置随听的 GeWe 连接。此脚本只保存本地配置，不发送微信消息。")
    parser.add_argument("--data-dir", type=Path, help="微信配置目录；对应应用的 SUITING_WECHAT_DIR，不是 DATA_DIR 根目录")
    args = parser.parse_args()
    directory = (args.data_dir.expanduser() if args.data_dir is not None else configuration_directory()).resolve()
    print("请先在 GeWe 中登录微信，准备服务地址、API Token 和 appId。")
    print("本程序不会验证账号、读取联系人或发送消息。API Token 输入时不会显示。")
    print(f"配置保存位置：{directory / 'gewe.json'}")
    try:
        if (directory / "gewe.json").exists() and input("已有配置。输入“更新”后覆盖；直接回车退出：").strip() != "更新":
            print("已退出，保留原配置。")
            return 0
        address = validate_address(input("HTTPS 服务根地址 [https://api.geweapi.com]：").strip() or "https://api.geweapi.com")
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            token = getpass.getpass("API Token（隐藏输入）：").strip()
        app_id = input("appId（微信节点的完整 appId，不是微信群号或腾讯会议号）：").strip()
        if not token or not app_id:
            raise ValueError("API Token 和 appId 都不能为空。")
        save_configuration(directory, {"base_url": address, "token": token, "app_id": app_id})
    except (EOFError, KeyboardInterrupt):
        print("\n已取消，原配置保持不变。")
        return 1
    except getpass.GetPassWarning:
        print("请在支持隐藏输入的终端里运行本程序，避免显示 API Token。", file=sys.stderr)
        return 1
    except (ValueError, OSError) as exc:
        print(f"未保存配置：{exc}", file=sys.stderr)
        return 1
    print("已保存。请在随听的文案卡片中点“审核并发送”，再点“刷新群列表”。")
    if args.data_dir is not None:
        print("启动随听时，请把 SUITING_WECHAT_DIR 设置为上面的目录。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
