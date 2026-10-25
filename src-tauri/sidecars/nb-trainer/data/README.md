# Built-in dataset directory / 内置数据目录

This tracked README keeps the `sidecars/nb-trainer/data` Tauri resource directory present in a clean source checkout. Tauri walks this directory, so a source-only checkout does not depend on a recursive glob finding downloaded dataset subdirectories. It is a placeholder, not a dataset.

Git intentionally excludes downloaded MNIST/CIFAR-10 data, private datasets, and model weights. The existing development training flow can download built-in datasets to the user's cache and copy them into this directory. First use therefore needs access to the dataset download servers unless the data has been prepared separately.

这个受版本控制的说明文件用于保留 Tauri 配置所引用的数据资源目录，不代表已附带数据。真实训练前请按[开发与评审指南](../../../../docs/开发与评审指南.md)准备 Python 环境，并允许首次数据下载，或自行提供合法获取的数据。

不要提交客户数据、个人实验记录、已解封测试集或模型产物。离线应用交付需要单独准备和验证数据，不应通过取消整个目录的忽略规则来实现。
