# 第三方许可证副本

核对日期：2026-09-23。以下许可、版权声明和模型卡从相应项目的官方仓库或官方站点下载，正文未经翻译或改写。每个原文文件的精确来源、下载结果地址与 SHA-256 在 [sources.json](sources.json) 中。

Backchannel 的 MIT 许可已经完整保留于项目根目录 [LICENSE](../LICENSE)，这里不重复复制。

## 检测声音：Silero VAD

- 许可：MIT。[原文副本](Silero-VAD.LICENSE.txt) · [官方来源](https://github.com/snakers4/silero-vad/blob/5cd7945676eb32225748052e2e6a0580e4686a08/LICENSE)。
- 本次许可来源提交：`5cd7945676eb32225748052e2e6a0580e4686a08`。
- 模型下载脚本使用上游 `master` 路径，未锁定模型提交；该许可快照不代表已核实桌面包内模型的精确版本。

## 区分说话人：WeSpeaker

- 代码项目许可：Apache-2.0。[原文副本](WeSpeaker.LICENSE.txt) · [官方来源](https://github.com/wenet-e2e/wespeaker/blob/9fecd6cb4f47475d01761d87c826298dff4ef18c/LICENSE)。
- 默认声音特征模型是 `Wespeaker/wespeaker-voxceleb-resnet152-LM`。其官方模型卡实际声明 **Apache-2.0**，不是 MIT。[原始模型卡副本](WeSpeaker-ResNet152-LM.MODEL-CARD.md) · [对应模型仓库提交](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet152-LM/tree/4adba1525a6c9d5fff74b6df43a6ec97a86c4112)。
- 在上述模型仓库提交中未找到独立的 LICENSE 文件；本目录因此同时保存模型卡声明和 [Apache 官方许可全文](Apache-2.0.LICENSE.txt)，没有自行补写模型版权归属。
- 模型下载脚本使用 `main`，未锁定模型提交；这里记录的是本次核对的仓库状态。

## 语音转文字：Whisper 与 ONNX 转换模型

- OpenAI Whisper 原项目采用 MIT。[原文副本](Whisper.LICENSE.txt) · [官方来源](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/LICENSE)。
- 默认使用的 `istupakov/whisper-base-onnx` 是独立发布的 ONNX 转换模型。该仓库模型卡实际声明 **Apache-2.0**，并注明基础模型为 `openai/whisper-base`。[原始模型卡副本](Whisper-Base-ONNX.MODEL-CARD.md) · [对应模型仓库提交](https://huggingface.co/istupakov/whisper-base-onnx/tree/998334d3bfe2deba3c8e6821f05388dbf2b706d2)。
- 上述转换模型仓库未提供独立 LICENSE 文件，因此附 [Apache 官方许可全文](Apache-2.0.LICENSE.txt)，同时保留 Whisper 上游 MIT 许可；不把两者混写成同一种许可。
- 模型由运行时下载，当前应用没有在配置中锁定 Hugging Face revision；本目录不声称所有用户后来下载的模型都与此快照相同。

## 本地推理：onnx-asr 与 ONNX Runtime

- **onnx-asr**：MIT。[v0.12.0 原文副本](onnx-asr.LICENSE.txt) · [官方来源](https://github.com/istupakov/onnx-asr/blob/v0.12.0/LICENSE)。此次桌面包来源应用的公开包元数据标记为 `0.12.0`；源码 requirements 使用 `>=0.11.0`，重新安装可能解析到别的版本。
- **ONNX Runtime**：MIT。[v1.21.1 原文副本](ONNX-Runtime.LICENSE.txt) · [官方来源](https://github.com/microsoft/onnxruntime/blob/v1.21.1/LICENSE)。源码 requirements 固定 `1.21.1`。另附该版本原样发布的 [ThirdPartyNotices.txt](ONNX-Runtime.ThirdPartyNotices.txt)，其中有其内含组件的独立声明；未以 ONNX Runtime 的 MIT 许可替代这些声明。

## 本地数据库：PostgreSQL

- [PostgreSQL 原文副本](PostgreSQL.COPYRIGHT.txt) · [官方仓库 REL_16_4/COPYRIGHT](https://github.com/postgres/postgres/blob/REL_16_4/COPYRIGHT) · [官方许可说明](https://www.postgresql.org/about/licence/)。
- 桌面下载脚本声明嵌入包版本 `16.4.0`，因此保留 PostgreSQL `REL_16_4` 的原始 COPYRIGHT。Docker 使用浮动 `postgres:16-alpine` 镜像，其实际小版本与容器内附带声明由镜像决定；不把此副本认定为所有后续镜像的精确版本清单。

## 官方通用许可文本与范围

[Apache-2.0.LICENSE.txt](Apache-2.0.LICENSE.txt) 来自 [Apache Software Foundation 官方许可文本](https://www.apache.org/licenses/LICENSE-2.0.txt)。它用于保留上述模型卡明确指向的许可原文，并不单独证明其他文件采用同一许可。

本目录覆盖此次列明的模型与主要本地运行组件，不是整个桌面二进制依赖的完整清单。其余 Python、前端、数据库分发包与系统库随附的许可证和版权声明应继续保留；源码依赖入口为 `backend/requirements.txt`、`frontend/package-lock.json` 和桌面构建配置。
