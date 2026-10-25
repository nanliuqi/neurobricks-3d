import sys
import json
from protocol import TrainerError, log_message, start_heartbeat, stop_heartbeat

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
        log_message("error", status="failed", errorCode="CONFIG_MISSING", message="No configuration received", details={})
        sys.exit(1)
    
    try:
        config = json.loads(config_line)
    except json.JSONDecodeError as e:
        log_message("error", status="failed", errorCode="CONFIG_JSON_INVALID", message=f"Invalid config JSON: {e}", details={})
        sys.exit(1)

    if not isinstance(config, dict):
        log_message("error", status="failed", errorCode="CONFIG_TYPE_INVALID", message="Configuration must be a JSON object", details={})
        sys.exit(1)
    
    mode = config.get('mode', 'train')
    heartbeat = None
    try:
        supported_modes = {'capabilities', 'predict', 'predict_tabular', 'train', 'evaluate_claim'}
        if mode not in supported_modes:
            raise TrainerError('MODE_UNSUPPORTED', f"Unsupported mode: {mode}", {'mode': mode})
        if mode == 'capabilities':
            from train import runtime_capabilities
            log_message("runtime_capabilities", **runtime_capabilities())
        elif mode == 'predict':
            # 推理模式：延迟导入 predict 模块（避免训练时加载 PIL 等额外依赖）
            from predict import predict
            predict(config)
        elif mode == 'predict_tabular':
            from predict import predict_tabular
            predict_tabular(config)
        else:
            # 单一后台心跳覆盖 torch 导入、模型构建、数据加载、验证与权重保存。
            # 不能只在 batch 循环里发，否则长时间评估会被 Rust 看门狗误杀。
            heartbeat = start_heartbeat()
            log_message("log", level="info", message="Training sidecar accepted configuration")

            # 全局随机种子在一切消耗随机的操作（模型权重初始化、数据切分）之前固定。
            # 心跳必须先启动，因为首次 import torch 本身就可能耗时较久。
            seed = config.get('seed', 42)
            if seed is not None:
                import random
                import numpy
                import torch
                random.seed(seed)
                numpy.random.seed(seed)
                torch.manual_seed(seed)
                torch.cuda.manual_seed_all(seed)

            from models import build_model
            from train import evaluate_claim, train
            model_and_shape = build_model(config['layers'])
            if mode == 'evaluate_claim':
                log_message("log", level="info", message="Claim evaluation sidecar accepted frozen protocol")
                evaluate_claim(model_and_shape, config)
            else:
                train(model_and_shape, config)
    except TrainerError as error:
        log_message(
            "error",
            status="failed",
            errorCode=error.error_code,
            message=str(error),
            details=error.details,
        )
        sys.exit(1)
    except Exception as e:
        # Unexpected failures are still terminal, but remain distinguishable from
        # validated user/data errors for diagnostics.
        import traceback
        tb = traceback.format_exc()
        log_message(
            "error",
            status="failed",
            errorCode="INTERNAL_ERROR",
            message=f"{type(e).__name__}: {e}",
            traceback=tb,
        )
        sys.exit(1)
    finally:
        stop_heartbeat(heartbeat)

if __name__ == '__main__':
    # PyInstaller 打包后必须调用 freeze_support()：
    # Windows 上 DataLoader(num_workers>0) 以 spawn 方式重新执行本 exe（--multiprocessing-fork），
    # 若无此调用，子进程会重跑 main() 并阻塞在 stdin 读取上，导致训练挂起无输出
    import multiprocessing
    multiprocessing.freeze_support()
    main()
