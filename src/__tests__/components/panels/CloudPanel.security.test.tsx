import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import CloudPanel from '@/components/panels/CloudPanel';
import { useCloudStore } from '@/stores/useCloudStore';
import { stripSSHSecrets } from '@/utils/sshCredentialPolicy';
import type { SSHConfig } from '@/types/cloud';

const SERVER: SSHConfig = {
  id: '5d59838b-1d55-46e9-9d90-100bc995dd88',
  name: '测试服务器',
  host: '192.0.2.10',
  port: 22,
  username: 'trainer',
  authType: 'password',
  password: 'initial-secret',
  remoteWorkDir: '/tmp/neurobricks',
  createdAt: 1,
  updatedAt: 1,
};

describe('CloudPanel session credential boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    useCloudStore.setState({ servers: [], tasks: [] });
  });

  it('lets a restored server receive a session-only password without persisting it', () => {
    useCloudStore.getState().addServer(stripSSHSecrets(SERVER));
    render(<CloudPanel />);

    fireEvent.click(screen.getByRole('button', { name: '选择服务器 测试服务器' }));
    const input = screen.getByLabelText('本次会话密码');
    fireEvent.change(input, { target: { value: 'session-only-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    expect(useCloudStore.getState().servers[0].password).toBe('session-only-secret');
    expect(localStorage.getItem('neurobricks-cloud')).not.toContain('session-only-secret');
    expect(screen.getByText(/只保留在当前进程内/)).toBeInTheDocument();
  });
});
