# 用 GeWe 连接微信

[GeWe 官方文档](https://doc.geweapi.com/) · [GeWe 管理后台](https://manager.geweapi.com/)

随听通过 **GeWe** 读取可选微信群、发送人工审核后的文字。GeWe 是外部服务，需要你自己的账号、在线微信节点和可用服务权限；它不是随听附带的安装包，也不需要把 GeWe 服务安装到这台电脑。具体套餐、费用及账号使用规则，以 GeWe 和微信的现行说明为准。

## 先准备三个信息

1. 在 GeWe 管理后台完成账号与微信节点连接，确认微信在线。
2. 在后台找到 **API Token** 和该微信节点的完整 **appId**。
3. 确认你的 **HTTPS 服务根地址**。官方公共地址通常为 `https://api.geweapi.com`；若你的服务商提供独立地址，以自己的地址为准。不要填写带 `/gewe/v2/api/...` 的接口路径。

API Token 是连接凭证，保存在自己电脑即可，不要发进群、贴到 GitHub 或写进终端命令参数里。appId 指定使用哪个微信节点；它既不是微信群号，也不是腾讯会议号。

## 保存连接配置

进入随听项目目录，运行下面的交互脚本。脚本只用 Python 标准库，**不发送微信消息、不读取联系人，也不验证连接**。

```bash
python3 scripts/configure_gewe.py
```

脚本需要 Python 3。运行随听 Mac 安装包本身不需要另外安装 Python；如果终端找不到 `python3`，可从 [Python 官网](https://www.python.org/downloads/) 安装，或在已有 Homebrew 的电脑上执行 `brew install python`。

Windows 如果使用 Python 启动器：

```powershell
py scripts/configure_gewe.py
```

按提示依次填写服务地址、API Token 和 appId。输入 API Token 时终端不显示字符，这是正常的。已有配置时，只有输入“更新”才会覆盖。

随听后端通过 `httpx` 调用 GeWe，已包含在后端依赖中。源码安装时，按项目安装说明执行 `pip install -r backend/requirements.txt`；不需要另装微信机器人包。

### 配置放在哪里

应用和脚本按以下顺序寻找配置目录：

1. 如果设置了 `SUITING_WECHAT_DIR`，直接使用该目录。
2. 如果运行的是源码或 Docker，并显式设置了应用的 `DATA_DIR`，使用其下的 `wechat` 子目录；运行配置脚本时也要使用相同环境变量。打包桌面应用忽略启动器自动设置的 `DATA_DIR`，使用下一项的系统默认目录。
3. 桌面应用及未指定目录的脚本：macOS 使用 `~/Library/Application Support/Suiting/wechat`；Windows 使用 `%LOCALAPPDATA%\Suiting\wechat`；Linux 使用 `${XDG_DATA_HOME:-~/.local/share}/suiting/wechat`。因此普通终端完成默认配置后，双击桌面安装包即可找到配置。

目录内保存 `gewe.json`、群列表缓存和发送回执。macOS/Linux 配置文件权限为 `600`；Windows 的访问范围由文件权限和所在目录的访问控制共同决定。运行环境需要能持久保存这个目录，否则重启后会丢失配置和防重复发送记录。

自定义目录时，可以运行：

```bash
python3 scripts/configure_gewe.py --data-dir /你的绝对路径/wechat
```

**启动随听时也要把 `SUITING_WECHAT_DIR` 设置为同一个目录。** `--data-dir` 只指定此次脚本的保存位置，不会修改系统环境变量；它对应微信目录，不是应用 `DATA_DIR` 的根目录。如果通过 Docker 运行，还需要把这个本地目录挂载进容器，并让容器内的 `SUITING_WECHAT_DIR` 指向挂载位置。

兼容旧版 macOS：仅当新位置没有 `gewe.json` 时，依次检查已有的 `DATA_DIR/wechat`、`DATA_DIR` 根目录、当 `DATA_DIR` 末级为 `data` 时的父目录，最后检查 `~/Library/Application Support/Backchannel`。旧启动器的 `DATA_DIR` 通常是 `~/Library/Application Support/Backchannel/data`，而此前的微信配置在它的父目录。应用和脚本都会保留旧配置所在目录，群列表缓存和发送回执也继续放在一起，不复制凭证。新位置已经有配置但填写不完整时，不会自动切换回旧账号。

## Docker 的完整连接命令

在项目根目录执行，配置脚本只把凭证保存在本机被忽略的 `.local-wechat` 文件夹：

```bash
python3 scripts/configure_gewe.py --data-dir "$PWD/.local-wechat"
docker compose -f docker-compose.yml -f docker-compose.gewe.example.yml up -d --build
```

覆盖文件将它挂载到后端 `/app/wechat`，应用使用相同位置。后续启动也带上这两个 `-f` 参数。停止时使用相同的 Compose 文件执行 `down`，不要删除数据卷。

## 群号从哪里来

**不用手工填写群号。** 按这个顺序操作：

1. 在手机微信里打开想发送的群，进入群设置，开启“保存到通讯录”。
2. 回到随听，在文案卡片上点“发送”，再点“刷新群列表”。
3. 随听向 GeWe 请求 `contacts/fetchContactsList`，取得 `chatrooms` 中以 `@chatroom` 结尾的内部群 ID；再用 `contacts/getBriefInfo` 匹配群名。
4. 界面按群名供你选择。内部群 ID 由程序处理，**和文案中的腾讯会议号没有关系**。

群列表读取和消息发送都依赖 GeWe。只有保存到微信通讯录、且本次接口能返回的群才会出现在候选列表里；群名未更新或新群未出现时，确认已保存后稍等再刷新。刷新只获取群列表，不发消息，也不会自动勾选目标。

## 先审核，再发送

随听不会自动把新生成的文案推送到群里。

1. 阅读文案，需要时修改并保存。
2. 点“发送”，核对完整正文；第一次选好常用群后点“保存为默认群组”。之后打开新的文案时，这些群会自动勾选，也可以只为本条文案临时增删目标。
3. 勾选“我已核对正文和发送目标”，再点“确认发送”。

第一次建议只选“文件传输助手（先发给自己）”验证。实际群发送需要你自己勾选，不会因刷新、打开弹窗或生成新文案而发送。

默认群组保存在本机 GeWe 配置目录，并按当前 `appId` 隔离。第一次确认发送时，如果还没有默认群组，所选目标也会自动记住；更换微信账号不会沿用旧账号的设置。需要取消默认选择时，在审核窗口取消所有勾选并点“保存为默认群组”。

每个目标单独保存发送结果。同一张文案卡片、同一版正文和同一账号已确认发送的目标会被跳过，避免重复点击再发。正文修改后视为新版本，需要重新审核。网络中断导致结果无法确认时，先在微信里核对；随听不会自动重试这些目标。GeWe 返回成功表示服务确认发送，不代表群成员已经阅读。

## 常见情况

- **提示“微信连接尚未配置”**：检查脚本与随听是否使用同一个目录，以及三个信息是否完整。
- **群列表为空**：先在手机微信把群保存到通讯录，再刷新；同时检查 GeWe 节点在线与服务权限。
- **提示微信离线**：到 GeWe 管理后台重新连接微信，然后再次人工审核发送。
- **发送结果无法确认**：先打开微信核对实际消息，不要删除回执后连续重发。

本项目不提供 GeWe 服务、不保证第三方接口免费，也不能保证账号不受微信平台规则或限制影响。
