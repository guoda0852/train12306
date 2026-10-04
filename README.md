# 12306 车票查询 · 智能路线推荐

输入出发地、目的地、日期，自动查询 12306 余票并给出直达 + 换乘路线建议。

- 🌐 网站：https://guoda0852.github.io/train12306/
- 🔌 查询 API：https://train12306.guoda086-5a5.workers.dev/api

## API 说明（供 Muse / 程序调用）

| 接口 | 示例 |
|---|---|
| 车站联想 | `GET /api/stations?q=深圳` |
| 直达余票 | `GET /api/tickets?from=深圳北&to=北京西&date=2026-10-08` |
| 路线建议 | `GET /api/suggest?from=深圳&to=北京&date=2026-10-08` |

- `from` / `to` 支持车站名（如"深圳北"）、城市名（如"深圳"）、电报码（如"SZQ"）
- `date` 格式 `yyyy-MM-dd`，范围为今天起 15 天内（12306 预售期）
- `suggest` 返回 `recommended`（结合余票排序的推荐路线）、`direct`（直达车次）、`transfers`（换乘方案）

## 架构

- 前端：纯静态 `index.html`，部署在 GitHub Pages
- API：Cloudflare Worker（`worker.js`），实时调用 12306 公开查询接口：
  - `otn/leftTicket/query*` 直达余票（查询路径动态解析 `CLeftTicketUrl`）
  - `lcquery/queryG` 换乘查询（中转站留空，自动返回多中转方案）
- 车站数据：`stations.json`（3404 个车站，构建时从 12306 `station_name.js` 快照生成）

## 本地构建

```bash
python3 build.py   # 由 worker.template.js + stations.compact.json 生成 worker.js
```

## 声明

- 查询原理基于 [Joooook/12306-mcp](https://github.com/Joooook/12306-mcp)（MIT 协议）改写
- 数据来自 12306 公开查询接口，仅供出行参考
- 本项目仅做车次与余票查询展示，不提供购票、抢票、下单功能
