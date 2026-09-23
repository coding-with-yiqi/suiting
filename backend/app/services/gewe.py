"""Human-reviewed WeChat delivery. Credentials and receipts stay on this device."""
import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

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


DATA_DIR = default_directory()
SEND_LOCK = asyncio.Lock()


class GeweError(Exception):
    def __init__(self, message, uncertain=False):
        super().__init__(message)
        self.uncertain = uncertain


def _read(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def _config_directory():
    if (DATA_DIR / "gewe.json").exists() or sys.platform != "darwin":
        return DATA_DIR
    candidates = []
    if os.environ.get("DATA_DIR"):
        root = Path(os.environ["DATA_DIR"]).expanduser()
        candidates.extend([root / "wechat", root])
        if root.name == "data":
            candidates.append(root.parent)
    candidates.append(Path.home() / "Library/Application Support/Backchannel")
    return next((path for path in candidates if (path / "gewe.json").exists()), DATA_DIR)


def _config():
    directory = _config_directory()
    config = _read(directory / "gewe.json", {})
    if not all(config.get(key) for key in ("base_url", "token", "app_id")):
        raise GeweError("微信连接尚未配置，请先完成 GeWe 连接。")
    url = urlsplit(config["base_url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise GeweError("微信服务地址需要使用 HTTPS 服务根地址。")
    config["_directory"] = directory
    return config


async def _post(config, route, payload, sending=False, timeout=30):
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.post(
                config["base_url"].rstrip("/") + "/gewe/v2/api/" + route,
                headers={"X-GEWE-TOKEN": config["token"]},
                json={"appId": config["app_id"], **payload},
            )
            response.raise_for_status()
            result = json.loads(response.text, parse_int=str)
    except (httpx.HTTPError, ValueError):
        raise GeweError(
            "发送结果暂时无法确认，请先在微信中核对。" if sending else "暂时连不上微信服务，请稍后重试。",
            uncertain=sending,
        ) from None
    if not isinstance(result, dict):
        raise GeweError("微信服务返回异常，请先核对微信。", uncertain=sending)
    if str(result.get("ret")) != "200":
        raise GeweError("微信服务未接受这次请求，请检查账号在线状态与套餐。")
    return result.get("data")


def _targets(config):
    cached = _read(config["_directory"] / "gewe-groups.json", {})
    groups = cached.get("groups", []) if cached.get("app_id") == config["app_id"] else []
    return [{"id": "filehelper", "name": "文件传输助手（先发给自己）"}, *groups]


def _version(config, content):
    return hashlib.sha256((config["app_id"] + "\0" + content).encode()).hexdigest()


def _receipt_path(question_id, config=None):
    directory = config["_directory"] if config is not None else _config_directory()
    return directory / "gewe-receipts" / (str(question_id) + ".json")


def review(question_id, content):
    try:
        config = _config()
    except GeweError:
        return {"configured": False, "targets": [], "receipts": {}}
    receipts = _read(_receipt_path(question_id, config), {}).get(_version(config, content), {})
    return {"configured": True, "targets": _targets(config), "receipts": receipts}


async def refresh_groups():
    config = _config()
    # This explicit refresh is the only place that fetches the address book.
    contacts = await _post(config, "contacts/fetchContactsList", {}, timeout=60)
    if not isinstance(contacts, dict) or not isinstance(contacts.get("chatrooms"), list):
        raise GeweError("群列表尚未返回，请稍后再刷新。")
    ids = list(dict.fromkeys(x for x in contacts["chatrooms"] if isinstance(x, str) and x.endswith("@chatroom")))
    groups = []
    for start in range(0, len(ids), 20):
        batch = ids[start:start + 20]
        details = await _post(config, "contacts/getBriefInfo", {"wxids": batch})
        if not isinstance(details, list):
            raise GeweError("暂时无法读取群名，请稍后再刷新。")
        names = {x.get("userName"): x.get("remark") or x.get("nickName") for x in details if isinstance(x, dict)}
        groups.extend({"id": wxid, "name": names[wxid]} for wxid in batch if names.get(wxid))
    _write(config["_directory"] / "gewe-groups.json", {"app_id": config["app_id"], "groups": groups})
    return _targets(config)


async def send_reviewed(question_id, content, targets):
    config = _config()
    allowed = {x["id"]: x["name"] for x in _targets(config)}
    targets = list(dict.fromkeys(targets))
    if not targets or any(target not in allowed for target in targets):
        raise GeweError("发送目标已变化，请重新选择并审核。")
    if not content.strip():
        raise GeweError("文案不能为空。")
    async with SEND_LOCK:
        path = _receipt_path(question_id, config)
        all_receipts = _read(path, {})
        receipts = all_receipts.setdefault(_version(config, content), {})
        pending = [target for target in targets if receipts.get(target, {}).get("state") not in ("sent", "pending", "unknown")]
        if pending and await _post(config, "login/checkOnline", {}) is not True:
            raise GeweError("微信已离线，请在 GeWe 中重新连接后再发送。")
        for target in pending:
            receipt = {"name": allowed[target], "state": "pending", "message": "正在发送或等待核对，请勿重复发送。"}
            receipts[target] = receipt
            # Save before contacting GeWe: a process interruption must not resend.
            _write(path, all_receipts)
            try:
                data = await _post(config, "message/postText", {"toWxid": target, "content": content}, sending=True)
                receipt.update(state="sent", message="微信服务已确认发送。", at=datetime.now(timezone.utc).isoformat())
                if isinstance(data, dict):
                    receipt["message_id"] = str(data.get("newMsgId", ""))
            except GeweError as exc:
                receipt.update(state="unknown" if exc.uncertain else "failed", message=str(exc))
            _write(path, all_receipts)
        return receipts
