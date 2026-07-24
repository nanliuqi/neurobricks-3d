import type { LayerType, LayerParams } from './layer';

/**
 * 经典模型中的一个层模板
 */
export interface ClassicLayerTemplate {
  type: LayerType;
  params?: Partial<LayerParams>;
}

/**
 * 经典模型定义
 */
export interface ClassicModel {
  id: string;
  name: string;
  year: number;
  description: string;
  paper: string;
  layers: ClassicLayerTemplate[];
  /** 适配的数据集类型 */
  compatibleDatasets?: string[];
}

/**
 * 经典神经网络模型库
 * 用户选择后可一键生成所有层积木
 */
export const CLASSIC_MODELS: ClassicModel[] = [
  {
    id: 'lenet5',
    name: 'LeNet-5',
    year: 1998,
    description: 'Yann LeCun 提出的经典卷积网络，手写数字识别鼻祖',
    paper: 'Gradient-Based Learning Applied to Document Recognition',
    compatibleDatasets: ['mnist', 'cifar10'],
    layers: [
      // 模板以 MNIST（1×28×28）为默认输入，此时 Flatten 输出恰为 256，与下方 Linear 一致；
      // 选择 CIFAR-10 等其他数据集时由 adaptLayersToInputShape 自动修正全部依赖参数
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
      { type: 'Conv2D', params: { inChannels: 1, outChannels: 6, kernelSize: 5, padding: 0 } },
      { type: 'AvgPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 6, outChannels: 16, kernelSize: 5, padding: 0 } },
      { type: 'AvgPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 256, outFeatures: 120 } },
      { type: 'Tanh' },
      { type: 'Linear', params: { inFeatures: 120, outFeatures: 84 } },
      { type: 'Tanh' },
      { type: 'Linear', params: { inFeatures: 84, outFeatures: 10 } },
    ],
  },
  {
    id: 'alexnet',
    name: 'AlexNet',
    year: 2012,
    description: 'ImageNet 突破之作，开启深度学习时代',
    paper: 'ImageNet Classification with Deep Convolutional Neural Networks',
    compatibleDatasets: [],
    layers: [
      { type: 'Input', params: { inChannels: 3, inputHeight: 224, inputWidth: 224 } },
      { type: 'Conv2D', params: { inChannels: 3, outChannels: 64, kernelSize: 11, stride: 4, padding: 2 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 3, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 192, kernelSize: 5, padding: 2 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 3, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 192, outChannels: 384, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 384, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 3, poolStride: 2 } },
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 9216, outFeatures: 4096 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.5 } },
      { type: 'Linear', params: { inFeatures: 4096, outFeatures: 4096 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.5 } },
      { type: 'Linear', params: { inFeatures: 4096, outFeatures: 1000 } },
    ],
  },
  {
    id: 'vgg16',
    name: 'VGG-16',
    year: 2014,
    description: 'VGG 组提出的 16 层网络，结构简洁统一',
    paper: 'Very Deep Convolutional Networks for Large-Scale Image Recognition',
    compatibleDatasets: [],
    layers: [
      { type: 'Input', params: { inChannels: 3, inputHeight: 224, inputWidth: 224 } },
      // Block 1
      { type: 'Conv2D', params: { inChannels: 3, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      // Block 2
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 128, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 128, outChannels: 128, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      // Block 3
      { type: 'Conv2D', params: { inChannels: 128, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      // Block 4
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      // Block 5
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      // FC
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 25088, outFeatures: 4096 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.5 } },
      { type: 'Linear', params: { inFeatures: 4096, outFeatures: 4096 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.5 } },
      { type: 'Linear', params: { inFeatures: 4096, outFeatures: 1000 } },
    ],
  },
  {
    id: 'resnet18',
    name: 'ResNet-18',
    year: 2015,
    description: '何恺明提出的残差网络，解决深层网络退化问题（简化版，无跳跃连接）',
    paper: 'Deep Residual Learning for Image Recognition',
    compatibleDatasets: [],
    layers: [
      { type: 'Input', params: { inChannels: 3, inputHeight: 224, inputWidth: 224 } },
      { type: 'Conv2D', params: { inChannels: 3, outChannels: 64, kernelSize: 7, stride: 2, padding: 3 } },
      { type: 'BatchNorm2d', params: { numFeatures: 64 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 3, poolStride: 2, padding: 1 } },
      // Layer1
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 64 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 64 } },
      { type: 'ReLU' },
      // Layer2
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 128, kernelSize: 3, stride: 2, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 128 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 128, outChannels: 128, kernelSize: 3, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 128 } },
      { type: 'ReLU' },
      // Layer3
      { type: 'Conv2D', params: { inChannels: 128, outChannels: 256, kernelSize: 3, stride: 2, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 256 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 256 } },
      { type: 'ReLU' },
      // Layer4
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 512, kernelSize: 3, stride: 2, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 512 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'BatchNorm2d', params: { numFeatures: 512 } },
      { type: 'ReLU' },
      // FC
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 512, outFeatures: 1000 } },
    ],
  },
  {
    id: 'simplecnn',
    name: 'SimpleCNN',
    year: 2020,
    description: '教学用简单 CNN，适合 MNIST/Fashion-MNIST 入门',
    paper: '',
    compatibleDatasets: ['mnist', 'cifar10'],
    layers: [
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
      { type: 'Conv2D', params: { inChannels: 1, outChannels: 32, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 32, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 3136, outFeatures: 128 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.5 } },
      { type: 'Linear', params: { inFeatures: 128, outFeatures: 10 } },
    ],
  },
  {
    id: 'mlp',
    name: 'MLP',
    year: 2020,
    description: '多层感知机，最基础的全连接网络',
    paper: '',
    compatibleDatasets: ['mnist'],
    layers: [
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 784, outFeatures: 256 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.2 } },
      { type: 'Linear', params: { inFeatures: 256, outFeatures: 128 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.2 } },
      { type: 'Linear', params: { inFeatures: 128, outFeatures: 10 } },
    ],
  },
  {
    id: 'googlenet',
    name: 'GoogLeNet',
    year: 2014,
    description: 'Google 提出的 Inception 网络，ILSVRC 2014 冠军（简化版）',
    paper: 'Going Deeper with Convolutions',
    compatibleDatasets: [],
    layers: [
      { type: 'Input', params: { inChannels: 3, inputHeight: 224, inputWidth: 224 } },
      { type: 'Conv2D', params: { inChannels: 3, outChannels: 64, kernelSize: 7, stride: 2, padding: 3 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 3, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 64, kernelSize: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 192, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 3, poolStride: 2 } },
      // Simplified Inception-like blocks
      { type: 'Conv2D', params: { inChannels: 192, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 480, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 480, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Flatten' },
      { type: 'Linear', params: { inFeatures: 8192, outFeatures: 1024 } },
      { type: 'ReLU' },
      { type: 'Dropout', params: { dropRate: 0.4 } },
      { type: 'Linear', params: { inFeatures: 1024, outFeatures: 1000 } },
    ],
  },
  {
    id: 'unet',
    name: 'U-Net (编码器)',
    year: 2015,
    description: '医学图像分割经典网络（编码器部分，无跳跃连接）',
    paper: 'U-Net: Convolutional Networks for Biomedical Image Segmentation',
    compatibleDatasets: [],
    layers: [
      { type: 'Input', params: { inChannels: 1, inputHeight: 256, inputWidth: 256 } },
      // Encoder path
      { type: 'Conv2D', params: { inChannels: 1, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 64, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 64, outChannels: 128, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 128, outChannels: 128, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 128, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 256, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      { type: 'Conv2D', params: { inChannels: 256, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 512, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'MaxPool2D', params: { poolKernelSize: 2, poolStride: 2 } },
      // Bottleneck
      { type: 'Conv2D', params: { inChannels: 512, outChannels: 1024, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
      { type: 'Conv2D', params: { inChannels: 1024, outChannels: 1024, kernelSize: 3, padding: 1 } },
      { type: 'ReLU' },
    ],
  },
];
