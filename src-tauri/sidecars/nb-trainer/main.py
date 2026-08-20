import sys
import json
from models import build_model
from train import train

# Rust 端通过 stdin/stdout 以 UTF-8 JSON 通信（write_all UTF-8 字节 / BufReader 按 UTF-8 解码），
# 但 Windows 上 Python 默认 I/O 编码跟随系统区域（如 GBK/CP936），
# 含中文的数据集路径会被解码为乱码导致“目录不存在”，故显式重配置为 UTF-8
for _stream in (sys.stdin, sys.stdout):
    if hasattr(_stream, 'reconfigure'):
        try:
            _stream.reconfigure(encoding='utf-8')
        except Exception:
            pass

def main():
    # 读取第一行配置
    config_line = sys.stdin.readline()
    if not config_line:
        print(json.dumps({"type": "error", "message": "No configuration received"}), flush=True)
        sys.exit(1)
    
    try:
        config = json.loads(config_line)
    except json.JSONDecodeError as e:
        print(json.dumps({"type": "error", "message": f"Invalid config JSON: {e}"}), flush=True)
        sys.exit(1)
    
    try:
        mode = config.get('mode', 'train')

        if mode == 'predict':
            # 推理模式：延迟导入 predict 模块（避免训练时加载 PIL 等额外依赖）
            from predict import predict
            predict(config)
        else:
            # 训练模式（默认）
            model_and_shape = build_model(config['layers'])
            train(model_and_shape, config)
    except Exception as e:
        # 任何未捕获的异常都通知前端
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({"type": "error", "message": f"{type(e).__name__}: {e}", "traceback": tb}), flush=True)
        sys.exit(1)

if __name__ == '__main__':
    # PyInstaller 打包后必须调用 freeze_support()：
    # Windows 上 DataLoader(num_workers>0) 以 spawn 方式重新执行本 exe（--multiprocessing-fork），
    # 若无此调用，子进程会重跑 main() 并阻塞在 stdin 读取上，导致训练挂起无输出
    import multiprocessing
    multiprocessing.freeze_support()
    main()
