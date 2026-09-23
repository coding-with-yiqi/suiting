# 来源与致谢

随听（Suiting）是基于 Backchannel 的独立再封装项目。

## 原始项目

- 项目：**Backchannel**
- 原作者：**Talbert Houle**
- GitHub：https://github.com/talberthoule/backchannel
- 原始说明：https://github.com/talberthoule/backchannel#readme
- 基线提交：https://github.com/talberthoule/backchannel/commit/16028a55dbbf886b68eaddc06dfd7c38b72de596
- 上游版本：v0.6.5
- 许可：MIT；本仓库 [LICENSE](LICENSE) 完整保留 `Copyright (c) 2026 Talbert Houle` 及许可正文。

本项目新增中文使用流程、直播转播提示词及示范、GeWe 人工审核发送和国内外兼容模型连接入口，并修复本机使用中遇到的路径与中文转写问题。上游英文历史更新说明为历史来源记录，并非随听的版本承诺。

## 微信接口

**GeWe** 提供微信节点、通讯录和消息接口。随听调用这些接口，本项目未分发 GeWe 服务本身，也未声称与其存在官方合作关系。

[GeWe 官方文档](https://doc.geweapi.com/) · [GeWe 管理后台](https://manager.geweapi.com/)

## 音频与模型

- [OpenAI Whisper 原项目](https://github.com/openai/whisper)：语音识别模型来源。
- [Whisper Base ONNX 转换模型](https://huggingface.co/istupakov/whisper-base-onnx)：默认下载的语音模型。
- [onnx-asr](https://github.com/istupakov/onnx-asr) 与 [ONNX Runtime](https://github.com/microsoft/onnxruntime)：本地推理运行库。
- [Silero VAD](https://github.com/snakers4/silero-vad)：检测语音片段。
- [WeSpeaker](https://github.com/wenet-e2e/wespeaker) 与 [ResNet152-LM 模型](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet152-LM)：说话人声音特征。
- [PostgreSQL](https://www.postgresql.org/about/licence/)：随桌面包分发的本地数据库。

模型、依赖和二进制运行库保留各自许可。来源与许可证入口见各项目；上游 MIT 许可不替代第三方组件许可。前后端完整依赖列表在各自 requirements / package-lock 文件中。

## 许可证副本

[third_party_licenses](third_party_licenses/README.md) 保存 Silero VAD、WeSpeaker、Whisper、onnx-asr、ONNX Runtime、PostgreSQL 的上游许可原文，以及默认 WeSpeaker 和 Whisper ONNX 模型的原始许可声明。各文件来源、固定提交或标签与内容校验值均有记录；未能锁定的运行时模型版本也已注明。

WeSpeaker ResNet152-LM 和 Whisper Base ONNX 转换模型的官方模型卡均声明 Apache-2.0；Whisper 原项目本身采用 MIT。对应原文分别保留，不以 Backchannel 或随听的许可覆盖第三方许可。Backchannel 许可仍以根目录 [LICENSE](LICENSE) 为准。
