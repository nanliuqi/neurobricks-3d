import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AppErrorBoundary from './components/errors/AppErrorBoundary';

// 生产环境禁用右键菜单（dev 模式 F12 仍可开 DevTools）
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

const root = document.getElementById('root');

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>
  );
} else {
  console.error('Failed to find the root element');
}
