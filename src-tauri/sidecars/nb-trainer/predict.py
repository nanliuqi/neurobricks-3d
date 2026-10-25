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
import math
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
from protocol import TrainerError
from torchvision import transforms
from PIL import Image


def predict(config):
    model_path = config.get('modelPath', '')
    image_path = config.get('imagePath', '')
    layers_config = config.get('layers', [])
    input_shape = config.get('inputShape', [1, 28, 28])
    preprocessing = config.get('preprocessing')

    # 检查文件
    if not os.path.isfile(model_path):
        raise TrainerError('MODEL_ARTIFACT_MISSING', f"模型文件不存在: {model_path}")
    if not os.path.isfile(image_path):
        raise TrainerError('PREDICTION_INPUT_MISSING', f"图片文件不存在: {image_path}")

    # 构建模型
    model, _ = build_model(layers_config)

    # 加载权重
    try:
        model.load_state_dict(torch.load(model_path, map_location='cpu', weights_only=True))
    except Exception as e:
        raise TrainerError('MODEL_ARTIFACT_INVALID', f"加载模型权重失败: {e}") from e

    model.eval()

    # 处理图片：只接受训练 Attempt 冻结的协议，不根据通道数猜测数据集。
    channels = input_shape[0] if input_shape else 1
    height = input_shape[1] if len(input_shape) > 1 else 28
    width = input_shape[2] if len(input_shape) > 2 else 28

    try:
        if not isinstance(preprocessing, dict) or preprocessing.get('algorithm') not in (
            'vision-fixed-v1', 'vision-resize-normalize-v1'
        ):
            raise TrainerError('PREPROCESSING_CONTRACT_MISSING', '图像推理缺少训练时冻结的预处理协议')
        declared_channels = preprocessing.get('channels')
        color_mode = preprocessing.get('colorMode')
        resize = preprocessing.get('resize')
        mean = preprocessing.get('normalizationMean')
        std = preprocessing.get('normalizationStd')
        if declared_channels != channels or color_mode not in ('grayscale', 'rgb'):
            raise TrainerError('PREPROCESSING_CONTRACT_INVALID', '图像预处理通道契约与模型输入不一致')
        expected_length = 1 if color_mode == 'grayscale' else 3
        if (
            not isinstance(mean, list) or not isinstance(std, list)
            or len(mean) != expected_length or len(std) != expected_length
            or any(not isinstance(value, (int, float)) or not math.isfinite(float(value)) for value in mean)
            or any(not isinstance(value, (int, float)) or not math.isfinite(float(value)) or float(value) <= 0 for value in std)
        ):
            raise TrainerError('PREPROCESSING_CONTRACT_INVALID', '图像归一化参数无效')
        expected_resize = [height, width]
        if resize is not None and resize != expected_resize:
            raise TrainerError('PREPROCESSING_CONTRACT_INVALID', '图像 resize 契约与模型输入形状不一致')

        img = Image.open(image_path)
        img = img.convert('L' if color_mode == 'grayscale' else 'RGB')
        transform_steps = []
        if resize is not None:
            transform_steps.append(transforms.Resize((height, width), interpolation=transforms.InterpolationMode.BILINEAR))
        transform_steps.extend([transforms.ToTensor(), transforms.Normalize(tuple(mean), tuple(std))])
        transform = transforms.Compose(transform_steps)

        img_tensor = transform(img).unsqueeze(0)  # [1, C, H, W]
    except TrainerError:
        raise
    except Exception as e:
        raise TrainerError('IMAGE_PREPROCESSING_FAILED', f"图片处理失败: {e}") from e

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
        raise TrainerError('PREDICTION_FAILED', f"推理失败: {e}") from e


def _fail(message, error_code='PREDICTION_INPUT_INVALID', details=None):
    raise TrainerError(error_code, message, details)


def predict_tabular(config):
    """使用训练时冻结的特征顺序和 StandardScaler 参数执行单行回归推理。"""
    model_path = config.get('modelPath', '')
    layers_config = config.get('layers', [])
    input_shape = config.get('inputShape', [])
    feature_values = config.get('featureValues', [])
    preprocessing = config.get('preprocessing', {})

    if not os.path.isfile(model_path):
        _fail(f"模型文件不存在: {model_path}", 'MODEL_ARTIFACT_MISSING')
    if not isinstance(layers_config, list) or not layers_config:
        _fail("回归推理缺少模型层配置")
    if not isinstance(input_shape, list) or len(input_shape) != 3:
        _fail("回归推理输入形状必须为 [C, H, W]")
    if not isinstance(feature_values, list) or not feature_values:
        _fail("请至少提供一个回归特征")

    try:
        values = [float(value) for value in feature_values]
        expected_count = math.prod(int(dimension) for dimension in input_shape)
    except (TypeError, ValueError, OverflowError):
        _fail("回归特征与输入形状必须是数值")
    if expected_count != len(values) or any(not math.isfinite(value) for value in values):
        _fail(f"回归特征必须包含 {expected_count} 个有限数值")

    if not isinstance(preprocessing, dict) or preprocessing.get('algorithm') != 'standard-scaler-fit-train-only-v1':
        _fail("不支持或缺失训练时标准化协议", 'PREPROCESSING_CONTRACT_MISSING')
    mean = preprocessing.get('mean')
    std = preprocessing.get('std')
    if not isinstance(mean, list) or not isinstance(std, list) or len(mean) != len(values) or len(std) != len(values):
        _fail("训练时标准化参数与特征数量不一致", 'PREPROCESSING_CONTRACT_INVALID')
    try:
        mean_values = [float(value) for value in mean]
        std_values = [float(value) for value in std]
    except (TypeError, ValueError, OverflowError):
        _fail("训练时标准化参数不是有效数值", 'PREPROCESSING_CONTRACT_INVALID')
    if any(not math.isfinite(value) for value in mean_values) or any(
        not math.isfinite(value) or value <= 0 for value in std_values
    ):
        _fail("训练时标准化参数包含无效均值或标准差", 'PREPROCESSING_CONTRACT_INVALID')

    try:
        model, _ = build_model(layers_config)
        model.load_state_dict(torch.load(model_path, map_location='cpu', weights_only=True))
        model.eval()
        standardized = [(value - center) / scale for value, center, scale in zip(values, mean_values, std_values)]
        input_tensor = torch.tensor(standardized, dtype=torch.float32).reshape(1, *input_shape)
        with torch.no_grad():
            output = model(input_tensor)
        if output.numel() != 1:
            _fail(f"回归模型必须输出一个数值，当前输出元素数为 {output.numel()}", 'MODEL_OUTPUT_INVALID')
        prediction = float(output.reshape(-1)[0].item())
        if not math.isfinite(prediction):
            _fail("回归模型输出了 NaN/Infinity，无法作为推理结果", 'NUMERICAL_FAILURE')
        print(json.dumps({"success": True, "value": prediction}), flush=True)
    except TrainerError:
        raise
    except Exception as error:
        _fail(f"回归推理失败: {error}", 'PREDICTION_FAILED')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "缺少配置参数"}), flush=True)
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
        predict(config)
    except (json.JSONDecodeError, TrainerError) as e:
        code = e.error_code if isinstance(e, TrainerError) else 'CONFIG_JSON_INVALID'
        print(json.dumps({"success": False, "errorCode": code, "error": str(e)}, ensure_ascii=False), flush=True)
        sys.exit(1)
