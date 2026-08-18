# CSP 收口·内联面基线清单（V-3-1a）

范围：v2 页面（src/client + web/index.html）。v1 壳（根 index.html/app-*.js）冻结，随 V-4-1h 删除后 `_headers` 的 unsafe-inline 一并收口。

验证命令（基线）：

```bash
# 1. 内联事件/样式属性（应为零）
grep -rn "onclick=\|onload=\|onchange=\|style=" src/client/ --include=*.js | grep -v "// \|cssText\|setProperty\|getPropertyValue\|\.style\."
# 2. 动态 <style> 注入（应仅下记 2 处）
grep -rn "createElement('style')\|createElement(\"style\")" src/client/ --include=*.js
# 3. web/index.html 内联事件（应仅 3 处异步 CSS onload）
grep -n "onload\|onclick\|style=" web/index.html
# 4. eval / new Function（应为零）
grep -rn "\beval(\|new Function\|Function(" src/client/ web/theme-init.js --include=*.js
```

## 清单（2026-08-19 盘点）

| # | 位置 | 形态 | 归属基元 |
|---|------|------|---------|
| 1 | src/client/core/appearance.js:88-90 | 动态 `<style>`（lg-orb-style，orb 动态几何/配色/时长） | V-3-1c1 |
| 2 | src/client/core/ui-scale-reflow.js:224 | 动态 `<style>`（__ui-reflow-transforms，逐单元 transform + 静态 transition） | V-3-1c2 |
| 3 | web/index.html:20-22 | 3 处 `media="print" onload="this.media='all'"`（chat/posts/region 异步 CSS） | V-3-1b |
| 4 | archtest 缺口 | 现有契约只查 `onclick=`/`style=`，漏 `onload=` 与 `createElement('style')` | V-3-1c3 |

已确认干净：onclick/style 属性零残留；eval / new Function 零；web/index.html 无内联 script/style 标签（仅外部 script 引用）；theme-init.js 为外部 classic 脚本走 'self'。

## 收口顺序依赖
- V-3-1b 去 3 处 onload → web/index.html 零内联事件属性
- V-3-1c1/c2 迁移 2 处动态 style 注入 → v2 零 `<style>` 元素
- V-3-1c3 archtest 增「零 createElement('style') + 零 style 属性」契约锁住
- V-3-1d web/index.html 页级严格 meta CSP（script-src/style-src 无 unsafe-inline，与 `_headers` 取交集：v2 严格、v1 保持 loose）；`_headers` 的 unsafe-inline 保留到 V-4-1h
