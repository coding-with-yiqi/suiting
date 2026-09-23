---
license: apache-2.0
language:
- en
- ru
base_model:
- openai/whisper-base
pipeline_tag: automatic-speech-recognition
tags:
- automatic-speech-recognition
- asr
- onnx
- onnx-asr
---

OpenAI Whisper base [model](https://huggingface.co/openai/whisper-base) converted to ONNX format for [onnx-asr](https://github.com/istupakov/onnx-asr).

Install onnx-asr
```shell
pip install onnx-asr[cpu,hub]
```

Load whisper-base model and recognize wav file
```py
import onnx_asr
model = onnx_asr.load_model("whisper-base")
print(model.recognize("test.wav")) # Auto-detect lang (slower)
print(model.recognize("test.wav", language="en"))
```

## Model export

Read onnxruntime [instruction](https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/python/tools/transformers/models/whisper/README.md) for convert Whisper to ONNX.

Download model and export with *Beam Search* and *Forced Decoder Input Ids*:
```shell
python3 -m onnxruntime.transformers.models.whisper.convert_to_onnx -m openai/whisper-base --output ./whisper-onnx --use_forced_decoder_ids --optimize_onnx --precision fp32
```

Save tokenizer config
```py
from transformers import WhisperTokenizer

processor = WhisperTokenizer.from_pretrained("openai/whisper-base")
processor.save_pretrained("whisper-onnx")
```