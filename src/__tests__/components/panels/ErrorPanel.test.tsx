import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorPanel from '../../components/panels/ErrorPanel';
import { useLayerStore } from '../../stores/useLayerStore';

describe('ErrorPanel', () => {
  it('应该在没有错误时显示成功消息', () => {
    // 设置验证结果为有效
    useLayerStore.setState({
      validationResult: { valid: true, errors: [] },
    });

    render(<ErrorPanel />);
    
    expect(screen.getByText('没有发现错误')).toBeInTheDocument();
    expect(screen.getByText('模型结构有效')).toBeInTheDocument();
  });

  it('应该在有错误时显示错误列表', () => {
    // 设置验证结果为无效
    useLayerStore.setState({
      validationResult: {
        valid: false,
        errors: ['第一层必须是输入层（Input）', '最后一层必须是输出层（Softmax）'],
      },
    });

    render(<ErrorPanel />);
    
    expect(screen.getByText('发现 2 个错误')).toBeInTheDocument();
    expect(screen.getByText('第一层必须是输入层（Input）')).toBeInTheDocument();
    expect(screen.getByText('最后一层必须是输出层（Softmax）')).toBeInTheDocument();
  });

  it('应该显示修复建议', () => {
    useLayerStore.setState({
      validationResult: { valid: false, errors: ['测试错误'] },
    });

    render(<ErrorPanel />);
    
    expect(screen.getByText('修复建议')).toBeInTheDocument();
    expect(screen.getByText('确保第一层是输入层（Input）')).toBeInTheDocument();
  });

  it('应该正确渲染错误数量', () => {
    useLayerStore.setState({
      validationResult: {
        valid: false,
        errors: ['错误1', '错误2', '错误3'],
      },
    });

    render(<ErrorPanel />);
    
    expect(screen.getByText('发现 3 个错误')).toBeInTheDocument();
  });
});
