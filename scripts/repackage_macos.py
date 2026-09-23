"""将 Backchannel 0.6.5 的 Mac ARM64 运行库与随听源码、前端重新封装。

需要 Python 3.12 和 PyInstaller 6.16.0。仅复制给定 .app，不读取用户数据。
完整从源码构建的方法见 docs/安装与构建.md。
"""
import argparse
import importlib.util
import marshal
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import zlib

from PyInstaller.archive.readers import CArchiveReader
from PyInstaller.archive.writers import CArchiveWriter
from PyInstaller.utils.osx import fix_exe_for_code_signing, remove_signature_from_binary, sign_binary


def patch_executable(original, output, repo):
    shutil.copy2(original, output)
    remove_signature_from_binary(str(output))
    archive = CArchiveReader(str(output))
    raw = output.read_bytes()
    pyz = archive.open_embedded_archive("PYZ.pyz")
    old_pyz = archive.extract("PYZ.pyz")
    if old_pyz[4:8] != importlib.util.MAGIC_NUMBER:
        raise RuntimeError("打包 Python 与安装包字节码版本不同。请使用 Python 3.12。")
    changes = {}
    for source_root in (repo / "backend/app", repo / "desktop/bcdesktop"):
        for source in source_root.rglob("*.py"):
            relative = source.relative_to(source_root.parent)
            parts = list(relative.with_suffix("").parts)
            package = parts[-1] == "__init__"
            if package:
                parts.pop()
            name = ".".join(parts)
            changes[name] = (int(package), compile(source.read_text(), relative.as_posix(), "exec"))
    launcher = marshal.dumps(compile((repo / "desktop/launcher.py").read_text(), "launcher.py", "exec"))
    new_pyz = bytearray(old_pyz[:12])
    toc = []
    for name in dict.fromkeys([*pyz.toc, *changes]):
        if name in changes:
            kind, code = changes[name]
            blob = zlib.compress(marshal.dumps(code), 9)
        else:
            kind, position, length = pyz.toc[name]
            blob = old_pyz[position:position + length]
        toc.append((name, (kind, len(new_pyz), len(blob))))
        new_pyz.extend(blob)
    struct.pack_into("!i", new_pyz, 8, len(new_pyz))
    new_pyz.extend(marshal.dumps(toc))
    payload, c_toc = bytearray(), []
    for name, (pos, size, unpacked, compressed, kind) in archive.toc.items():
        data = raw[archive._start_offset + pos:archive._start_offset + pos + size]
        replacement = {"PYZ.pyz": new_pyz, "launcher": launcher}.get(name)
        if replacement is not None:
            data = zlib.compress(replacement, 9) if compressed else replacement
            unpacked = len(replacement)
        c_toc.append((len(payload), len(data), unpacked, compressed, kind, name))
        payload.extend(data)
    for option in archive.options:
        c_toc.append((len(payload), 0, 0, 0, "o", option))
    toc_offset = len(payload)
    toc_bytes = CArchiveWriter._serialize_toc(c_toc)
    payload.extend(toc_bytes)
    cookie = struct.unpack(archive._COOKIE_FORMAT, raw[archive._end_offset - archive._COOKIE_LENGTH:archive._end_offset])
    payload.extend(struct.pack(archive._COOKIE_FORMAT, cookie[0], len(payload) + archive._COOKIE_LENGTH, toc_offset, len(toc_bytes), cookie[4], cookie[5]))
    output.write_bytes(raw[:archive._start_offset] + payload)
    fix_exe_for_code_signing(str(output))
    sign_binary(str(output))
    verified_archive = CArchiveReader(str(output))
    verified = verified_archive.open_embedded_archive("PYZ.pyz")
    baseline = CArchiveReader(str(original)).open_embedded_archive("PYZ.pyz")
    assert set(verified.toc) == set(pyz.toc) | set(changes)
    for name in verified.toc:
        assert verified.extract(name) == (changes[name][1] if name in changes else baseline.extract(name)), name
    assert verified_archive.extract("launcher") == launcher
    print(f"已验证 {len(changes)} 个源码模块与启动器，{len(set(pyz.toc) - set(changes))} 个依赖模块保持原样。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-app", type=Path, required=True)
    parser.add_argument("--output-app", type=Path, required=True)
    parser.add_argument("--frontend-dist", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if sys.platform != "darwin" or sys.version_info[:2] != (3, 12):
        parser.error("请在 macOS 使用 Python 3.12。")
    if args.output_app.exists() or not args.source_app.is_dir():
        parser.error("输入 .app 必须存在；输出路径必须尚不存在。")
    if not (args.frontend_dist / "index.html").is_file():
        parser.error("请先构建前端。")
    subprocess.run(["ditto", str(args.source_app), str(args.output_app)], check=True)
    binary = args.output_app / "Contents/MacOS/Backchannel"
    staged = binary.with_suffix(".new")
    patch_executable(binary, staged, repo)
    staged.replace(binary)
    frontend = (args.output_app / "Contents/Frameworks/frontend").resolve()
    shutil.rmtree(frontend)
    shutil.copytree(args.frontend_dist, frontend)
    for old in args.output_app.rglob("frontend.previous"):
        if old.is_symlink():
            old.unlink()
        elif old.is_dir():
            shutil.rmtree(old)
    resources = args.output_app / "Contents/Resources"
    for name in ("LICENSE", "NOTICE.md"):
        shutil.copy2(repo / name, resources / name)
    shutil.copytree(repo / "docs", resources / "随听说明", dirs_exist_ok=True)
    shutil.copytree(repo / "third_party_licenses", resources / "third_party_licenses", dirs_exist_ok=True)
    plist = args.output_app / "Contents/Info.plist"
    info = plistlib.loads(plist.read_bytes())
    info.update(CFBundleName="随听", CFBundleDisplayName="随听", CFBundleIdentifier="com.codingwithyiqi.suiting", CFBundleShortVersionString="0.1.0", CFBundleVersion="0.1.0")
    plist.write_bytes(plistlib.dumps(info))
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(args.output_app)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(args.output_app)], check=True)
    print("已封装并验证临时签名；尚未进行 Apple 公证。")


if __name__ == "__main__":
    main()
