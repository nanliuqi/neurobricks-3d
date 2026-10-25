# -*- coding: utf-8 -*-
import sys, io, re, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with open(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'utils', 'experimentExport.ts'), encoding='utf-8') as f:
    ts_content = f.read()

start = ts_content.find('export function generateTrainPy')
tick1 = ts_content.find('`', start)
tick2 = ts_content.find('`;', tick1)
template = ts_content[tick1+1:tick2]

config = {
    'epochs': 1, 'batchSize': 64, 'learningRate': 0.001, 'optimizer': 'sgd',
    'momentum': 0.9, 'lrScheduler': 'none', 'seed': 42, 'valSplit': 0.2,
    'weightDecay': 0, 'dataset': 'mnist',
}
code = template.replace('${config.epochs}', str(config['epochs']))
code = code.replace('${config.batchSize}', str(config['batchSize']))
code = code.replace('${config.learningRate}', str(config['learningRate']))
code = code.replace('${config.optimizer}', config['optimizer'])
code = code.replace('${config.momentum}', str(config['momentum']))
code = code.replace('${config.lrScheduler}', config['lrScheduler'])
code = code.replace('${config.seed}', str(config['seed']))
code = code.replace('${config.valSplit}', str(config['valSplit']))
code = code.replace('${config.weightDecay}', str(config['weightDecay']))
code = code.replace('${config.dataset}', config['dataset'])
code = code.replace("${config.dataset === 'cifar10' ? 'CIFAR10' : 'MNIST'}", 'MNIST')

lines = code.split('\n')
print('总行数:', len(lines))
for i in range(145, min(160, len(lines))):
    print(f'{i+1}: {lines[i]}')
