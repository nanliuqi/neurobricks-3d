import sys
import json
from models import build_model
from train import train

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
        # 构建模型
        model_and_shape = build_model(config['layers'])
        
        # 开始训练
        train(model_and_shape, config)
    except Exception as e:
        # 任何未捕获的异常都通知前端
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({"type": "error", "message": f"{type(e).__name__}: {e}", "traceback": tb}), flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
