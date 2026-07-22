import torch.nn as nn

def build_model(layers_config):
    """根据层配置列表构建 nn.Sequential 模型"""
    modules = []
    input_shape = None
    
    for layer in layers_config:
        layer_type = layer['type']
        params = layer.get('params', {})
        
        if layer_type == 'Input':
            # 记录输入形状，不添加模块
            input_shape = (
                params.get('inChannels', 1),
                params.get('inputHeight', 28),
                params.get('inputWidth', 28)
            )
            continue
        elif layer_type == 'Conv2D':
            modules.append(nn.Conv2d(
                in_channels=params.get('inChannels', 1),
                out_channels=params.get('outChannels', 32),
                kernel_size=params.get('kernelSize', 3),
                stride=params.get('stride', 1),
                padding=params.get('padding', 0)
            ))
        elif layer_type == 'MaxPool2D':
            modules.append(nn.MaxPool2d(
                kernel_size=params.get('poolKernelSize', 2),
                stride=params.get('poolStride', 2)
            ))
        elif layer_type == 'AvgPool2D':
            modules.append(nn.AvgPool2d(
                kernel_size=params.get('poolKernelSize', 2),
                stride=params.get('poolStride', 2)
            ))
        elif layer_type == 'Linear':
            modules.append(nn.Linear(
                in_features=params.get('inFeatures', 128),
                out_features=params.get('outFeatures', 10)
            ))
        elif layer_type == 'ReLU':
            modules.append(nn.ReLU())
        elif layer_type == 'Sigmoid':
            modules.append(nn.Sigmoid())
        elif layer_type == 'Tanh':
            modules.append(nn.Tanh())
        elif layer_type == 'BatchNorm2d':
            modules.append(nn.BatchNorm2d(
                num_features=params.get('numFeatures', 32)
            ))
        elif layer_type == 'LayerNorm':
            modules.append(nn.LayerNorm(
                normalized_shape=params.get('normalizedShape', 32)
            ))
        elif layer_type == 'Dropout':
            modules.append(nn.Dropout(
                p=params.get('dropRate', 0.5)
            ))
        elif layer_type == 'Flatten':
            modules.append(nn.Flatten())
    
    return nn.Sequential(*modules), input_shape
