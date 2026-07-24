"""
NeuroBricks 3D 推理脚本
用法：python predict.py <config_json>
config_json 包含：
  - modelPath: 模型权重文件路径 (.pth)
  - imagePath: 待预测图片路径
  - layers: 网络层配置（同训练时的 config.layers）
  - inputShape: Input 层形状 [C, H, W]
"""
import sys
import json
import os

# UTF-8 编码（同 main.py）
for _stream in (sys.stdin, sys.stdout):
    if hasattr(_stream, 'reconfigure'):
        try:
            _stream.reconfigure(encoding='utf-8')
        except Exception:
            pass

import torch
from models import build_model
from torchvision import transforms
from PIL import Image


def predict(config):
    model_path = config.get('modelPath', '')
    image_path = config.get('imagePath', '')
    layers_config = config.get('layers', [])
    input_shape = config.get('inputShape', [1, 28, 28])

    # 检查文件
    if not os.path.isfile(model_path):
        print(json.dumps({"success": False, "error": f"模型文件不存在: {model_path}"}), flush=True)
        return
    if not os.path.isfile(image_path):
        print(json.dumps({"success": False, "error": f"图片文件不存在: {image_path}"}), flush=True)
        return

    # 构建模型
    model, _ = build_model(layers_config)

    # 加载权重
    try:
        model.load_state_dict(torch.load(model_path, map_location='cpu', weights_only=True))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"加载模型权重失败: {e}"}), flush=True)
        return

    model.eval()

    # 处理图片
    channels = input_shape[0] if input_shape else 1
    height = input_shape[1] if len(input_shape) > 1 else 28
    width = input_shape[2] if len(input_shape) > 2 else 28

    try:
        img = Image.open(image_path)
        if channels == 1:
            img = img.convert('L')
            transform = transforms.Compose([
                transforms.Resize((height, width)),
                transforms.ToTensor(),
                transforms.Normalize((0.1307,), (0.3081,))
            ])
        else:
            img = img.convert('RGB')
            transform = transforms.Compose([
                transforms.Resize((height, width)),
                transforms.ToTensor(),
                transforms.Normalize((0.4914, 0.4822, 0.4465), (0.2470, 0.2435, 0.2616))
            ])

        img_tensor = transform(img).unsqueeze(0)  # [1, C, H, W]
    except Exception as e:
        print(json.dumps({"success": False, "error": f"图片处理失败: {e}"}), flush=True)
        return

    # 推理
    try:
        with torch.no_grad():
            output = model(img_tensor)
            probabilities = torch.softmax(output, dim=1)[0]
            top5 = torch.topk(probabilities, min(5, len(probabilities)))

        results = []
        for i in range(top5.indices.shape[0]):
            idx = top5.indices[i].item()
            prob = top5.values[i].item()
            results.append({"class": idx, "probability": round(prob, 4)})

        print(json.dumps({
            "success": True,
            "predictions": results,
            "topClass": results[0]["class"],
            "topProbability": results[0]["probability"],
        }), flush=True)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"推理失败: {e}"}), flush=True)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "缺少配置参数"}), flush=True)
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
        predict(config)
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"配置解析失败: {e}"}), flush=True)
        sys.exit(1)
