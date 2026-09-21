# Trilium Plugins (插件开发目录)

本目录用于存放基于当前分支 `dev-plugins` 开发的各类 Trilium 插件、前端/后端小部件及增强脚本。

---

## 📂 插件列表

| 插件目录 | 插件名称 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| [daily-progress](./daily-progress/) | **关联进展 (Daily Progress Widget)** | 右侧边栏小部件 (`api.RightPanelWidget`) | 聚合与当前笔记相关的 topic 关联、@提及反链及同名每日进展笔记，按时间流卡片展示 |

---

## 🛠️ 开发指南

- **前端小部件 (Frontend Widget)**：继承 `api.RightPanelWidget` 等基础类，在 Trilium 中对应配置了 `#widget` 的 `JS Frontend` 脚本笔记。
- **自定义属性/关系**：通过 `~relation` 与 `#label` 与 Trilium 数据体系深度整合。
