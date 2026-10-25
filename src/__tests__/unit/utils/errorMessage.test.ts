import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '@/utils/errorMessage';

describe('getErrorMessage', () => {
  it('keeps ordinary Error messages', () => {
    expect(getErrorMessage(new Error('读取失败'))).toBe('读取失败');
  });

  it('keeps string rejections returned by Tauri commands', () => {
    expect(getErrorMessage('至少需要 2 个类别子目录')).toBe('至少需要 2 个类别子目录');
  });

  it('supports structured errors without rendering undefined', () => {
    expect(getErrorMessage({ message: '路径无效' })).toBe('路径无效');
    expect(getErrorMessage({ message: 404 })).toBe('未知错误');
    expect(getErrorMessage(undefined)).toBe('未知错误');
  });

  it('extracts nested IPC rejection details', () => {
    // 示例使用当前导入协议真实可能返回的错误（不再使用已废弃的“末列即目标”口径）。
    expect(getErrorMessage({ error: 'CSV 列“glucose”包含 NaN/Infinity，第 2 行无效' })).toBe(
      'CSV 列“glucose”包含 NaN/Infinity，第 2 行无效'
    );
    expect(getErrorMessage({ message: undefined, cause: { reason: '读取失败' } })).toBe('读取失败');
  });

  it('does not loop on cyclic error objects', () => {
    const rejection: { cause?: unknown } = {};
    rejection.cause = rejection;
    expect(getErrorMessage(rejection, '可操作的兜底说明')).toBe('可操作的兜底说明');
  });

  it('uses a caller-provided fallback for empty messages', () => {
    expect(getErrorMessage('   ', '导入失败')).toBe('导入失败');
    expect(getErrorMessage(new Error(''), '导入失败')).toBe('导入失败');
  });
});
