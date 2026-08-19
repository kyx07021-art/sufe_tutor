# 文本审核咽喉（text-audit）方案

> v0.25.113 起。地址合规门控的语义级兜底方案。

## 背景

地址合规红线：详细门牌号不收集/不存储/不展示。早期用正则 `ADDRESS_GUARD` 拦截「数字+门牌后缀」，
后补中文数字（贰柒捌捌号）、连字符变体（贰-柒-捌-捌-号）。但用户实证（2026-08-10）：
**谐音/语义级描述可以绕过纯正则**——「二期爸爸号」「2期8霸昊」「2788好」「丁香国际对门学校
上二楼左转第一间房」。这类需要语义理解，规则层兜不住。

## 架构：分层审核链（fail-closed）

`server/text-audit.js` —— 全站自由文本统一审核入口。调用点签名固定 `auditFreeText(text)`，
未来全站审核（帖子/评论/聊天/头像描述…）只在此模块演进策略，调用点不变。

```
调用点（routes-* 对自由文本字段）
   └─ auditFreeText(text)
        ├─ L1 规则层（零网络零成本毫秒级）
        │    ├─ ADDRESS_GUARD：数字+门牌后缀（含中文数字/连字符/全角变体）
        │    └─ HARMONIC_GUARD：数字谐音后缀（2788好/昊/豪…，排除「号线」）
        └─ L2 语义层（可选外接，可配置）
             └─ DeepSeek Messages API：判断是否含可定位住址描述
                  （门牌/楼栋/房间/方位描述如「对门」「上二楼」「左转第一间」）
```

- **fail-closed（v1.5.0 定案）**：L2 未配置密钥 / 超时（4s）/ 网络异常 / 解析失败 → `layer:'error'`，
  调用方回 `MSG.TEXT_AUDIT_UNAVAILABLE` 拒绝写入，绝不静默降级为仅 L1、绝不明文落库。
- **layer 标注**：`{ ok, layer: 'rule' | 'ai' | 'error' }`，可审计是哪层拦截。

## 配置（外接接口启用）

1. Cloudflare Worker Secrets 添加 `TEXT_AUDIT_API_KEY`（DeepSeek API key）。
2. 语义层自动启用（L2）；**未配置 = 生产内容写路径被拒**（fail-closed，绝不静默降级为仅 L1）。

密钥读取走 `server/secrets.js` 网关（只读 env：Worker Secrets / `.dev.vars` / 测试显式注入，
仓库零明文密钥，fail-open 已清）。测试注入 `TEXT_AUDIT_API_KEY` 经 `test/_test-secrets.js`。

## 接入点（当前）

| 路由 | 字段 | 位置 |
|---|---|---|
| routes-teacher | address / intro / school | handleSaveProfile |
| routes-demands | address / additional_info | handleCreateDemand |

## 未来全站统一审核

- 新调用点：直接 `import { auditFreeText }` + `await auditFreeText(fieldValue)`，`!ok` 即 400。
- 换模型/厂商/加规则：只改 `server/text-audit.js`（`AUDIT_MODEL` / `AUDIT_SYSTEM` / L1 表）。
- 成本与延迟：L1 命中不调外接（零成本）；L2 每次提交 1 次/字段（保存资料/发布需求低频，
  可接受）；如需省成本可后续加短时去重缓存或批处理。

## 为什么不用重型 NLP 库

Cloudflare Workers（workerd）环境约束：脚本体积上限（免费 3MB gzip）、无 Python 生态。
调研（2026-08-10）：无现成 worker 兼容的中文地址 PII 检测库；worker 可用的 PII 库（pii-detect-regex、
@secured-ai/core 等）都是正则驱动且不含中文地址；中文门牌是结构化模式（数字串+门牌后缀），
规则层 + 语义外接是成熟路径（快递/银行脱敏同款）。谐音/描述性地址语义层（L2 外接）兜底。
